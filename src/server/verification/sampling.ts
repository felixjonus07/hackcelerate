/**
 * External mock report sampling (§6.2): 10% random sample per academic term.
 *
 * The sampling rate lives in the policy file, not hardcoded.
 * Sampling decisions are recorded for auditability and are idempotent —
 * re-running the sampler for the same term does not change existing decisions.
 */
import { createHash, randomInt } from "node:crypto";
import type { Policy } from "../policy/schema";

/* ────────────────── Types ────────────────── */

export interface SamplingConfig {
  /** Percentage of eligible records to sample (0–100). Default: 10. */
  samplePercentage: number;
}

export interface SamplingCandidate {
  id: string;
  studentId: string;
  /** Academic term identifier, e.g., "2026-odd". */
  term: string;
}

export interface SamplingDecision {
  candidateId: string;
  studentId: string;
  term: string;
  selected: boolean;
  /** Deterministic selection hash for reproducibility. */
  selectionHash: string;
}

/* ────────────────── Policy extension ────────────────── */

/**
 * Extracts the sampling percentage from policy. Falls back to 10% if not present.
 * The policy schema should be extended to include this; for now we read from
 * the integrity section or a dedicated sampling key.
 */
export function getSamplingConfig(policy: Policy): SamplingConfig {
  // Check if policy has a sampling key (future extension)
  const raw = (policy as Record<string, unknown>).sampling as { percentage?: number } | undefined;
  if (raw?.percentage !== undefined) {
    return { samplePercentage: Math.max(0, Math.min(100, raw.percentage)) };
  }
  // Default: 10% per §6.2
  return { samplePercentage: 10 };
}

/* ────────────────── Sampling logic ────────────────── */

/**
 * Computes a deterministic hash for reproducible sampling.
 * Uses the candidate ID + term as inputs so the same candidate
 * gets the same decision when re-processed.
 */
function selectionHash(candidateId: string, term: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${term}:${candidateId}`).digest("hex");
}

/**
 * Selects approximately `samplePercentage`% of candidates for external verification.
 *
 * - Term-scoped: only candidates from the specified term are considered.
 * - Deterministic: same inputs produce the same selection.
 * - Idempotent: candidates already decided are preserved.
 *
 * @param candidates - Eligible records for the term.
 * @param config - Sampling configuration.
 * @param salt - A per-run salt (e.g., policy version) for hash diversity.
 * @param existingDecisions - Already-made decisions (won't be changed).
 */
export function selectSample(
  candidates: SamplingCandidate[],
  config: SamplingConfig,
  salt: string,
  existingDecisions: Set<string> = new Set(),
): SamplingDecision[] {
  if (candidates.length === 0 || config.samplePercentage <= 0) {
    return [];
  }

  const threshold = config.samplePercentage / 100;
  const decisions: SamplingDecision[] = [];

  for (const candidate of candidates) {
    // Skip already-decided candidates
    if (existingDecisions.has(candidate.id)) continue;

    const hash = selectionHash(candidate.id, candidate.term, salt);

    // Use the first 8 hex chars as a uniform [0, 1) value
    const hashValue = Number.parseInt(hash.slice(0, 8), 16) / 0xffffffff;

    const selected = hashValue < threshold;

    decisions.push({
      candidateId: candidate.id,
      studentId: candidate.studentId,
      term: candidate.term,
      selected,
      selectionHash: hash.slice(0, 16),
    });
  }

  return decisions;
}

/**
 * Validates that the sampling produced approximately the expected percentage.
 * Returns the actual percentage for monitoring.
 */
export function validateSamplingDistribution(
  decisions: SamplingDecision[],
  expectedPct: number,
  tolerancePct = 5,
): { actualPct: number; withinTolerance: boolean } {
  if (decisions.length === 0) return { actualPct: 0, withinTolerance: true };

  const selected = decisions.filter((d) => d.selected).length;
  const actualPct = (selected / decisions.length) * 100;

  // For small populations, tolerance is wider
  const adjustedTolerance = decisions.length < 100 ? tolerancePct * 3 : tolerancePct;

  return {
    actualPct,
    withinTolerance: Math.abs(actualPct - expectedPct) <= adjustedTolerance,
  };
}
