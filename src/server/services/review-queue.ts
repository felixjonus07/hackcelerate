/**
 * What a named reviewer has waiting (§6.1, §6.2): uploaded certificates and letters, internship records,
 * sampled external score reports and open integrity flags, for the students assigned to them. Students are
 * shown by pseudonym only; the read is audited.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { auditMany } from "../audit/log";
import { db } from "../db";
import { artifacts, integrityFlags, internshipRecords, mockAttempts, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { getActivePolicy } from "../policy/load";

export interface ReviewItem {
  kind: "artifact" | "internship" | "mock" | "flag";
  id: string;
  handle: string;
  title: string;
  detail: string;
  status: string;
  /** Present when an uploaded file can be opened. */
  hasFile: boolean;
  at: Date;
}

export async function reviewQueue(reviewer: { id: string; role: Role }): Promise<ReviewItem[]> {
  const policy = await getActivePolicy();
  const mine = await db
    .select({ s: staffAssignments.studentId })
    .from(staffAssignments)
    .where(eq(staffAssignments.staffUserId, reviewer.id));
  const ids = [...new Set(mine.map((m) => m.s))];
  if (ids.length === 0) return [];
  const handles = new Map(
    (
      await db
        .select({ id: students.id, handle: students.pseudonymousId })
        .from(students)
        .where(inArray(students.id, ids))
    ).map((s) => [s.id, s.handle]),
  );
  const items: ReviewItem[] = [];

  const waiting = await db
    .select()
    .from(artifacts)
    .where(and(inArray(artifacts.studentId, ids), inArray(artifacts.status, ["UNDER_CHECK", "SELF_REPORTED"])));
  for (const a of waiting) {
    const spec = policy.evidence_types[a.type];
    if (!spec || spec.mode !== "upload") continue;
    if (spec.reviewer_role && spec.reviewer_role !== reviewer.role) continue;
    items.push({
      kind: "artifact",
      id: a.id,
      handle: handles.get(a.studentId) ?? "",
      title: a.label,
      detail: `${spec.label}${a.description ? `: ${a.description}` : ""}`,
      status: a.status,
      hasFile: Boolean(a.fileRef),
      at: a.createdAt,
    });
  }

  if (reviewer.role === "placement_officer") {
    const internships = await db
      .select()
      .from(internshipRecords)
      .where(
        and(inArray(internshipRecords.studentId, ids), inArray(internshipRecords.status, ["SUBMITTED", "UNDER_CHECK"])),
      );
    for (const i of internships)
      items.push({
        kind: "internship",
        id: i.id,
        handle: handles.get(i.studentId) ?? "",
        title: `Internship at ${i.organisation}`,
        detail: `${i.hours} hours claimed. Confirm with the company contact before attesting.`,
        status: i.status,
        hasFile: false,
        at: i.createdAt,
      });
  }

  if (reviewer.role === "faculty_mentor") {
    const mocks = await db
      .select()
      .from(mockAttempts)
      .where(
        and(
          inArray(mockAttempts.studentId, ids),
          isNotNull(mockAttempts.sampledAt),
          isNull(mockAttempts.sampleOutcome),
        ),
      );
    for (const m of mocks)
      items.push({
        kind: "mock",
        id: m.id,
        handle: handles.get(m.studentId) ?? "",
        title: `${m.testType} score report`,
        detail: "Sampled for a check against the test body's record. A match lets it count in full.",
        status: m.status,
        hasFile: false,
        at: m.sampledAt ?? m.takenAt,
      });
    const flags = await db
      .select()
      .from(integrityFlags)
      .where(and(inArray(integrityFlags.studentId, ids), eq(integrityFlags.status, "OPEN")));
    for (const f of flags)
      items.push({
        kind: "flag",
        id: f.id,
        handle: handles.get(f.studentId) ?? "",
        title: "Evidence needs a second look",
        detail: f.detail,
        status: "OPEN",
        hasFile: false,
        at: f.createdAt,
      });
  }

  items.sort((a, b) => +a.at - +b.at);
  await auditMany(
    [...new Set(items.map((i) => i.handle))].map((h) => ({
      actorUserId: reviewer.id,
      actorRole: reviewer.role,
      action: "review_queue.view",
      entityType: "student",
      entityId: h,
      purpose: "evidence_verification",
      fieldsAccessed: ["artifacts.status"],
      result: "allowed" as const,
    })),
  );
  return items;
}
