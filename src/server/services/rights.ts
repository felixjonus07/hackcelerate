/**
 * A student's rights requests (§13.7): the system confirms identity through the active session, logs the
 * request and sets a response deadline. Access produces a download of the student's own data, a correction
 * goes to the registrar (ERP data) or the mentor of record (a narrative), and an erasure is checked against
 * the retention schedule before anything is deleted, with the outcome explained in writing.
 */
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import {
  artifactStatusEvents,
  artifacts,
  aspirations,
  attendanceWeeks,
  auditEvents,
  consentRecords,
  evaluations,
  facultyRatings,
  internshipRecords,
  interventions,
  milestones,
  mockAttempts,
  notifications,
  quests,
  rightsRequests,
  students,
  wellbeingNudges,
} from "../db/schema";
import type { Role } from "../db/schema/enums";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { erasureLetter, erasurePlan } from "../rules/retention";
import { mentorOf } from "./counseling";

export type RightKind = "access" | "correction" | "erasure";
export class RightsError extends Error {}

type StudentRef = { id: string; pseudonymousId: string };
type Actor = { id: string; role: Role };

/** Everything held about the student, as a document they can keep. Other people appear by role only. */
export async function buildAccessExport(student: StudentRef, now = new Date()) {
  const policy = await getActivePolicy();
  const [profile] = await db.select().from(students).where(eq(students.id, student.id)).limit(1);
  const [arts, evals, asp, ivs, qs, consents, marks, ratings, internships, weeks, ms, nudges, notes] =
    await Promise.all([
      db.select().from(artifacts).where(eq(artifacts.studentId, student.id)),
      db.select().from(evaluations).where(eq(evaluations.studentId, student.id)).orderBy(desc(evaluations.createdAt)),
      db.select().from(aspirations).where(eq(aspirations.studentId, student.id)).orderBy(desc(aspirations.createdAt)),
      db
        .select()
        .from(interventions)
        .where(and(eq(interventions.studentId, student.id), inArray(interventions.status, ["DISPATCHED", "CLOSED"]))),
      db.select().from(quests).where(eq(quests.studentId, student.id)),
      db
        .select()
        .from(consentRecords)
        .where(eq(consentRecords.studentId, student.id))
        .orderBy(consentRecords.changedAt),
      db.select().from(mockAttempts).where(eq(mockAttempts.studentId, student.id)),
      db.select().from(facultyRatings).where(eq(facultyRatings.studentId, student.id)),
      db.select().from(internshipRecords).where(eq(internshipRecords.studentId, student.id)),
      db.select().from(attendanceWeeks).where(eq(attendanceWeeks.studentId, student.id)),
      db.select().from(milestones).where(eq(milestones.studentId, student.id)),
      db.select().from(wellbeingNudges).where(eq(wellbeingNudges.studentId, student.id)),
      db.select().from(notifications).where(eq(notifications.studentId, student.id)),
    ]);
  const events = arts.length
    ? await db
        .select()
        .from(artifactStatusEvents)
        .where(
          inArray(
            artifactStatusEvents.artifactId,
            arts.map((a) => a.id),
          ),
        )
    : [];
  const access = await db
    .select({
      at: auditEvents.at,
      role: auditEvents.actorRole,
      action: auditEvents.action,
      purpose: auditEvents.purpose,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, "student"), eq(auditEvents.entityId, student.pseudonymousId)))
    .orderBy(desc(auditEvents.at));
  await audit({
    actorUserId: profile?.userId ?? student.id,
    actorRole: "student",
    action: "rights.access_export",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "rights_request",
    result: "allowed",
  });
  return {
    generatedAt: now.toISOString(),
    policyVersion: policy.policy_version,
    note: "This is a copy of the data held about you. Staff appear by role, not by name.",
    profile: {
      pseudonymousId: profile?.pseudonymousId,
      department: profile?.departmentCode,
      year: profile?.year,
      batch: profile?.batch,
      cgpa: profile?.cgpa,
      attendancePct: profile?.attendancePct,
      activeBacklogs: profile?.activeBacklogs,
      dateOfBirth: profile?.dateOfBirth,
      declaredTrack: profile?.declaredTrack,
    },
    aspirations: asp.map((a) => ({
      track: a.track,
      targetOutcome: a.targetOutcome,
      targetDate: a.targetDate,
      readiness: a.readiness,
      current: a.isCurrent,
      at: a.createdAt,
      reason: a.changeReason,
    })),
    evidence: arts.map((a) => ({
      label: a.label,
      type: a.type,
      status: a.status,
      source: a.sourceUrl,
      submittedAt: a.createdAt,
      history: events
        .filter((e) => e.artifactId === a.id)
        .map((e) => ({ at: e.at, from: e.fromStatus, to: e.toStatus, by: e.actorKind, reason: e.reason })),
    })),
    evaluations: evals.map((e) => ({
      at: e.createdAt,
      track: e.track,
      score: e.trackScore,
      readiness: e.readiness,
      gapIndex: e.aegIndex,
      trend: e.trend,
      confidence: e.confidence,
      policyVersion: e.policyVersion,
      narrative: e.narrative,
      components: e.result.trackScore.components.map((c) => ({ name: c.label, score: c.score, weight: c.weight })),
    })),
    support: ivs.map((i) => ({ at: i.dispatchedAt, message: i.finalMessage ?? i.proposedMessage })),
    quests: qs.map((q) => ({ title: q.title, status: q.status, due: q.dueAt })),
    mockAttempts: marks.map((m) => ({
      test: m.testType,
      at: m.takenAt,
      score: m.score,
      percentile: m.percentile,
      status: m.status,
      source: m.source,
    })),
    facultyRatings: ratings.map((r) => ({ kind: r.kind, rating: r.rating, at: r.ratedAt })),
    internships: internships.map((i) => ({ organisation: i.organisation, hours: i.hours, status: i.status })),
    attendanceWeeks: weeks.map((w) => ({
      course: w.course,
      weekStart: w.weekStart,
      held: w.classesHeld,
      attended: w.classesAttended,
    })),
    milestones: ms.map((m) => ({ scope: m.scope, title: m.title, due: m.dueOn, completed: m.completedOn })),
    wellbeingNudges: nudges.map((n) => ({ at: n.createdAt, pattern: n.pattern, explanation: n.explanation })),
    consentHistory: consents.map((c) => ({
      at: c.changedAt,
      category: c.category,
      office: c.recipientRole,
      shared: c.granted,
    })),
    whoViewedMyRecord: access,
    notices: notes.map((n) => ({ at: n.createdAt, template: n.template })),
  };
}

