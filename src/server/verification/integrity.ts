/**
 * Evidence integrity checks (§6.3).
 *
 * CRITICAL RULE: Integrity flags NEVER directly change scores.
 * They produce review-only flags for mentors. Each pattern has
 * innocent explanations; automatic penalties are worse than delayed review.
 *
 * Five checks from the reference plan:
 * 1. Implausible speed — median seconds per item below thresholds
 * 2. Burst commits — 25+ commits/minute or 80% in 24h with no prior activity
 * 3. Duplicate claim — same repo/DOI/cert claimed by two students
 * 4. Streak padding — daily credit requires ≥15 items per mock
 * 5. Reused text — identical description content hash across students
 */
import { createHash } from "node:crypto";
import type { Policy } from "../policy/schema";

/* ────────────────── Types ────────────────── */

export type IntegrityCheckType =
  | "implausible_speed"
  | "burst_commits"
  | "duplicate_claim"
  | "streak_padding"
  | "reused_text";

export interface IntegrityFlag {
  check: IntegrityCheckType;
  /** The subject (artifact ID, mock ID, student ID, etc.). */
  subjectId: string;
  /** Non-sensitive description of the finding. */
  detail: string;
  /** Additional student IDs involved (for duplicate claims). */
  relatedStudentIds?: string[];
  /** The policy thresholds that triggered the flag. */
  ruleParams?: Record<string, unknown>;
}

/* ────────────────── 1. Implausible speed ────────────────── */

export interface MockAttemptInput {
  id: string;
  studentId: string;
  itemKind: string; // "mcq" | "numerical" | etc.
  items: number;
  avgSecondsPerItem: number;
}

/**
 * Flags mock attempts where median seconds per item is below the policy threshold.
 * §6.3: min_seconds_per_mcq = 5, min_seconds_per_numerical = 15.
 */
export function checkImplausibleSpeed(
  attempts: MockAttemptInput[],
  policy: Pick<Policy, "integrity">,
): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];

  for (const attempt of attempts) {
    const kind = attempt.itemKind.toLowerCase();
    let threshold: number;

    if (kind === "mcq" || kind === "mcqs" || kind === "multiple_choice") {
      threshold = policy.integrity.min_seconds_per_mcq;
    } else if (kind === "numerical" || kind === "numeric") {
      threshold = policy.integrity.min_seconds_per_numerical;
    } else {
      // Unknown kind — use the more generous threshold
      threshold = policy.integrity.min_seconds_per_numerical;
    }

    if (attempt.avgSecondsPerItem < threshold) {
      flags.push({
        check: "implausible_speed",
        subjectId: attempt.id,
        detail: `Average ${attempt.avgSecondsPerItem.toFixed(1)}s per ${kind} item is below the ${threshold}s threshold`,
        ruleParams: { threshold, actual: attempt.avgSecondsPerItem, kind },
      });
    }
  }

  return flags;
}

/* ────────────────── 2. Burst commits ────────────────── */

export interface CommitTimestamp {
  /** ISO 8601 timestamp. */
  timestamp: string;
}

export interface BurstCommitInput {
  artifactId: string;
  studentId: string;
  commits: CommitTimestamp[];
}

/**
 * Flags repositories with suspicious commit bursts.
 * §6.3: 25+ commits in one minute, or 80% of commits in 24h with no earlier activity.
 */
export function checkBurstCommits(input: BurstCommitInput, policy: Pick<Policy, "integrity">): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];
  const { commits } = input;

  if (commits.length < 2) return flags;

  // Sort by timestamp
  const sorted = commits
    .map((c) => ({ ts: new Date(c.timestamp).getTime() }))
    .filter((c) => !Number.isNaN(c.ts))
    .sort((a, b) => a.ts - b.ts);

  if (sorted.length < 2) return flags;

  const burstPerMinute = policy.integrity.burst_commits_per_minute; // default 25
  const burstShare24h = policy.integrity.burst_share_24h; // default 0.8

  // Check 1: N+ commits within one minute
  for (let i = 0; i < sorted.length; i++) {
    let count = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].ts - sorted[i].ts <= 60_000) {
        count++;
      } else {
        break;
      }
    }
    if (count >= burstPerMinute) {
      flags.push({
        check: "burst_commits",
        subjectId: input.artifactId,
        detail: `${count} commits within one minute (threshold: ${burstPerMinute})`,
        ruleParams: { burstPerMinute, actual: count },
      });
      break; // One flag per artifact
    }
  }

  // Check 2: 80%+ of commits within any 24h window with no earlier activity
  const totalCommits = sorted.length;
  const firstTs = sorted[0].ts;

  for (let i = 0; i < sorted.length; i++) {
    const windowStart = sorted[i].ts;
    const windowEnd = windowStart + 24 * 60 * 60 * 1000;

    let inWindow = 0;
    for (const c of sorted) {
      if (c.ts >= windowStart && c.ts <= windowEnd) inWindow++;
    }

    const share = inWindow / totalCommits;

    // "No earlier activity" means the window starts at or near the first commit
    const noEarlierActivity = i === 0 || sorted[i].ts - firstTs < 60_000;

    if (share >= burstShare24h && noEarlierActivity && totalCommits >= 5) {
      flags.push({
        check: "burst_commits",
        subjectId: input.artifactId,
        detail: `${(share * 100).toFixed(0)}% of ${totalCommits} commits in a 24h window with no prior activity (threshold: ${burstShare24h * 100}%)`,
        ruleParams: { burstShare24h, actual: share, totalCommits },
      });
      break;
    }
  }

  return flags;
}

