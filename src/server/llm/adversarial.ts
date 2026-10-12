/**
 * Adversarial harness (§9.2, §15.2): replays recorded model outputs through the real prompt builder,
 * validator, retry and fallback logic. Shared by the Vitest suite and the contract-metrics report.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Policy } from "../policy/schema";
import { evaluate } from "../rules";
import { ME_27 } from "../rules/fixtures";
import type { ModelCall } from "./adapter";
import { generateNarrative, type NarrativeResult } from "./narrative";
import { canon } from "./text";

export interface Case {
  id: string;
  title: string;
  source: "Appendix C" | "extended";
  /** Written into the free-text description of one evidence item, where a student could write it. */
  student_text: string;
  /** What a compromised model returned for the risk summary. */
  risk?: string;
  /** Output that must not parse or must not match the schema. */
  raw?: "fence" | "preamble" | { extra: Record<string, unknown> } | { only: Record<string, unknown> };
  /** The retry returns a clean output. */
  second?: "clean";
  expect: {
    fallback?: boolean;
    attempts?: number;
    first_attempt_ok?: boolean;
    removed?: string[];
    absent?: string[];
    present?: string[];
    prompt_absent?: string[];
    prompt_present?: string[];
    prompt_max_run?: number;
    truncated?: boolean;
    fence_once?: boolean;
  };
}

export const CLEAN = {
  evaluation_id: "eval-me27",
  risk_summary:
    "Your Corporate Placement score is 48.1 against a readiness of 70 [ev:score] [ev:readiness]. Your SolidWorks lab is verified [ev:ev-me27-sw].",
  department_context_analysis: "Domain practical evidence carries weight 30 [ev:comp:domain_practical_evidence].",
  prescriptive_action_plan: [
    {
      step_number: 1,
      title: "Take the timed GD&T assessment",
      action: "Book the timed assessment.",
      target_days: 14,
      evidence_refs: ["comp:domain_practical_evidence"],
    },
  ],
  career_pivot_advisory: { reasoning: "No change of track is suggested [ev:gap]." },
};

export const loadCases = (): Case[] =>
  (JSON.parse(readFileSync(join(__dirname, "recordings/adversarial.json"), "utf8")) as { cases: Case[] }).cases;

/** The model output recorded for the given attempt (1 or 2) of a case. */
export function outputFor(c: Case, attempt: number): string {
  if (attempt === 2 && c.second === "clean") return JSON.stringify(CLEAN);
  if (c.raw === "fence") return `\`\`\`json\n${JSON.stringify(CLEAN)}\n\`\`\``;
  if (c.raw === "preamble") return `Sure! Here is the JSON you asked for: ${JSON.stringify(CLEAN)}`;
  if (c.raw && typeof c.raw === "object" && "only" in c.raw) return JSON.stringify(c.raw.only);
  if (c.raw && typeof c.raw === "object" && "extra" in c.raw) return JSON.stringify({ ...CLEAN, ...c.raw.extra });
  return JSON.stringify({ ...CLEAN, ...(c.risk ? { risk_summary: c.risk } : {}) });
}

export const factsInput = (policy: Policy, studentText: string) => ({
  evaluationId: "eval-me27",
  pseudonymousId: "ME-27",
  departmentName: "Mechanical",
  evaluation: evaluate(ME_27, policy),
  evidence: ME_27.evidence.map((e) => ({ ...e, description: e.id === "ev-me27-sw" ? studentText : null })),
  remediation: [
    {
      id: "rem-gdt",
      title: "Take the timed GD&T assessment",
      action: "Complete a timed GD&T assessment on the platform.",
      defaultTargetDays: 14,
    },
  ],
});

export async function runCase(c: Case, policy: Policy) {
  const sent: { role: string; content: string }[][] = [];
  let n = 0;
  const result = await generateNarrative(factsInput(policy, c.student_text), policy, {
    enabled: true,
    cache: null,
    callModel: async (messages) => {
      sent.push(messages);
      n++;
      return {
        provider: "openrouter",
        model: "recorded",
        temperature: 0,
        promptVersion: "test",
        latencyMs: 0,
        content: outputFor(c, n),
      } as ModelCall;
    },
  });
  return { result, sent };
}

/** Did the narrative do what the injected text asked? True if anything the case says must be absent is present. */
export function followedInjection(c: Case, result: NarrativeResult): boolean {
  const text = canon(JSON.stringify(result.narrative));
  return (c.expect.absent ?? []).some((a) => text.includes(canon(a)));
}
