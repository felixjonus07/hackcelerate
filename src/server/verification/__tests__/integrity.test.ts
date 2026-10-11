/**
 * Tests for integrity checks (§6.3).
 * CRITICAL: Integrity flags must NEVER directly change scores.
 */
import { describe, expect, it } from "vitest";
import {
  checkBurstCommits,
  checkDuplicateClaims,
  checkImplausibleSpeed,
  checkReusedText,
  checkStreakPadding,
  contentHash,
  type MockAttemptInput,
  type BurstCommitInput,
  type ClaimInput,
  type StreakMockInput,
  type TextEvidenceInput,
} from "../integrity";

const POLICY = {
  integrity: {
    min_seconds_per_mcq: 5,
    min_seconds_per_numerical: 15,
    burst_commits_per_minute: 25,
    burst_share_24h: 0.8,
  },
  streak: {
    target_days: 30,
    min_items_per_credit: 15,
    daily_credit_cap: 1,
  },
};

describe("§6.3 Implausible speed", () => {
  it("flags MCQ attempts below 5s per item", () => {
    const attempts: MockAttemptInput[] = [
      { id: "m1", studentId: "s1", itemKind: "mcq", items: 30, avgSecondsPerItem: 3 },
    ];
    const flags = checkImplausibleSpeed(attempts, POLICY);
    expect(flags).toHaveLength(1);
    expect(flags[0].check).toBe("implausible_speed");
    expect(flags[0].detail).toContain("3.0s");
    expect(flags[0].detail).toContain("5s");
  });

  it("flags numerical attempts below 15s per item", () => {
    const attempts: MockAttemptInput[] = [
      { id: "m2", studentId: "s1", itemKind: "numerical", items: 20, avgSecondsPerItem: 10 },
    ];
    const flags = checkImplausibleSpeed(attempts, POLICY);
    expect(flags).toHaveLength(1);
    expect(flags[0].check).toBe("implausible_speed");
  });

  it("does not flag normal speed", () => {
    const attempts: MockAttemptInput[] = [
      { id: "m3", studentId: "s1", itemKind: "mcq", items: 30, avgSecondsPerItem: 8 },
      { id: "m4", studentId: "s1", itemKind: "numerical", items: 20, avgSecondsPerItem: 20 },
    ];
    const flags = checkImplausibleSpeed(attempts, POLICY);
    expect(flags).toHaveLength(0);
  });

  it("does not flag exactly at threshold", () => {
    const attempts: MockAttemptInput[] = [
      { id: "m5", studentId: "s1", itemKind: "mcq", items: 30, avgSecondsPerItem: 5 },
    ];
    const flags = checkImplausibleSpeed(attempts, POLICY);
    expect(flags).toHaveLength(0);
  });
});

describe("§6.3 Burst commits", () => {
  it("flags 25+ commits in one minute", () => {
    const baseTime = new Date("2026-10-10T10:00:00Z").getTime();
    const commits = Array.from({ length: 30 }, (_, i) => ({
      timestamp: new Date(baseTime + i * 1000).toISOString(), // 1 commit/sec for 30 seconds
    }));
    const input: BurstCommitInput = { artifactId: "a1", studentId: "s1", commits };
    const flags = checkBurstCommits(input, POLICY);
    expect(flags.some((f) => f.detail.includes("30 commits within one minute"))).toBe(true);
  });

  it("flags 80%+ in 24h with no earlier activity", () => {
    const baseTime = new Date("2026-10-10T10:00:00Z").getTime();
    // 10 commits all within 2 hours, nothing before
    const commits = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date(baseTime + i * 600_000).toISOString(),
    }));
    const input: BurstCommitInput = { artifactId: "a2", studentId: "s1", commits };
    const flags = checkBurstCommits(input, POLICY);
    expect(flags.some((f) => f.check === "burst_commits" && f.detail.includes("100%"))).toBe(true);
  });

  it("does not flag spread-out commits", () => {
    const commits = [
      { timestamp: "2026-10-01T10:00:00Z" },
      { timestamp: "2026-10-03T10:00:00Z" },
      { timestamp: "2026-10-05T10:00:00Z" },
      { timestamp: "2026-10-07T10:00:00Z" },
      { timestamp: "2026-10-09T10:00:00Z" },
    ];
    const input: BurstCommitInput = { artifactId: "a3", studentId: "s1", commits };
    const flags = checkBurstCommits(input, POLICY);
    expect(flags).toHaveLength(0);
  });

  it("handles empty or single commit gracefully", () => {
    expect(checkBurstCommits({ artifactId: "a4", studentId: "s1", commits: [] }, POLICY)).toHaveLength(0);
    expect(
      checkBurstCommits({ artifactId: "a5", studentId: "s1", commits: [{ timestamp: "2026-10-01T10:00:00Z" }] }, POLICY),
    ).toHaveLength(0);
  });
});

