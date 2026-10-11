/**
 * Validation pipeline (§9.3), six checks in order:
 * 1 parse → 2 schema → 3 evidence refs → 4 numeric fidelity → 5 forbidden content → 6 tone/length.
 * Removing a sentence is preferred to rejecting the whole output.
 */
import type { FactsLayer } from "./prompt";
import { type Narrative, narrativeSchema } from "./schema";

export const FORBIDDEN_TERMS = [
  // protected attributes (§9.3 step 5, Appendix A rule 4)
  "caste",
  "religion",
  "religious",
  "disability",
  "disabled",
  "gender",
  "sexuality",
  "sexual orientation",
  "family income",
  "home region",
  // diagnostic terms
  "depressed",
  "depression",
  "anxiety",
  "anxious",
  "mental health",
  "disorder",
  "adhd",
  "bipolar",
  // labels (§14.3)
  "drifting",
  "failure",
  "failing",
  "lazy",
  "weak",
  "at risk",
  "at-risk",
  "detention threat",
  "topper",
  "chances are zero",
  "you must",
  // persona names must never reach a student
  "high flyer",
  "false-positive",
  "aspiration mismatch",
  "detention threat builder",
];

export type CheckName = "parse" | "schema" | "evidence_refs" | "numeric_fidelity" | "forbidden_content" | "tone_length";

export interface ValidationResult {
  ok: boolean;
  narrative: Narrative | null;
  failedAt?: "parse" | "schema";
  error?: string;
  removed: { field: string; sentence: string; check: CheckName }[];
  warnings: string[];
}

const REF = /\[ev:([^\]]+)\]/g;
const splitSentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length);

function allowedNumbers(facts: FactsLayer): Set<string> {
  const out = new Set<string>();
  const add = (n: number) => {
    out.add(String(n));
    out.add(n.toFixed(1));
    out.add(n.toFixed(0));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) add(Number(m[0]));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts.facts);
  walk(facts.remediation_library);
  for (let i = 1; i <= 3; i++) add(i); // step numbers
  return out;
}

export function validateNarrative(raw: string, facts: FactsLayer): ValidationResult {
  const removed: ValidationResult["removed"] = [];
  const warnings: string[] = [];

  // 1. Parse
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      narrative: null,
      failedAt: "parse",
      error: String(e),
      removed,
      warnings,
    };
  }
  // 2. Schema
  const parsed = narrativeSchema.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      narrative: null,
      failedAt: "schema",
      error: parsed.error.message,
      removed,
      warnings,
    };

  const n = structuredClone(parsed.data);
  const ids = new Set(facts.facts.map((f) => f.id));
  const numbers = allowedNumbers(facts);

  const checkSentence = (s: string): CheckName | null => {
    // 3. Evidence references: at least one, and every one must exist.
    const refs = [...s.matchAll(REF)].map((m) => m[1]);
    if (!refs.length || refs.some((r) => !ids.has(r))) return "evidence_refs";
    // 4. Numeric fidelity: every number must come from the facts.
    const bare = s.replace(REF, "");
    for (const m of bare.matchAll(/\d+(?:\.\d+)?/g))
      if (!numbers.has(m[0]) && !numbers.has(String(Number(m[0])))) return "numeric_fidelity";
    // 5. Forbidden content.
    const lower = bare.toLowerCase();
    if (FORBIDDEN_TERMS.some((t) => lower.includes(t))) return "forbidden_content";
    return null;
  };

  const cleanField = (field: string, text: string) =>
    splitSentences(text)
      .filter((s) => {
        const failed = checkSentence(s);
        if (failed) removed.push({ field, sentence: s, check: failed });
        return !failed;
      })
      .join(" ");

  n.risk_summary = cleanField("risk_summary", n.risk_summary);
  n.department_context_analysis = cleanField("department_context_analysis", n.department_context_analysis);
  n.career_pivot_advisory.reasoning = cleanField("career_pivot_advisory.reasoning", n.career_pivot_advisory.reasoning);
  n.prescriptive_action_plan = n.prescriptive_action_plan.filter((step) => {
    const bad = step.evidence_refs.some((r) => !ids.has(r));
    const text = `${step.title}. ${step.action}`.toLowerCase();
    const forbidden = FORBIDDEN_TERMS.some((t) => text.includes(t));
    if (bad || forbidden)
      removed.push({
        field: `action_plan.${step.step_number}`,
        sentence: step.title,
        check: bad ? "evidence_refs" : "forbidden_content",
      });
    return !bad && !forbidden;
  });

  // 6. Tone and length — warnings only.
  const words = n.risk_summary.split(/\s+/).filter(Boolean);
  const avgWordLen = words.reduce((s, w) => s + w.length, 0) / Math.max(1, words.length);
  if (avgWordLen > 6.5) warnings.push("Reading level may be high for a student audience");
  if (n.risk_summary.length < 40) warnings.push("Risk summary is very short after validation");

  const requiredEmpty = !n.risk_summary || n.prescriptive_action_plan.length === 0;
  return {
    ok: !requiredEmpty,
    narrative: n,
    removed,
    warnings: requiredEmpty
      ? [...warnings, "Required field empty after validation; fallback used for that field"]
      : warnings,
  };
}
