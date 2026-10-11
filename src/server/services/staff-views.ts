/**
 * Staff list views (§12.2): the class advisor's attendance view, the placement officer's readiness list and the
 * E-Cell's traction view. Each shows only what the access matrix and the student's consent allow, never exports
 * an individual list (§14.4), and writes an audit event for every student whose record is read (§13.6).
 */
import { and, eq, inArray } from "drizzle-orm";
import { auditMany } from "../audit/log";
import { db } from "../db";
import { artifacts, evaluations, mockAttempts, staffAssignments, studentIdentities, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { isErpStale } from "../ingestion/stale";
import { getActivePolicy } from "../policy/load";
import { multiplier } from "../rules/normalize";
import { consentedStudentIds } from "./consent";
import { AccessDenied } from "./students";

type Staff = { id: string; role: Role };

/** Each view belongs to one office; the route checks the role too, but the service never trusts its caller (§4 rule 5). */
function only(user: Staff, role: Role) {
  if (user.role !== role) throw new AccessDenied(`${user.role} cannot open this view`);
}

const latestByStudent = async (ids: string[]) => {
  if (ids.length === 0) return new Map<string, typeof evaluations.$inferSelect>();
  const rows = await db
    .select()
    .from(evaluations)
    .where(inArray(evaluations.studentId, ids))
    .orderBy(evaluations.createdAt);
  return new Map(rows.map((r) => [r.studentId, r]));
};

export interface AttendanceRow {
  studentId: string;
  handle: string;
  rollNumber: string;
  name: string;
  year: number;
  attendancePct: number | null;
  band: "ok" | "watch" | "critical";
  trend: string;
  attendanceFlag: boolean;
  importedAt: Date | null;
  stale: boolean;
}

/** The class advisor's students with attendance and attendance flags only (§2: "Assigned students, attendance and flags"). */
export async function attendanceView(user: Staff, now = new Date()): Promise<AttendanceRow[]> {
  only(user, "class_advisor");
  const policy = await getActivePolicy();
  const rows = await db
    .select({ s: students, i: studentIdentities })
    .from(staffAssignments)
    .innerJoin(students, eq(students.id, staffAssignments.studentId))
    .innerJoin(studentIdentities, eq(studentIdentities.studentId, students.id))
    .where(and(eq(staffAssignments.staffUserId, user.id), eq(staffAssignments.role, "class_advisor")));
  const ev = await latestByStudent(rows.map((r) => r.s.id));
  const [lo, hi] = policy.attendance.watch_band_pct;
  const out: AttendanceRow[] = rows.map(({ s, i }) => {
    const pct = s.attendancePct;
    const e = ev.get(s.id);
    return {
      studentId: s.id,
      handle: s.pseudonymousId,
      rollNumber: i.rollNumber,
      name: i.displayName,
      year: s.year,
      attendancePct: pct,
      band:
        pct == null
          ? "ok"
          : pct < policy.attendance.condonation_floor_pct
            ? "critical"
            : pct >= lo && pct <= hi
              ? "watch"
              : "ok",
      trend: e?.result.trend.signals.attendance.label ?? "INSUFFICIENT_DATA",
      attendanceFlag: Boolean(
        e && (e.result.attendanceCriticalFlag || e.primaryPersona === "detention_threat_builder"),
      ),
      importedAt: s.erpImportedAt,
      stale: isErpStale({ erpStale: s.erpStale, erpImportedAt: s.erpImportedAt }, now, policy),
    };
  });
  out.sort((a, b) => (a.attendancePct ?? 101) - (b.attendancePct ?? 101));
  await auditMany(
    out.map((r) => ({
      actorUserId: user.id,
      actorRole: user.role,
      action: "student_record.list_view",
      entityType: "student",
      entityId: r.handle,
      purpose: "attendance_review",
      fieldsAccessed: ["academic_baseline.attendance", "evaluation.attendance_flag"],
      result: "allowed" as const,
    })),
  );
  return out;
}

export interface ReadinessRow {
  studentId: string;
  handle: string;
  /** Present only with identity consent. */
  name: string | null;
  department: string;
  year: number;
  academic: { cgpa: number | null; attendancePct: number | null } | null;
  tests: { aptitude: number | null } | null;
  projects: { label: string; status: string }[] | null;
  /** Only with persona_aeg consent: the gap and the track score. */
  readiness: { score: number; gap: string; track: string } | null;
  fieldsShared: string[];
}

/**
 * Students who agreed to share their academic and project fields with the placement cell (§12.2). Each further
 * field appears only if the student shared that category too; persona and gap flags only with their own consent.
 */
export async function placementReadiness(user: Staff): Promise<ReadinessRow[]> {
  only(user, "placement_officer");
  const all = await db.select({ id: students.id }).from(students);
  const ids = all.map((a) => a.id);
  const [academic, projects, tests, flags, identity] = await Promise.all([
    consentedStudentIds(ids, "academic_baseline", "placement_officer"),
    consentedStudentIds(ids, "artifacts_evidence", "placement_officer"),
    consentedStudentIds(ids, "mock_scores", "placement_officer"),
    consentedStudentIds(ids, "persona_aeg", "placement_officer"),
    consentedStudentIds(ids, "identity_contact", "placement_officer"),
  ]);
  const eligible = ids.filter((id) => academic.has(id) && projects.has(id));
  if (eligible.length === 0) return [];
  const [studs, idents, arts, mocks, ev] = await Promise.all([
    db.select().from(students).where(inArray(students.id, eligible)),
    db.select().from(studentIdentities).where(inArray(studentIdentities.studentId, eligible)),
    db.select().from(artifacts).where(inArray(artifacts.studentId, eligible)),
    db
      .select()
      .from(mockAttempts)
      .where(and(inArray(mockAttempts.studentId, eligible), eq(mockAttempts.testType, "campus_aptitude"))),
    latestByStudent(eligible),
  ]);
  const policy = await getActivePolicy();
  const rows = studs.map((s): ReadinessRow => {
    const e = ev.get(s.id);
    const shared = [
      "academic_baseline",
      "artifacts_evidence",
      ...(tests.has(s.id) ? ["mock_scores"] : []),
      ...(flags.has(s.id) ? ["persona_aeg"] : []),
      ...(identity.has(s.id) ? ["identity_contact"] : []),
    ];
    return {
      studentId: s.id,
      handle: s.pseudonymousId,
      name: identity.has(s.id) ? (idents.find((i) => i.studentId === s.id)?.displayName ?? null) : null,
      department: s.departmentCode,
      year: s.year,
      academic: { cgpa: s.cgpa, attendancePct: s.attendancePct },
      tests: tests.has(s.id) ? { aptitude: mocks.find((m) => m.studentId === s.id)?.percentile ?? null } : null,
      projects: arts
        .filter((a) => a.studentId === s.id && multiplier(a.status, policy) > 0)
        .map((a) => ({ label: a.label, status: a.status })),
      readiness: flags.has(s.id) && e ? { score: e.trackScore, gap: e.aegIndex, track: e.track } : null,
      fieldsShared: shared,
    };
  });
  await auditMany(
    rows.map((r) => ({
      actorUserId: user.id,
      actorRole: user.role,
      action: "student_record.list_view",
      entityType: "student",
      entityId: r.handle,
      purpose: "placement_readiness",
      fieldsAccessed: r.fieldsShared,
      result: "allowed" as const,
    })),
  );
  return rows;
}

export interface TractionRow {
  studentId: string;
  handle: string;
  name: string | null;
  department: string;
  items: { label: string; status: string; component: string }[];
  interviews: number;
}

/** What the E-Cell may see: venture evidence the student shared with it, and nothing about attendance or grades (§2, §13.1). */
export async function tractionView(user: Staff): Promise<TractionRow[]> {
  only(user, "ecell_coordinator");
  const all = await db.select({ id: students.id }).from(students);
  const ids = all.map((a) => a.id);
  const shared = [...(await consentedStudentIds(ids, "artifacts_evidence", "ecell_coordinator"))];
  if (shared.length === 0) return [];
  const identity = await consentedStudentIds(shared, "identity_contact", "ecell_coordinator");
  const [studs, idents, arts] = await Promise.all([
    db.select().from(students).where(inArray(students.id, shared)),
    db.select().from(studentIdentities).where(inArray(studentIdentities.studentId, shared)),
    db.select().from(artifacts).where(inArray(artifacts.studentId, shared)),
  ]);
  const policy = await getActivePolicy();
  const VENTURE = new Set(["venture_traction", "build_evidence", "customer_validation"]);
  const rows = studs
    .map((s): TractionRow => {
      const mine = arts.filter(
        (a) => a.studentId === s.id && VENTURE.has(a.component) && multiplier(a.status, policy) > 0,
      );
      return {
        studentId: s.id,
        handle: s.pseudonymousId,
        name: identity.has(s.id) ? (idents.find((i) => i.studentId === s.id)?.displayName ?? null) : null,
        department: s.departmentCode,
        items: mine
          .filter((a) => a.component !== "customer_validation")
          .map((a) => ({ label: a.label, status: a.status, component: a.component })),
        interviews: mine.filter((a) => a.type === "interview_log").length,
      };
    })
    .filter((r) => r.items.length > 0 || r.interviews > 0)
    .sort((a, b) => b.items.length + b.interviews - (a.items.length + a.interviews));
  await auditMany(
    rows.map((r) => ({
      actorUserId: user.id,
      actorRole: user.role,
      action: "student_record.list_view",
      entityType: "student",
      entityId: r.handle,
      purpose: "venture_traction",
      fieldsAccessed: ["artifacts_evidence"],
      result: "allowed" as const,
    })),
  );
  return rows;
}
