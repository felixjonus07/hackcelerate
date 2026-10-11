/**
 * Evidence submission and access (§6, §8.3, §12.1): one path for links and uploaded files. A link is
 * checked by a worker; a file goes to private storage and waits for a named reviewer. Platform
 * results and reviewer records are never submitted by a student.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { audit } from "../audit/log";
import { decideAccess } from "../consent/matrix";
import { db } from "../db";
import { artifacts, quests, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { checkArtifactUrl } from "../ingestion/quality";
import { getActivePolicy } from "../policy/load";
import { enqueue } from "../queue";
import { objectKey, storage, validateUpload } from "../storage";
import { applyTransition } from "../verification/apply";
import { claimKeyFor, textHashFor } from "../verification/claims";
import { flagDuplicateClaim, flagReusedText } from "../verification/flags";
import { verifyKindFor } from "../verification/recheck";

export class EvidenceError extends Error {}

export interface SubmitInput {
  /** A key of `policy.evidence_types`. */
  type: string;
  label: string;
  component: string;
  standardItem?: string | null;
  sourceUrl?: string | null;
  description?: string | null;
  file?: { bytes: Uint8Array; contentType: string } | null;
  details?: Record<string, unknown>;
  questId?: string | null;
}

export async function submitEvidence(
  student: { id: string; pseudonymousId: string },
  user: { id: string; role: Role },
  input: SubmitInput,
  sourceIp?: string | null,
) {
  const policy = await getActivePolicy();
  const spec = policy.evidence_types[input.type];
  if (!spec) throw new EvidenceError("That kind of evidence is not recognised");
  if (spec.mode === "platform")
    throw new EvidenceError("This result is recorded by the campus platform when you take the assessment.");
  if (spec.mode === "reviewer") throw new EvidenceError("This record is entered by your faculty reviewer.");

  const id = randomUUID();
  let fileRef: string | null = null;
  let contentHash: string | null = null;
  if (spec.mode === "link") {
    if (!input.sourceUrl) throw new EvidenceError("Add the link to your work");
    const ok = checkArtifactUrl(input.sourceUrl, policy);
    if (!ok.ok) throw new EvidenceError(ok.reason);
  } else {
    if (!input.file) throw new EvidenceError("Attach the file");
    const check = validateUpload(input.file.bytes, input.file.contentType, policy);
    if (!check.ok) throw new EvidenceError(check.reason);
    fileRef = objectKey(student.id, id);
    contentHash = check.sha256;
    await storage.put(fileRef, input.file.bytes, input.file.contentType);
  }

  const claimKey =
    claimKeyFor({ url: input.sourceUrl, details: input.details }) ?? (contentHash ? `file:${contentHash}` : null);
  const [a] = await db
    .insert(artifacts)
    .values({
      id,
      studentId: student.id,
      type: input.type,
      component: input.component,
      standardItem: input.standardItem ?? null,
      label: input.label,
      description: input.description ?? null,
      sourceUrl: spec.mode === "link" ? input.sourceUrl : null,
      fileRef,
      source: "student",
      status: "SUBMITTED",
      weight: spec.weight,
      contentHash,
      claimKey,
      textHash: textHashFor(input.description),
      details: input.details ?? {},
    })
    .returning();

  if (input.questId) {
    await db
      .update(quests)
      .set({ status: "EVIDENCE_SUBMITTED", evidenceArtifactId: a.id })
      .where(and(eq(quests.id, input.questId), eq(quests.studentId, student.id)));
  }
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "artifact.submit",
    entityType: "artifact",
    entityId: a.id,
    purpose: input.questId ? "quest_evidence" : "evidence_submission",
    fieldsAccessed: [`type:${input.type}`, spec.mode],
    sourceIp,
    result: "allowed",
  });

  // Uploads wait for a named reviewer; links are checked by a worker. Either way the system moves it forward.
  if (spec.mode === "upload") {
    await applyTransition(
      a.id,
      "UNDER_CHECK",
      { kind: "system" },
      `Waiting for review by the ${(spec.reviewer_role ?? "faculty reviewer").replace("_", " ")}`,
    );
  } else {
    const kind = verifyKindFor({ type: input.type, sourceUrl: input.sourceUrl ?? null }, policy.evidence_types);
    if (kind) {
      try {
        await enqueue("verification", { artifactId: a.id, kind });
      } catch {
        // Redis down: due now, so the re-check scheduler picks it up.
        await db.update(artifacts).set({ nextCheckAt: new Date() }).where(eq(artifacts.id, a.id));
      }
    }
  }
  await flagDuplicateClaim(a.id);
  await flagReusedText(a.id);
  return a;
}

/**
 * A short-lived link to an uploaded file (§13.3). The owner may open it; a staff member only for a
 * student assigned to them and only where the access matrix allows evidence, with the read audited.
 */
export async function evidenceFileLink(user: { id: string; role: Role }, artifactId: string, sourceIp?: string | null) {
  const policy = await getActivePolicy();
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!a?.fileRef) throw new EvidenceError("There is no file for this evidence");
  const [owner] = await db
    .select({ userId: students.userId, pseudo: students.pseudonymousId })
    .from(students)
    .where(eq(students.id, a.studentId))
    .limit(1);
  const isSelf = owner?.userId === user.id;
  let allowed = isSelf;
  if (!isSelf) {
    const [assigned] = await db
      .select({ s: staffAssignments.studentId })
      .from(staffAssignments)
      .where(and(eq(staffAssignments.staffUserId, user.id), eq(staffAssignments.studentId, a.studentId)))
      .limit(1);
    allowed =
      decideAccess({ role: user.role, category: "artifacts_evidence", isAssigned: Boolean(assigned), individual: true })
        .allowed && Boolean(assigned);
  }
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "artifact.file_view",
    entityType: "artifact",
    entityId: a.id,
    purpose: isSelf ? "self_access" : "evidence_review",
    sourceIp,
    result: allowed ? "allowed" : "denied",
  });
  if (!allowed) throw new EvidenceError("You cannot open this file");
  return storage.signedUrl(a.fileRef, policy.verification.upload.signed_url_max_seconds);
}
