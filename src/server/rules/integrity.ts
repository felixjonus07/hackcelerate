/**
 * Integrity checks (§6.3). Output is a flag for human review — a flag never
 * changes a score.
 */
import type { Policy } from "../policy/schema";
import { addDays } from "./calendar";
import { multiplier } from "./normalize";
import type { MockAttempt } from "./types";

export interface IntegrityFlag {
  check: "implausible_speed" | "burst_commits" | "duplicate_claim" | "reused_text";
  subjectId: string;
  detail: string;
}

export function implausibleSpeed(mocks: MockAttempt[], policy: Policy): IntegrityFlag[] {
  return mocks
    .filter((m) => {
      const floor =
        m.itemKind === "numerical" ? policy.integrity.min_seconds_per_numerical : policy.integrity.min_seconds_per_mcq;
      return m.avgSecondsPerItem < floor;
    })
    .map((m) => ({
      check: "implausible_speed" as const,
      subjectId: m.id,
      detail: `Median ${m.avgSecondsPerItem}s per item is below the review threshold`,
    }));
}

export function burstCommits(
  commitsPerMinutePeak: number,
  share24h: number,
  hadEarlierActivity: boolean,
  repoId: string,
  policy: Policy,
): IntegrityFlag[] {
  const burst =
    commitsPerMinutePeak >= policy.integrity.burst_commits_per_minute ||
    (share24h >= policy.integrity.burst_share_24h && !hadEarlierActivity);
  return burst
    ? [
        {
          check: "burst_commits",
          subjectId: repoId,
          detail: "Commit pattern queued for mentor review",
        },
      ]
    : [];
}

/**
 * Days with a streak credit (§6.3 streak padding): a complete mock of at least N items that
 * counts (not UNVERIFIED or REJECTED). A day with only short sets earns nothing and raises no flag.
 */
function creditDays(mocks: readonly MockAttempt[], policy: Policy): Set<string> {
  return new Set(
    mocks
      .filter((m) => m.items >= policy.streak.min_items_per_credit && multiplier(m.status, policy) > 0)
      .map((m) => m.date),
  );
}

/** Valid streak days in the `target_days` window ending on `asOf` (§5.2 streak score). */
export function streakValidDays(mocks: readonly MockAttempt[], asOf: string, policy: Policy): number {
  const from = addDays(asOf, -(policy.streak.target_days - 1));
  const inWindow = [...creditDays(mocks, policy)].filter((d) => d >= from && d <= asOf);
  return Math.min(inWindow.length * Math.min(1, policy.streak.daily_credit_cap), policy.streak.target_days);
}

/**
 * Days without a credit in the last `trend.streak_window_days` (§7.5), or null when the student has
 * no recent practice habit to break (no credit in the previous 60 days).
 */
export function streakGapDays(mocks: readonly MockAttempt[], asOf: string, policy: Policy): number | null {
  const days = creditDays(mocks, policy);
  const window = policy.trend.streak_window_days;
  const recent = [...days].filter((d) => d > addDays(asOf, -60) && d <= asOf);
  if (recent.length === 0) return null;
  let gaps = 0;
  for (let i = 0; i < window; i++) if (!days.has(addDays(asOf, -i))) gaps++;
  return gaps;
}
