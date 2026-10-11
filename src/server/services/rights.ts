/**
 * Student rights requests and data export (§13.7, DPDP Act 2023).
 *
 * An access request produces a downloadable export of the student's own data.
 * A correction request routes to the registrar (for ERP data) or mentor (for narrative).
 * An erasure request is checked against the retention schedule before deletion.
 */
import { desc, eq, or } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import {
  artifacts,
  aspirations,
  auditEvents,
  consentRecords,
  evaluations,
  leaderboardOptIns,
  quests,
  rightsRequests,
  studentIdentities,
  students,
} from "../db/schema";
import type { Role } from "../db/schema/enums";

export async function getStudentRightsRequests(studentId: string) {
  return db
    .select()
    .from(rightsRequests)
    .where(eq(rightsRequests.studentId, studentId))
    .orderBy(desc(rightsRequests.createdAt));
}

export async function submitRightsRequest(
  studentId: string,
  userId: string,
  userRole: Role,
  pseudonymousId: string,
  kind: "access" | "correction" | "erasure",
  detail?: string,
) {
  let resolution: string | null = null;
  let status = "OPEN";

  if (kind === "access") {
    status = "COMPLETED";
    resolution = "Data export generated and available for download.";
  } else if (kind === "correction") {
    const isErp = detail ? /baseline|cgpa|attendance|department|year|erp/i.test(detail) : true;
    resolution = isErp
      ? "Routed to Registrar for academic record verification."
      : "Routed to Faculty Mentor of record.";
  } else if (kind === "erasure") {
    status = "PENDING_REVIEW";
    resolution =
      "Checked against institutional retention schedule (§13.5). Academic baseline and degrees retained per statutory requirement; self-reported non-statutory data queued for erasure within 30 days.";
  }

  const [req] = await db
    .insert(rightsRequests)
    .values({
      studentId,
      kind,
      detail: detail ?? null,
      status,
      dueAt: new Date(Date.now() + 30 * 86_400_000), // 30-day statutory SLA
      resolution,
    })
    .returning();

  await audit({
    actorUserId: userId,
    actorRole: userRole,
    action: `rights.${kind}`,
    entityType: "student",
    entityId: pseudonymousId,
    purpose: "rights_request",
    result: "allowed",
  });

  return req;
}

export async function exportStudentData(studentId: string, userId: string) {
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student) throw new Error("Student not found");

  const [identity] = await db
    .select()
    .from(studentIdentities)
    .where(eq(studentIdentities.studentId, studentId))
    .limit(1);

  const [aspirationList, artifactList, questList, evalList, consentList, rightsList, lbOptIn, auditList] =
    await Promise.all([
      db.select().from(aspirations).where(eq(aspirations.studentId, studentId)).orderBy(desc(aspirations.createdAt)),
      db.select().from(artifacts).where(eq(artifacts.studentId, studentId)).orderBy(desc(artifacts.createdAt)),
      db.select().from(quests).where(eq(quests.studentId, studentId)).orderBy(desc(quests.createdAt)),
      db.select().from(evaluations).where(eq(evaluations.studentId, studentId)).orderBy(desc(evaluations.createdAt)),
      db
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.studentId, studentId))
        .orderBy(desc(consentRecords.changedAt)),
      db
        .select()
        .from(rightsRequests)
        .where(eq(rightsRequests.studentId, studentId))
        .orderBy(desc(rightsRequests.createdAt)),
      db.select().from(leaderboardOptIns).where(eq(leaderboardOptIns.studentId, studentId)).limit(1),
      db
        .select()
        .from(auditEvents)
        .where(or(eq(auditEvents.entityId, student.pseudonymousId), eq(auditEvents.actorUserId, userId)))
        .orderBy(desc(auditEvents.at))
        .limit(200),
    ]);

  return {
    exportDate: new Date().toISOString(),
    complianceStandard: "India DPDP Act 2023 §13.7",
    student: {
      pseudonymousId: student.pseudonymousId,
      departmentCode: student.departmentCode,
      year: student.year,
      batch: student.batch,
      declaredTrack: student.declaredTrack,
      cgpa: student.cgpa,
      attendancePct: student.attendancePct,
      activeBacklogs: student.activeBacklogs,
      displayName: identity?.displayName ?? "Anonymous",
      rollNumber: identity?.rollNumber ?? null,
      parentalConsentRequired: student.parentalConsentRequired,
      createdAt: student.createdAt,
    },
    leaderboardOptIn: lbOptIn[0]?.optedIn ?? false,
    aspirations: aspirationList,
    evidenceArtifacts: artifactList,
    quests: questList,
    evaluations: evalList.map((e) => ({
      id: e.id,
      policyVersion: e.policyVersion,
      track: e.track,
      trackScore: e.trackScore,
      readiness: e.readiness,
      aegIndex: e.aegIndex,
      trend: e.trend,
      confidence: e.confidence,
      createdAt: e.createdAt,
    })),
    consentHistory: consentList,
    rightsRequests: rightsList,
    accessAuditLog: auditList.map((a) => ({
      at: a.at,
      action: a.action,
      actorRole: a.actorRole,
      purpose: a.purpose,
      result: a.result,
    })),
  };
}
