/**
 * Rules-only templated narrative (§9.4). Used when the model is unavailable
 * or validation fails twice. Good enough for a mentor to act on.
 */
import type { Policy } from "../policy/schema";
import { round1 } from "../rules/normalize";
import type { FactsInput } from "./prompt";
import type { Narrative } from "./schema";

export const FALLBACK_NOTICE = "Narrative generated from rules; AI narrative unavailable.";

const GAP_PHRASE = {
  LOW: "close to the target",
  MODERATE: "a moderate distance from the target",
  CRITICAL: "a large distance from the target",
} as const;

export function templatedNarrative(input: FactsInput, policy: Policy): Narrative {
  const e = input.evaluation;
  const t = e.trackScore;
  const trackName = policy.tracks[t.track]?.name ?? t.track;
  const weakest = [...t.components].sort((a, b) => a.score * a.weight - b.score * b.weight).slice(0, 2);
  const steps = input.remediation.slice(0, 3).map((r, i) => ({
    step_number: i + 1,
    title: r.title.slice(0, 80),
    action: r.action.slice(0, 400),
    target_days: Math.min(
      policy.llm.target_days_range[1],
      Math.max(policy.llm.target_days_range[0], r.defaultTargetDays),
    ),
    evidence_refs: [weakest[i]?.key ? `comp:${weakest[i].key}` : "score"],
  }));
  return {
    evaluation_id: input.evaluationId,
    risk_summary:
      `Your ${trackName} score is ${round1(t.score)} against a readiness level of ${e.readiness} [ev:score] [ev:readiness]. ` +
      `That places you ${GAP_PHRASE[e.aegIndex]} [ev:gap].` +
      (t.dataGaps.length
        ? ` ${t.dataGaps.length === 1 ? "One item is" : "Multiple items are"} not yet evidenced [ev:gap:1].`
        : ""),
    department_context_analysis: weakest
      .map((c) => `${c.label} currently scores ${round1(c.score)} with weight ${c.weight} [ev:comp:${c.key}].`)
      .join(" "),
    prescriptive_action_plan: steps.length
      ? steps
      : [
          {
            step_number: 1,
            title: "Add evidence for your largest gap",
            action: "Pick the item with the largest weight that has no evidence yet and add it.",
            target_days: 14,
            evidence_refs: ["score"],
          },
        ],
    career_pivot_advisory: {
      reasoning: e.pivot.recommended
        ? `${e.pivot.reasons.map((r, i) => `${r} [ev:pivot:${i + 1}].`).join(" ")} You choose whether to change track [ev:gap].`
        : "No change of track is suggested at this point [ev:gap].",
    },
  };
}