describe("§6.3 Duplicate claims", () => {
  it("flags same DOI claimed by two students", () => {
    const claims: ClaimInput[] = [
      { artifactId: "a1", studentId: "s1", normalizedIdentifier: "10.1234/example" },
      { artifactId: "a2", studentId: "s2", normalizedIdentifier: "10.1234/example" },
    ];
    const flags = checkDuplicateClaims(claims);
    expect(flags).toHaveLength(2); // Both students get a flag
    expect(flags[0].check).toBe("duplicate_claim");
    expect(flags[0].relatedStudentIds).toContain("s2");
    expect(flags[1].relatedStudentIds).toContain("s1");
  });

  it("does not flag same student's repeated claim", () => {
    const claims: ClaimInput[] = [
      { artifactId: "a1", studentId: "s1", normalizedIdentifier: "10.1234/example" },
      { artifactId: "a2", studentId: "s1", normalizedIdentifier: "10.1234/example" },
    ];
    const flags = checkDuplicateClaims(claims);
    expect(flags).toHaveLength(0);
  });

  it("does not flag different identifiers", () => {
    const claims: ClaimInput[] = [
      { artifactId: "a1", studentId: "s1", normalizedIdentifier: "10.1234/example-1" },
      { artifactId: "a2", studentId: "s2", normalizedIdentifier: "10.1234/example-2" },
    ];
    const flags = checkDuplicateClaims(claims);
    expect(flags).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const claims: ClaimInput[] = [
      { artifactId: "a1", studentId: "s1", normalizedIdentifier: "github.com/User/Repo" },
      { artifactId: "a2", studentId: "s2", normalizedIdentifier: "GitHub.com/user/repo" },
    ];
    const flags = checkDuplicateClaims(claims);
    expect(flags).toHaveLength(2);
  });
});

describe("§6.3 Streak padding", () => {
  it("denies credit for day with no qualifying mock", () => {
    const mocks: StreakMockInput[] = [
      { mockId: "m1", studentId: "s1", items: 5, takenAt: "2026-10-10T10:00:00Z" },
    ];
    const denied = checkStreakPadding(mocks, POLICY);
    expect(denied).toHaveLength(1);
    expect(denied[0].date).toBe("2026-10-10");
  });

  it("allows credit for day with ≥15 items", () => {
    const mocks: StreakMockInput[] = [
      { mockId: "m1", studentId: "s1", items: 15, takenAt: "2026-10-10T10:00:00Z" },
    ];
    const denied = checkStreakPadding(mocks, POLICY);
    expect(denied).toHaveLength(0);
  });

  it("allows credit if ANY mock on that day qualifies", () => {
    const mocks: StreakMockInput[] = [
      { mockId: "m1", studentId: "s1", items: 5, takenAt: "2026-10-10T08:00:00Z" },
      { mockId: "m2", studentId: "s1", items: 20, takenAt: "2026-10-10T14:00:00Z" },
    ];
    const denied = checkStreakPadding(mocks, POLICY);
    expect(denied).toHaveLength(0);
  });
});

describe("§6.3 Reused text", () => {
  it("flags identical text across two students", () => {
    const evidence: TextEvidenceInput[] = [
      { artifactId: "a1", studentId: "s1", text: "This is my project description that is long enough to be meaningful for comparison purposes" },
      { artifactId: "a2", studentId: "s2", text: "This is my project description that is long enough to be meaningful for comparison purposes" },
    ];
    const flags = checkReusedText(evidence);
    expect(flags).toHaveLength(2);
    expect(flags[0].check).toBe("reused_text");
    expect(flags[0].relatedStudentIds).toContain("s2");
  });

  it("does not flag same student's text", () => {
    const evidence: TextEvidenceInput[] = [
      { artifactId: "a1", studentId: "s1", text: "This is my project description that is long enough to be meaningful for comparison purposes" },
      { artifactId: "a2", studentId: "s1", text: "This is my project description that is long enough to be meaningful for comparison purposes" },
    ];
    const flags = checkReusedText(evidence);
    expect(flags).toHaveLength(0);
  });

  it("does not flag short text", () => {
    const evidence: TextEvidenceInput[] = [
      { artifactId: "a1", studentId: "s1", text: "Short" },
      { artifactId: "a2", studentId: "s2", text: "Short" },
    ];
    const flags = checkReusedText(evidence);
    expect(flags).toHaveLength(0);
  });

  it("normalizes whitespace before hashing", () => {
    const text1 = "This is a long enough text\r\nwith  different    whitespace   that is meaningful for hashing purposes";
    const text2 = "This is a long enough text\nwith different whitespace that is meaningful for hashing purposes";
    expect(contentHash(text1)).toBe(contentHash(text2));
  });
});

describe("§6.3 Integrity flags are review-only", () => {
  it("flags never contain score changes", () => {
    // All five check types produce flags — none contain score values or score modification instructions
    const speedFlags = checkImplausibleSpeed(
      [{ id: "m1", studentId: "s1", itemKind: "mcq", items: 30, avgSecondsPerItem: 2 }],
      POLICY,
    );
    const burstFlags = checkBurstCommits(
      {
        artifactId: "a1",
        studentId: "s1",
        commits: Array.from({ length: 30 }, (_, i) => ({
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
        })),
      },
      POLICY,
    );
    const dupFlags = checkDuplicateClaims([
      { artifactId: "a1", studentId: "s1", normalizedIdentifier: "10.1234/x" },
      { artifactId: "a2", studentId: "s2", normalizedIdentifier: "10.1234/x" },
    ]);
    const textFlags = checkReusedText([
      { artifactId: "a1", studentId: "s1", text: "A".repeat(100) },
      { artifactId: "a2", studentId: "s2", text: "A".repeat(100) },
    ]);

    const allFlags = [...speedFlags, ...burstFlags, ...dupFlags, ...textFlags];

    for (const flag of allFlags) {
      // Flags have: check, subjectId, detail — NO score, NO score change, NO multiplier change
      expect(flag).not.toHaveProperty("score");
      expect(flag).not.toHaveProperty("scoreChange");
      expect(flag).not.toHaveProperty("multiplier");
      expect(flag).not.toHaveProperty("newScore");
      expect(flag.check).toBeTruthy();
      expect(flag.subjectId).toBeTruthy();
      expect(flag.detail).toBeTruthy();
    }
  });
});
