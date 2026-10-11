/**
 * Integrity checks (§6.3). Output is a flag for human review — a flag never
 * changes a score.
 */
import type { Policy } from "../policy/schema";
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

/** Streak credit (§6.3 streak padding): one complete mock of ≥ N items per day. */
export function streakCreditDays(mocks: MockAttempt[], policy: Policy): number {
  const days = new Set(mocks.filter((m) => m.items >= policy.streak.min_items_per_credit).map((m) => m.date));
  return Math.min(days.size, policy.streak.target_days);
}
