/**
 * Named-reviewer decisions (§6.1, §6.2): certificates and letters become ATTESTED by a faculty member
 * or office; internship letters are confirmed by the placement cell; sampled external score reports
 * are checked against the test body; integrity flags are resolved with a stated reason.
 */
import { and, eq } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { artifacts, integrityFlags, internshipRecords, mockAttempts, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { applyTransition } from "./apply";

export class ReviewError extends Error {}

type Reviewer = { id: string; role: Role };

async function mayReview(reviewer: Reviewer, studentId: string) {
  // Mentors, class advisors and the placement cell act on their assigned students (§13.1).
  if (reviewer.role === "registrar" || reviewer.role === "dean") return false;
  const [row] = await db
    .select({ s: staffAssignments.studentId })
    .from(staffAssignments)
    .where(and(eq(staffAssignments.staffUserId, reviewer.id), eq(staffAssignments.studentId, studentId)))
    .limit(1);
  return Boolean(row);
}

/** Attest or reject an artifact that is waiting for a reviewer (UNDER_CHECK or SELF_REPORTED). */
export async function reviewArtifact(
  reviewer: Reviewer,
  artifactId: string,
  decision: "attest" | "reject",
  reason: string,
  sourceIp?: string | null,
) {
  const policy = await getActivePolicy();
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!a) throw new ReviewError("Evidence not found");
  if (!(await mayReview(reviewer, a.studentId))) throw new ReviewError("You are not assigned to this student");
  const spec = policy.evidence_types[a.type];
  if (spec?.reviewer_role && spec.reviewer_role !== reviewer.role)
    throw new ReviewError(`${spec.label} is reviewed by the ${spec.reviewer_role.replace("_", " ")}`);
  if (!reason.trim()) throw new ReviewError("A reason is required");
  const to = decision === "attest" ? "ATTESTED" : "REJECTED";
  const { row } = await applyTransition(
    a.id,
    to,
    { kind: "reviewer", userId: reviewer.id, role: reviewer.role },
    reason,
    {
      checkKind: "reviewer",
      sourceIp,
    },
  );
  return row;
}

/** The placement cell confirms internship hours with the company contact (§5.3.1, §6.2). */
export async function confirmInternship(
  reviewer: Reviewer,
  internshipId: string,
  decision: "attest" | "reject",
  note: string,
) {
  const [i] = await db.select().from(internshipRecords).where(eq(internshipRecords.id, internshipId)).limit(1);
  if (!i) throw new ReviewError("Internship record not found");
  if (reviewer.role !== "placement_officer") throw new ReviewError("The placement cell confirms internships");
  if (!(await mayReview(reviewer, i.studentId))) throw new ReviewError("You are not assigned to this student");
  const status = decision === "attest" ? "ATTESTED" : "REJECTED";
  await db
    .update(internshipRecords)
    .set({ status, confirmedBy: reviewer.id })
    .where(eq(internshipRecords.id, internshipId));
  await audit({
    actorUserId: reviewer.id,
    actorRole: reviewer.role,
    action: "internship.review",
    entityType: "internship",
    entityId: internshipId,
    purpose: "evidence_verification",
    reason: note || status,
    result: "allowed",
  });
  return status;
}

/** Outcome of checking a sampled external score report against the test body (§6.2). */
export async function reviewSampledMock(
  reviewer: Reviewer,
  mockId: string,
  outcome: "MATCH" | "MISMATCH",
  note: string,
) {
  const [m] = await db.select().from(mockAttempts).where(eq(mockAttempts.id, mockId)).limit(1);
  if (!m || !m.sampledAt || m.sampleOutcome) throw new ReviewError("This report is not waiting for a check");
  if (!(await mayReview(reviewer, m.studentId))) throw new ReviewError("You are not assigned to this student");
  // A mismatch sets the item to REJECTED and tells the mentor; a match lets it count in full.
  await db
    .update(mockAttempts)
    .set({ sampleOutcome: outcome, status: outcome === "MATCH" ? "VERIFIED" : "REJECTED" })
    .where(eq(mockAttempts.id, mockId));
  await audit({
    actorUserId: reviewer.id,
    actorRole: reviewer.role,
    action: "mock.sample_review",
    entityType: "mock_attempt",
    entityId: mockId,
    purpose: "evidence_verification",
    reason: note || outcome,
    result: "allowed",
  });
  if (outcome === "MISMATCH") {
    await notify({
      to: { role: "faculty_mentor" },
      studentId: m.studentId,
      template: "mock_report_mismatch",
      related: { type: "mock_attempt", id: mockId },
    });
  }
}

/** Resolve an integrity flag with a stated reason (§8.1 closure). Both students are told it was reviewed, not accused (§6.3). */
export async function resolveFlag(reviewer: Reviewer, flagId: string, reason: string) {
  const [f] = await db.select().from(integrityFlags).where(eq(integrityFlags.id, flagId)).limit(1);
  if (!f || f.status !== "OPEN") throw new ReviewError("This flag is not open");
  if (!reason.trim()) throw new ReviewError("A reason is required to resolve a flag");
  if (!(await mayReview(reviewer, f.studentId))) throw new ReviewError("You are not assigned to this student");
  await db
    .update(integrityFlags)
    .set({ status: "RESOLVED", resolvedBy: reviewer.id, resolution: reason })
    .where(eq(integrityFlags.id, flagId));
  await audit({
    actorUserId: reviewer.id,
    actorRole: reviewer.role,
    action: "integrity_flag.resolve",
    entityType: "integrity_flag",
    entityId: flagId,
    purpose: "evidence_verification",
    reason,
    result: "allowed",
  });
  if (f.check === "reused_text" || f.check === "duplicate_claim") {
    const [s] = await db.select({ id: students.id }).from(students).where(eq(students.id, f.studentId)).limit(1);
    if (s)
      await notify({
        to: { role: "student" },
        studentId: s.id,
        template: "evidence_reviewed",
        related: { type: "integrity_flag", id: flagId },
      });
  }
}
