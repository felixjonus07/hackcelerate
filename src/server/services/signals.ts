/**
 * Cohort signals (§7.3), refreshed before each nightly evaluation: every student's verified artifact
 * score and the 75th percentile of that score within their department. The Detention Threat Builder
 * compares a student against it. A signal listed in `signals.pinned` is left as it is.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { artifacts, students } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import type { Policy } from "../policy/schema";
import type { multiplier } from "../rules/normalize";

/** Artifact score 0–100: counted evidence weight over the policy's "full" weight. */
export function artifactScore(
  evidence: { weight: number; status: Parameters<typeof multiplier>[0] }[],
  policy: Pick<Policy, "cohort" | "verification_multipliers">,
): number {
  const earned = evidence.reduce((s, e) => s + e.weight * (policy.verification_multipliers[e.status] ?? 0), 0);
  return Math.min(100, (earned / policy.cohort.artifact_score_full_weight) * 100);
}

/** Linear-interpolated percentile (0–100) of a list of numbers. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (v.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return v[lo] + (v[hi] - v[lo]) * (rank - lo);
}

export async function refreshCohortSignals() {
  const policy = await getActivePolicy();
  const [rows, evidence] = await Promise.all([
    db.select({ id: students.id, department: students.departmentCode, signals: students.signals }).from(students),
    db.select({ studentId: artifacts.studentId, weight: artifacts.weight, status: artifacts.status }).from(artifacts),
  ]);
  const byStudent = new Map<string, { weight: number; status: (typeof evidence)[number]["status"] }[]>();
  for (const e of evidence) byStudent.set(e.studentId, [...(byStudent.get(e.studentId) ?? []), e]);
  const scores = new Map(rows.map((r) => [r.id, artifactScore(byStudent.get(r.id) ?? [], policy)]));
  const byDept = new Map<string, number[]>();
  for (const r of rows) byDept.set(r.department, [...(byDept.get(r.department) ?? []), scores.get(r.id) ?? 0]);
  const p75 = new Map([...byDept].map(([d, v]) => [d, percentile(v, policy.cohort.percentile)]));

  let updated = 0;
  for (const r of rows) {
    const pinned = new Set(r.signals?.pinned ?? []);
    const next = {
      ...r.signals,
      ...(pinned.has("artifactScore") ? {} : { artifactScore: scores.get(r.id) ?? 0 }),
      ...(pinned.has("cohortArtifactP75") ? {} : { cohortArtifactP75: p75.get(r.department) ?? 0 }),
    };
    if (JSON.stringify(next) !== JSON.stringify(r.signals)) {
      await db.update(students).set({ signals: next }).where(eq(students.id, r.id));
      updated++;
    }
  }
  return { students: rows.length, updated };
}
