/**
 * Track score and confidence (§5.6).
 * track_success_score = Σ(component score × weight) / 100, full precision.
 */
import type { Policy, TrackId } from "../policy/schema";
import { checkGate, componentLabel, RUBRICS } from "./rubrics";
import type { ComponentResult, Confidence, StudentFacts, TrackScore } from "./types";

export function scoreTrack(track: TrackId, facts: StudentFacts, policy: Policy): TrackScore {
  const spec = policy.tracks[track];
  if (!spec) throw new Error(`Track ${track} is not defined in policy ${policy.policy_version}`);
  const calcs = RUBRICS[track];

  const components: ComponentResult[] = Object.entries(spec.components).map(([key, weight]) => {
    const calc = calcs[key];
    if (!calc) throw new Error(`No calculator for ${track}.${key}`);
    const r = calc(facts, policy, { track, key });
    return {
      key,
      label: componentLabel(key),
      weight,
      score: r.score,
      contribution: (r.score * weight) / 100,
      evidenceRefs: r.evidenceRefs,
      dataGaps: r.dataGaps,
      ...(r.missingItems ? { missingItems: r.missingItems } : {}),
      ...(r.subMeasures?.length ? { subMeasures: r.subMeasures } : {}),
      calculation: r.calculation,
    };
  });

  const score = components.reduce((s, c) => s + c.contribution, 0);
  const dataGaps = components.flatMap((c) => c.dataGaps);
  const reducedWeightEvidence = facts.evidence
    .filter((e) => e.status === "SELF_REPORTED" || e.status === "LIVE_UNVERIFIED")
    .map((e) => e.id);

  return {
    track,
    rubricVersion: spec.rubric_version,
    components,
    score,
    gateFailed: checkGate(track, facts, policy),
    dataGaps,
    reducedWeightEvidence,
    confidence: confidenceFor(dataGaps.length, reducedWeightEvidence.length, facts, policy),
  };
}

export function confidenceFor(gaps: number, reduced: number, facts: StudentFacts, policy: Policy): Confidence {
  if (gaps > policy.confidence.medium_max_gaps || (facts.recentSourceFailures ?? 0) > 0) return "LOW";
  // More than two missing attendance weeks cap confidence at MEDIUM, and further still at LOW (§4.3).
  const cap = facts.dataQuality?.attendanceCap;
  if (cap === "LOW") return "LOW";
  if (cap === "MEDIUM") return "MEDIUM";
  if (gaps === 0 && reduced === 0) return "HIGH";
  return "MEDIUM";
}
