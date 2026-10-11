/**
 * Builds the rules-engine input (StudentFacts) from the database. This is the
 * only place that maps rows to engine facts.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import {
  artifacts,
  aspirations,
  attendanceWeeks,
  facultyRatings,
  internshipRecords,
  mockAttempts,
  students,
} from "../db/schema";
import type { FacultyRating, StudentFacts } from "../rules/types";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export async function loadStudentFacts(studentId: string): Promise<StudentFacts> {
  const [s] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!s) throw new Error(`Student ${studentId} not found`);

  const [asp] = await db
    .select()
    .from(aspirations)
    .where(and(eq(aspirations.studentId, studentId), eq(aspirations.isCurrent, true)))
    .orderBy(desc(aspirations.createdAt))
    .limit(1);

  const [arts, mocks, ratings, internships, weeks] = await Promise.all([
    db.select().from(artifacts).where(eq(artifacts.studentId, studentId)),
    db.select().from(mockAttempts).where(eq(mockAttempts.studentId, studentId)),
    db.select().from(facultyRatings).where(eq(facultyRatings.studentId, studentId)),
    db.select().from(internshipRecords).where(eq(internshipRecords.studentId, studentId)),
    db
      .select()
      .from(attendanceWeeks)
      .where(eq(attendanceWeeks.studentId, studentId))
      .orderBy(attendanceWeeks.weekStart),
  ]);

  const counted = internships.filter((i) => i.status === "VERIFIED" || i.status === "ATTESTED");
  const aptitude = (type: string) =>
    mocks.filter((m) => m.testType === type).sort((a, b) => +b.takenAt - +a.takenAt)[0]?.percentile ?? null;

  // Weekly attendance % (all courses combined), oldest first.
  const byWeek = new Map<string, { held: number; attended: number }>();
  for (const w of weeks) {
    const k = String(w.weekStart);
    const cur = byWeek.get(k) ?? { held: 0, attended: 0 };
    cur.held += w.classesHeld;
    cur.attended += w.classesAttended;
    byWeek.set(k, cur);
  }
  const attendanceWeekly = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v], i) => ({
      week: i + 1,
      value: v.held ? (v.attended / v.held) * 100 : 0,
    }));

  const sig = s.signals ?? {};
  return {
    studentId: s.pseudonymousId,
    department: s.departmentCode,
    year: s.year,
    cgpa: s.cgpa,
    attendancePct: s.attendancePct,
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
    })),
    mocks: mocks
      .filter((m) => !m.testType.endsWith("_aptitude"))
      .map((m) => ({
        id: m.id,
        testType: m.testType,
        date: isoDate(m.takenAt),
        items: m.items,
        percentile: m.percentile,
        avgSecondsPerItem: m.avgSecondsPerItem,
        targetSecondsPerItem: m.targetSecondsPerItem ?? undefined,
        itemKind: (m.itemKind as "mcq" | "numerical" | null) ?? undefined,
        status: m.status,
      })),
    ratings: ratings.map((r) => ({
      id: r.id,
      kind: r.kind as FacultyRating["kind"],
      date: isoDate(r.ratedAt),
      rating: r.rating,
      status: r.status,
    })),
    verifiedInternshipHours: internships.length ? counted.reduce((n, i) => n + i.hours, 0) : null,
    campusAptitudePercentile: aptitude("campus_aptitude"),
    internalAptitudePercentile: aptitude("internal_aptitude"),
    attendanceWeekly: attendanceWeekly.length ? attendanceWeekly : undefined,
    activeBacklogs: s.activeBacklogs,
    artifactScore: sig.artifactScore ?? null,
    cohortArtifactP75: sig.cohortArtifactP75 ?? null,
    verifiedProjects: sig.verifiedProjects ?? 0,
    activityLast60d: sig.activityLast60d ?? 0,
    mocksLast60d: sig.mocksLast60d ?? 0,
    monthsToDeadline: sig.monthsToDeadline ?? null,
    streakValidDays: sig.streakValidDays,
    streakGapDays14: sig.streakGapDays14,
    precomputed: sig.precomputed,
    recentSourceFailures: sig.recentSourceFailures ?? 0,
  };
}