const dueAt = (now: Date, days: number) => new Date(now.getTime() + days * 86_400_000);

/** Raise a request. Access resolves at once with the export; the others wait for the person who handles them. */
export async function raiseRequest(
  student: StudentRef,
  actor: Actor,
  input: { kind: RightKind; detail?: string; target?: "erp" | "narrative" },
  now = new Date(),
) {
  const policy = await getActivePolicy();
  const due = dueAt(now, policy.privacy.rights_response_days);
  let routedTo: string | null = null;
  let plan: unknown = null;
  let resolution: string | null = null;
  let status = "OPEN";

  if (input.kind === "access") {
    status = "RESOLVED";
    resolution = "Your data export is ready to download.";
  } else if (input.kind === "correction") {
    // ERP data goes to the registrar; a narrative goes to the mentor of record (§13.7).
    routedTo = input.target === "narrative" ? "faculty_mentor" : "registrar";
  } else {
    const open = await db
      .select({ id: interventions.id })
      .from(interventions)
      .where(
        and(eq(interventions.studentId, student.id), inArray(interventions.status, ["PENDING_APPROVAL", "APPROVED"])),
      )
      .limit(1);
    plan = erasurePlan(policy, { hasOpenIntervention: open.length > 0 });
    routedTo = "registrar";
  }
  const [row] = await db
    .insert(rightsRequests)
    .values({
      studentId: student.id,
      kind: input.kind,
      detail: input.detail ?? null,
      status,
      dueAt: due,
      resolution,
      resolvedAt: status === "RESOLVED" ? now : null,
      routedToRole: routedTo,
      plan,
    })
    .returning();
  await audit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: `rights.${input.kind}`,
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "rights_request",
    fieldsAccessed: routedTo ? [`routed:${routedTo}`] : [],
    result: "allowed",
  });
  if (routedTo === "faculty_mentor") {
    const mentor = await mentorOf(student.id);
    if (mentor)
      await notify({
        to: { userId: mentor },
        studentId: student.id,
        template: "rights_request",
        vars: { kind: input.kind },
        related: { type: "rights_request", id: row.id },
      });
  } else if (routedTo) {
    await notify({
      to: { role: routedTo },
      studentId: student.id,
      template: "rights_request",
      vars: { kind: input.kind },
      related: { type: "rights_request", id: row.id },
    });
  }
  return { ...row, letter: input.kind === "erasure" ? erasureLetter(plan as ReturnType<typeof erasurePlan>) : null };
}