/* ────────────────── 3. Duplicate claim ────────────────── */

export interface ClaimInput {
  artifactId: string;
  studentId: string;
  /** Normalized identifier: canonical repo URL, DOI, or certificate ID. */
  normalizedIdentifier: string;
}

/**
 * Detects duplicate evidence claims — same resource claimed by different students.
 * §6.3: Same repository, DOI, or certificate ID claimed by two students.
 * Both claims are flagged; both keep their current status until reviewed.
 */
export function checkDuplicateClaims(claims: ClaimInput[]): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];
  const byIdentifier = new Map<string, ClaimInput[]>();

  for (const c of claims) {
    const key = c.normalizedIdentifier.toLowerCase().trim();
    if (!key) continue;
    const existing = byIdentifier.get(key) ?? [];
    existing.push(c);
    byIdentifier.set(key, existing);
  }

  for (const [identifier, group] of byIdentifier) {
    // Only flag when different students claim the same resource
    const uniqueStudents = new Set(group.map((c) => c.studentId));
    if (uniqueStudents.size < 2) continue;

    for (const claim of group) {
      const otherStudents = group.filter((c) => c.studentId !== claim.studentId).map((c) => c.studentId);

      flags.push({
        check: "duplicate_claim",
        subjectId: claim.artifactId,
        detail: `Same resource "${identifier}" claimed by ${uniqueStudents.size} students`,
        relatedStudentIds: otherStudents,
        ruleParams: { identifier, claimCount: uniqueStudents.size },
      });
    }
  }

  return flags;
}

/* ────────────────── 4. Streak padding ────────────────── */

export interface StreakMockInput {
  mockId: string;
  studentId: string;
  items: number;
  takenAt: string; // ISO date
}

/**
 * Checks streak padding: daily credit requires one complete mock of ≥15 items.
 * §6.3: No credit for the day. No flag is raised — just deny the streak credit.
 *
 * Returns the set of dates where streak credit should NOT be awarded.
 */
export function checkStreakPadding(
  mocks: StreakMockInput[],
  policy: Pick<Policy, "streak">,
): { date: string; reason: string }[] {
  const deniedDates: { date: string; reason: string }[] = [];
  const minItems = policy.streak.min_items_per_credit; // default 15

  // Group by date
  const byDate = new Map<string, StreakMockInput[]>();
  for (const m of mocks) {
    const date = m.takenAt.slice(0, 10); // YYYY-MM-DD
    const existing = byDate.get(date) ?? [];
    existing.push(m);
    byDate.set(date, existing);
  }

  for (const [date, dayMocks] of byDate) {
    // Check if any mock on this day has enough items
    const hasQualifying = dayMocks.some((m) => m.items >= minItems);
    if (!hasQualifying) {
      deniedDates.push({
        date,
        reason: `No mock with ≥${minItems} items on ${date} (best: ${Math.max(...dayMocks.map((m) => m.items))} items)`,
      });
    }
  }

  return deniedDates;
}

/* ────────────────── 5. Reused text ────────────────── */

/**
 * Computes a SHA-256 content hash for text evidence.
 * Normalizes whitespace and line endings before hashing.
 */
export function contentHash(text: string): string {
  // Normalize: trim, collapse whitespace, normalize line endings
  const normalized = text
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");

  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export interface TextEvidenceInput {
  artifactId: string;
  studentId: string;
  text: string;
}

/**
 * Detects reused text across student artifacts using content hashes.
 * §6.3: Identical project description in two students' artifacts → flag for mentor review.
 */
export function checkReusedText(evidence: TextEvidenceInput[]): IntegrityFlag[] {
  const flags: IntegrityFlag[] = [];
  const byHash = new Map<string, TextEvidenceInput[]>();

  for (const e of evidence) {
    if (!e.text || e.text.trim().length < 50) continue; // Skip trivially short text
    const hash = contentHash(e.text);
    const existing = byHash.get(hash) ?? [];
    existing.push(e);
    byHash.set(hash, existing);
  }

  for (const [hash, group] of byHash) {
    const uniqueStudents = new Set(group.map((e) => e.studentId));
    if (uniqueStudents.size < 2) continue;

    for (const evidence of group) {
      const otherStudents = group.filter((e) => e.studentId !== evidence.studentId).map((e) => e.studentId);

      flags.push({
        check: "reused_text",
        subjectId: evidence.artifactId,
        detail: `Identical text content (hash: ${hash.slice(0, 12)}…) found in ${uniqueStudents.size} students' artifacts`,
        relatedStudentIds: otherStudents,
        ruleParams: { hashPrefix: hash.slice(0, 16) },
      });
    }
  }

  return flags;
}
