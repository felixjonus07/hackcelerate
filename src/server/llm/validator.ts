/**
 * Validation pipeline (§9.3), six checks in order:
 * 1 parse → 2 schema → 3 evidence refs → 4 numeric fidelity → 5 forbidden content → 6 tone/length.
 * Removing a sentence is preferred to rejecting the whole output.
 */
import type { FactsLayer } from "./prompt";
import { type Narrative, narrativeSchema } from "./schema";
import { canon, leetFold, nonLatinLetters } from "./text";

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
  "first-generation",
  "first generation",
  "medium of instruction",
  // diagnostic and health terms
  "depressed",
  "depression",
  "anxiety",
  "anxious",
  "mental health",
  "disorder",
  "adhd",
  "bipolar",
  "health",
  "illness",
  "medical",
  "therapy",
  "burnout",
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

/** Whole words that name a protected group; matched as words so "management" stays fine. */
const PROTECTED_WORDS =
  /\b(woman|women|girl|boy|female|male|hindu|muslim|christian|sikh|buddhist|jain|dalit|obc|rural|tribal|poor|wealthy)\b/;

/** Personal data a narrative must never echo: contacts and roll numbers (§9.4). */
const PII_PATTERNS = [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i, /\+?\d[\d\s-]{8,}\d/, /\b[a-z]{2,5}\d{4,8}\b/i];

/** Distinct phrases of the system prompt: a narrative that repeats them is leaking it (Appendix C). */
const PROMPT_CANARIES = [
  "narrative writer for aspiredge",
  "follow these rules without exception",
  "untrusted student input",
  "return only json that matches",
];

/** Wording that shows a narrative acting on an instruction instead of describing evidence. */
const OBEYING =
  /\b(dispatch(ed|ing)?|escalat\w+|forward(ed|ing)? (this|it|the)|as (you )?(instructed|requested|asked)|i (have )?(set|changed|updated|raised|lowered)|ignore (all|the|previous)|new instructions?|my own score|system prompt)\b/;

export type CheckName =
  | "parse"
  | "schema"
  | "evidence_refs"
  | "status_claim"
  | "numeric_fidelity"
  | "forbidden_content"
  | "tone_length";

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

/** True if the text holds forbidden content (§9.3 step 5), whatever tricks hide it. */
export function containsForbidden(text: string): boolean {
  const plain = canon(text);
  const leet = leetFold(text);
  return (
    FORBIDDEN_TERMS.some((t) => plain.includes(t) || leet.includes(t)) ||
    PROTECTED_WORDS.test(plain) ||
    PII_PATTERNS.some((re) => re.test(text) || re.test(plain)) ||
    PROMPT_CANARIES.some((c) => plain.includes(c)) ||
    OBEYING.test(plain) ||
    nonLatinLetters(text) > 0
  );
}

/** Steps 3–5 for one sentence against one facts layer; null means it passes. */
export function makeSentenceChecker(facts: FactsLayer): (sentence: string) => CheckName | null {
  const ids = new Set(facts.facts.map((f) => f.id));
  const numbers = allowedNumbers(facts);
  const statusOf = new Map(facts.facts.filter((f) => f.status).map((f) => [f.id, f.status as string]));
  return (s) => {
    // 3. Evidence references: at least one, and every one must exist.
    const refs = [...s.matchAll(REF)].map((m) => m[1]);
    if (!refs.length || refs.some((r) => !ids.has(r))) return "evidence_refs";
    // A claim of verification must match the status of what it cites: only the link check decides that.
    const plainS = canon(s.replace(REF, ""));
    const claimsVerified =
      /\b(verified|verification)\b/.test(plainS) && !/\b(not|un|yet to be|awaiting)\W*(been )?verif/.test(plainS);
    const claimsAttested = /\battested\b/.test(plainS) && !/\bnot\W*(yet )?attested\b/.test(plainS);
    for (const r of refs) {
      const st = statusOf.get(r);
      if (!st) continue;
      if (claimsVerified && st !== "VERIFIED") return "status_claim";
      if (claimsAttested && st !== "ATTESTED") return "status_claim";
    }
    // 4. Numeric fidelity: every number must come from the facts.
    const bare = s.replace(REF, "");
    for (const m of bare.matchAll(/\d+(?:\.\d+)?/g))
      if (!numbers.has(m[0]) && !numbers.has(String(Number(m[0])))) return "numeric_fidelity";
    // 5. Forbidden content.
    return containsForbidden(bare) ? "forbidden_content" : null;
  };
}

export const splitIntoSentences = splitSentences;

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
  const forbidden = containsForbidden;
  const checkSentence = makeSentenceChecker(facts);

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
    const text = `${step.title}. ${step.action}`;
    const badWords = forbidden(text);
    if (bad || badWords)
      removed.push({
        field: `action_plan.${step.step_number}`,
        sentence: step.title,
        check: bad ? "evidence_refs" : "forbidden_content",
      });
    return !bad && !badWords;
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
