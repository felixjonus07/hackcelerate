/**
 * Normalization functions (§5.2). Each converts a raw measure to 0–100 and is
 * deliberately simple so a mentor can reproduce any number by hand.
 */
import type { Policy, VerificationStatus } from "../policy/schema";

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Rounds for display only (§5.6: intermediate values keep full precision). */
export const round1 = (x: number) => Math.round(x * 10) / 10;
export const round2 = (x: number) => Math.round(x * 100) / 100;

export function cgpaScore(cgpa: number, policy: Policy): number {
  const [lo, hi] = policy.academic.scoring_range;
  return clamp((cgpa - lo) / (hi - lo), 0, 1) * 100;
}

export function attendanceScore(attendancePct: number, policy: Policy): number {
  return clamp(attendancePct / policy.attendance.requirement_pct, 0, 1) * 100;
}

export function percentileScore(percentile: number): number {
  return clamp(percentile, 0, 100);
}

export function speedScore(targetSeconds: number, avgSeconds: number): number {
  if (avgSeconds <= 0) return 0;
  return Math.min(100, (100 * targetSeconds) / avgSeconds);
}

export function streakScore(validDaysInLast30: number): number {
  return (Math.min(validDaysInLast30, 30) / 30) * 100;
}

export function consistencyScore(weeksWithTwoMocksInLast8: number): number {
  return (clamp(weeksWithTwoMocksInLast8, 0, 8) / 8) * 100;
}

export function ratingScore(averageRating: number): number {
  return clamp((averageRating - 1) / 4, 0, 1) * 100;
}

export function multiplier(status: VerificationStatus, policy: Policy): number {
  return policy.verification_multipliers[status] ?? 0;
}

/**
 * Evidence score: Σ(weight × multiplier) / Σ(required weights) × 100, capped
 * at 100. Required items with no evidence contribute zero (§5.2).
 */
export function evidenceScore(
  required: { key: string; weight: number }[],
  found: Map<string, VerificationStatus>,
  policy: Policy,
): number {
  const total = required.reduce((s, r) => s + r.weight, 0);
  if (total === 0) return 0;
  const earned = required.reduce((s, r) => {
    const status = found.get(r.key);
    return s + (status ? r.weight * multiplier(status, policy) : 0);
  }, 0);
  return Math.min(100, (earned / total) * 100);
}

/** Least-squares slope of values against week index (§7.5). */
export function leastSquaresSlope(points: { week: number; value: number }[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const mx = points.reduce((s, p) => s + p.week, 0) / n;
  const my = points.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.week - mx) * (p.value - my);
    den += (p.week - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export const average = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
