/**
 * Full evaluation for one student under one policy version. Deterministic:
 * the same facts and policy always produce the same Evaluation (§1.3).
 */
import type { Policy, TrackId } from "../policy/schema";
import { gapIndex, gapRatio, levelRank, matchPersonas, maxLevel, pivotAdvisory, primaryPersona, trend } from "./aeg";
import { proposeRoutes } from "./routing";
import { scoreTrack } from "./score";
import type { Evaluation, StudentFacts } from "./types";
import { RULES_ENGINE_VERSION } from "./version";

export function evaluate(facts: StudentFacts, policy: Policy, opts: { fallbackTrack?: TrackId } = {}): Evaluation {
  const track = facts.aspiration.track ?? opts.fallbackTrack ?? "corporate_placement";
  const trackScore = scoreTrack(track, facts, policy);
  const readiness = facts.aspiration.readiness ?? policy.readiness_default;
  const ratio = gapRatio(readiness, trackScore.score);
  const gIndex = gapIndex(ratio, policy);

  const { matches, attendanceCriticalFlag, watchBand } = matchPersonas(facts, policy);
  const primary = primaryPersona(matches, policy);
  const personaFloor = matches.reduce<typeof gIndex>((acc, m) => maxLevel(acc, m.floor), "LOW");
  const aegIndex = maxLevel(gIndex, personaFloor);
  const aegDrivenBy = matches.length && levelRank(personaFloor) > levelRank(gIndex) ? "persona" : "gap";

  return {
    studentId: facts.studentId,
    policyVersion: policy.policy_version,
    engineVersion: RULES_ENGINE_VERSION,
    trackScore,
    readiness,
    gapRatio: ratio,
    gapIndex: gIndex,
    personas: matches,
    primaryPersona: primary,
    aegIndex,
    aegDrivenBy,
    attendanceCriticalFlag,
    watchBand,
    trend: trend(facts, policy),
    pivot: pivotAdvisory(facts, track, trackScore.score, gIndex, matches, policy),
    routes: proposeRoutes(matches, primary, attendanceCriticalFlag, policy),
  };
}

/** What-if (§12.1): same engine, hypothetical facts, writes nothing. */
export function whatIf(base: StudentFacts, patch: (f: StudentFacts) => StudentFacts, policy: Policy): Evaluation {
  return evaluate(patch(structuredClone(base)), policy);
}
