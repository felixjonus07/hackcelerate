/**
 * Command Center aggregates (§12.2). Aggregates only — this module never
 * returns an individual record, by design (§2: planning ≠ deep-dive).
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { evaluations, staffAssignments, students } from "../db/schema";
import type { Role } from "../db/schema/enums";

export interface CohortSummary {
  total: number;
  evaluated: number;
  byTrack: { track: string | null; count: number }[];
  matrix: { track: string; LOW: number; MODERATE: number; CRITICAL: number }[];
  trend: {
    IMPROVING: number;
    STABLE: number;
    WORSENING: number;
    INSUFFICIENT_DATA: number;
  };
  lastEvaluatedAt: Date | null;
}

export async function cohortSummary(user: { id: string; role: Role }, departmentCode?: string): Promise<CohortSummary> {
  const scope =
    user.role === "faculty_mentor"
      ? db
          .select({ id: staffAssignments.studentId })
          .from(staffAssignments)
          .where(eq(staffAssignments.staffUserId, user.id))
      : db
          .select({ id: students.id })
          .from(students)
          .where(departmentCode ? eq(students.departmentCode, departmentCode) : sql`true`);

  const latest = db
    .selectDistinctOn([evaluations.studentId], {
      studentId: evaluations.studentId,
      track: evaluations.track,
      aegIndex: evaluations.aegIndex,
      trend: evaluations.trend,
      createdAt: evaluations.createdAt,
    })
    .from(evaluations)
    .where(inArray(evaluations.studentId, scope))
    .orderBy(evaluations.studentId, desc(evaluations.createdAt))
    .as("latest");

  const [rows, totals, declared] = await Promise.all([
    db.select().from(latest),
    db.select({ n: sql<number>`count(*)::int` }).from(students).where(inArray(students.id, scope)),
    db
      .select({
        track: students.declaredTrack,
        count: sql<number>`count(*)::int`,
      })
      .from(students)
      .where(inArray(students.id, scope))
      .groupBy(students.declaredTrack),
  ]);

  const matrix = new Map<string, CohortSummary["matrix"][number]>();
  const trend: CohortSummary["trend"] = {
    IMPROVING: 0,
    STABLE: 0,
    WORSENING: 0,
    INSUFFICIENT_DATA: 0,
  };
  for (const r of rows) {
    const m = matrix.get(r.track) ?? {
      track: r.track,
      LOW: 0,
      MODERATE: 0,
      CRITICAL: 0,
    };
    m[r.aegIndex]++;
    matrix.set(r.track, m);
    trend[r.trend]++;
  }
  return {
    total: totals[0]?.n ?? 0,
    evaluated: rows.length,
    byTrack: declared.sort((a, b) => b.count - a.count),
    matrix: [...matrix.values()],
    trend,
    lastEvaluatedAt: rows.reduce<Date | null>((d, r) => (!d || r.createdAt > d ? r.createdAt : d), null),
  };
}
