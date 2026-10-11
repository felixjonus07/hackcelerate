/**
 * Builds the rules-engine input (StudentFacts) from the database. This is the
 * only place that maps rows to engine facts, and where the §4.3 data-quality
 * rules are applied. Everything is derived from base tables as of one date.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  activityEvents,
  artifacts,
  aspirations,
  attendanceWeeks,
  facultyRatings,
  ingestionRuns,
  internshipRecords,
  milestones,
  mockAttempts,
  students,
} from "../db/schema";
import { assessAttendance, checkCgpa, checkMockAttempt } from "../ingestion/quality";
import { getActivePolicy } from "../policy/load";
import { diffDays, localDate, mondayOf } from "../rules/calendar";
import type { FacultyRating, StudentFacts } from "../rules/types";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
/** Evidence kinds that count as a practical project for the High Flyer trigger (§7.3). */
const PROJECT_KINDS = new Set(["project", "repository", "model_file", "prototype"]);

/** `asOf` fixes the snapshot date; services pass the request time, tests pass a constant. */
export async function loadStudentFacts(studentId: string, opts: { asOf?: Date } = {}): Promise<StudentFacts> {
  const policy = await getActivePolicy();
  const asOfDate = opts.asOf ?? new Date();
  const asOf = localDate(asOfDate, policy.calendar);
  const [s] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!s) throw new Error(`Student ${studentId} not found`);

  const [asp] = await db
    .select()
    .from(aspirations)
    .where(and(eq(aspirations.studentId, studentId), eq(aspirations.isCurrent, true)))
    .orderBy(desc(aspirations.createdAt))
    .limit(1);

  const sixtyAgo = new Date(asOfDate.getTime() - 60 * 86_400_000);
  const failureSince = new Date(asOfDate.getTime() - policy.confidence.source_failure_window_days * 86_400_000);
  const [arts, mocks, ratings, internships, weeks, ms, activity, failedRuns] = await Promise.all([
    db.select().from(artifacts).where(eq(artifacts.studentId, studentId)),
    db.select().from(mockAttempts).where(eq(mockAttempts.studentId, studentId)),
    db.select().from(facultyRatings).where(eq(facultyRatings.studentId, studentId)),
    db.select().from(internshipRecords).where(eq(internshipRecords.studentId, studentId)),
    db
      .select()
      .from(attendanceWeeks)
      .where(eq(attendanceWeeks.studentId, studentId))
      .orderBy(attendanceWeeks.weekStart),
    db.select().from(milestones).where(eq(milestones.studentId, studentId)),
    db
      .select({ at: activityEvents.at, kind: activityEvents.kind })
      .from(activityEvents)
      .where(and(eq(activityEvents.studentId, studentId), gte(activityEvents.at, sixtyAgo))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(ingestionRuns)
      .where(
        and(
          inArray(ingestionRuns.status, ["FAILED", "FILE_MISSING", "SCHEMA_ERROR"]),
          gte(ingestionRuns.startedAt, failureSince),
        ),
      ),
  ]);

  const counted = internships.filter((i) => i.status === "VERIFIED" || i.status === "ATTESTED");
  // An uploaded internship letter counts once the placement cell has attested it; its hours are in `details`.
  const letters = arts.filter(
    (a) => a.type === "internship_letter" && (a.status === "ATTESTED" || a.status === "VERIFIED"),
  );
  const letterHours = letters.reduce((n, a) => n + (Number((a.details as { hours?: number }).hours) || 0), 0);

  // §4.3: invalid weeks are excluded, and more than two missing weeks lower confidence.
  const attendance = assessAttendance(
    weeks.map((w) => ({ weekStart: String(w.weekStart), held: w.classesHeld, attended: w.classesAttended })),
    asOf,
    policy,
  );
  // Week numbers are real weeks since the term began, so a gap stays a gap in the trend slope.
  const termMonday = mondayOf(policy.calendar.term.start);
  const weekNo = (weekStart: string) => Math.round(diffDays(termMonday, weekStart) / 7) + 1;
  const attendanceWeekly = attendance.weeks.map((w) => ({
    week: weekNo(w.weekStart),
    value: (w.attended / w.held) * 100,
  }));

  // §4.3: an attempt with a score outside the test range, or no seconds per item, is stored but not scored.
  const excludedMocks: string[] = [];
  const scoredMocks = mocks.filter((m) => {
    const q = checkMockAttempt({ score: m.score, maxScore: m.maxScore, avgSecondsPerItem: m.avgSecondsPerItem });
    if (m.qualityFlag || !q.ok) excludedMocks.push(m.id);
    return !m.qualityFlag && q.ok;
  });
  const aptitude = (type: string) =>
    scoredMocks.filter((m) => m.testType === type).sort((a, b) => +b.takenAt - +a.takenAt)[0]?.percentile ?? null;
  // Mean mock percentile per week over the same week numbering, for the trend engine (§7.5).
  const perWeek = new Map<number, number[]>();
  for (const m of scoredMocks.filter((x) => !x.testType.endsWith("_aptitude"))) {
    const wn = weekNo(mondayOf(localDate(m.takenAt, policy.calendar)));
    perWeek.set(wn, [...(perWeek.get(wn) ?? []), m.percentile]);
  }
  const mockPercentileWeekly = [...perWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, ps]) => ({ week, value: ps.reduce((a, b) => a + b, 0) / ps.length }));
  const cgpaCheck = checkCgpa(s.cgpa, policy.academic.cgpa_scale_max);

  // Months to the target date, from the aspiration (§7.3 mismatch triggers).
  const monthsToDeadline = asp?.targetDate ? Math.max(0, diffDays(asOf, String(asp.targetDate)) / 30.4375) : null;
  const sig = s.signals ?? {};
  const mocksLast60 = scoredMocks.filter((m) => m.takenAt >= sixtyAgo).length;
  const caDates = [
    ...new Set(activity.filter((a) => a.kind === "current_affairs").map((a) => localDate(a.at, policy.calendar))),
  ];

  return {
    studentId: s.pseudonymousId,
    asOf,
    department: s.departmentCode,
    year: s.year,
    cgpa: cgpaCheck.ok ? s.cgpa : null,
    attendancePct: s.attendancePct,
    creditsHeld: s.creditsHeld,
    aspiration: {
      track: asp?.track ?? null,
      targetOutcome: asp?.targetOutcome ?? "Not yet chosen",
      targetType: asp?.targetType ?? undefined,
      targetDate: asp?.targetDate ?? undefined,
      readiness: asp?.readiness,
    },
    evidence: arts.map((a) => ({
      id: a.id,
      component: a.component,
      standardItem: a.standardItem ?? undefined,
      label: a.label,
      weight: a.weight,
      status: a.status,
      source: a.source,
      kind: a.type,
      details: a.details,
    })),
    mocks: scoredMocks
      .filter((m) => !m.testType.endsWith("_aptitude"))
      .map((m) => ({
        id: m.id,
        testType: m.testType,
        date: localDate(m.takenAt, policy.calendar),
        items: m.items,
        percentile: m.percentile,
        score: m.score,
        maxScore: m.maxScore,
        avgSecondsPerItem: m.avgSecondsPerItem,
        targetSecondsPerItem: m.targetSecondsPerItem ?? undefined,
        itemKind: (m.itemKind as "mcq" | "numerical" | null) ?? undefined,
        difficulty: m.difficulty ?? undefined,
        source: m.source,
        status: m.status,
      })),
    ratings: ratings.map((r) => ({
      id: r.id,
      kind: r.kind as FacultyRating["kind"],
      date: isoDate(r.ratedAt),
      rating: r.rating,
      status: r.status,
    })),
    milestones: ms.map((m) => ({
      id: m.id,
      scope: m.scope as "application" | "venture",
      title: m.title,
      dueOn: String(m.dueOn),
      completedOn: m.completedOn ? String(m.completedOn) : null,
    })),
    verifiedInternshipHours:
      internships.length || letters.length ? counted.reduce((n, i) => n + i.hours, 0) + letterHours : null,
    campusAptitudePercentile: aptitude("campus_aptitude"),
    internalAptitudePercentile: aptitude("internal_aptitude"),
    attendanceWeekly: attendanceWeekly.length ? attendanceWeekly : undefined,
    mockPercentileWeekly: mockPercentileWeekly.length ? mockPercentileWeekly : undefined,
    currentAffairsDates: caDates,
    activeBacklogs: s.activeBacklogs,
    artifactScore: sig.artifactScore ?? null,
    cohortArtifactP75: sig.cohortArtifactP75 ?? null,
    verifiedProjects: arts.filter((a) => a.status === "VERIFIED" && PROJECT_KINDS.has(a.type)).length,
    activityLast60d: activity.length,
    mocksLast60d: mocksLast60,
    monthsToDeadline,
    recentSourceFailures: (sig.recentSourceFailures ?? 0) + (failedRuns[0]?.n ?? 0),
    dataQuality: {
      ...(cgpaCheck.ok ? {} : { cgpa: cgpaCheck.reason }),
      attendanceWeeksMissing: attendance.missingWeeks,
      attendanceCap: attendance.cap,
      ...(excludedMocks.length ? { excludedMocks } : {}),
    },
  };
}