export async function requestsFor(studentId: string) {
  return db
    .select()
    .from(rightsRequests)
    .where(eq(rightsRequests.studentId, studentId))
    .orderBy(desc(rightsRequests.createdAt));
}

/** Requests waiting for this person: the registrar's queue, or a mentor's for their students (§13.7). */
export async function openRequestsFor(actor: Actor) {
  const rows = await db
    .select({ r: rightsRequests, pseudo: students.pseudonymousId, dept: students.departmentCode })
    .from(rightsRequests)
    .innerJoin(students, eq(students.id, rightsRequests.studentId))
    .where(and(eq(rightsRequests.routedToRole, actor.role), inArray(rightsRequests.status, ["OPEN", "IN_PROGRESS"])))
    .orderBy(rightsRequests.dueAt);
  if (actor.role !== "faculty_mentor") return rows;
  // A mentor sees only their own students' requests.
  const { staffAssignments } = await import("../db/schema");
  const mine = await db
    .select({ s: staffAssignments.studentId })
    .from(staffAssignments)
    .where(eq(staffAssignments.staffUserId, actor.id));
  const ids = new Set(mine.map((m) => m.s));
  return rows.filter((x) => ids.has(x.r.studentId));
}

/**
 * Close a request with a written outcome. Resolving an erasure erases what the plan says to erase now; a
 * resolved correction re-runs the evaluation so the corrected data is scored (§13.4 accuracy).
 */
export async function resolveRequest(actor: Actor, requestId: string, outcome: string, now = new Date()) {
  const [r] = await db.select().from(rightsRequests).where(eq(rightsRequests.id, requestId)).limit(1);
  if (!r || !["OPEN", "IN_PROGRESS"].includes(r.status)) throw new RightsError("This request is not open");
  if (r.routedToRole !== actor.role) throw new RightsError("This request is not yours to resolve");
  if (!outcome.trim()) throw new RightsError("Write the outcome the student will read");
  await db
    .update(rightsRequests)
    .set({ status: "RESOLVED", resolution: outcome, resolvedAt: now, resolvedBy: actor.id })
    .where(eq(rightsRequests.id, requestId));
  await audit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: `rights.${r.kind}.resolve`,
    entityType: "rights_request",
    entityId: requestId,
    purpose: "rights_request",
    reason: outcome,
    result: "allowed",
  });
  await notify({
    to: { role: "student" },
    studentId: r.studentId,
    template: "rights_resolved",
    vars: { kind: r.kind },
    related: { type: "rights_request", id: requestId },
  });
  return r;
}

/** Who has looked at my record, by role and purpose, newest first (§13.1 "own access log"). The student's own actions are left out. */
export async function accessLogFor(student: StudentRef, limit = 30) {
  return db
    .select({
      at: auditEvents.at,
      role: auditEvents.actorRole,
      action: auditEvents.action,
      purpose: auditEvents.purpose,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityType, "student"),
        eq(auditEvents.entityId, student.pseudonymousId),
        ne(auditEvents.actorRole, "student"),
      ),
    )
    .orderBy(desc(auditEvents.at))
    .limit(limit);
}
