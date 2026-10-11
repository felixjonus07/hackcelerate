/**
 * Golden evaluation set (§15.3): 60 records with the persona and band their designers intended. It runs on
 * every model, prompt or policy change; a failure means the engine or the intent is wrong.
 */
import { describe, expect, it } from "vitest";
import { templatedNarrative } from "../../llm/fallback";
import { buildFacts } from "../../llm/prompt";
import { validateNarrative } from "../../llm/validator";
import { loadPolicyFile } from "../../policy/file";
import { evaluate } from "..";
import { GOLDEN_SET } from "../golden-set";

const policy = loadPolicyFile();

describe("the golden set", () => {
  it("has 60 distinct synthetic records covering every persona, band and track", () => {
    expect(GOLDEN_SET).toHaveLength(60);
    expect(new Set(GOLDEN_SET.map((c) => c.id)).size).toBe(60);
    expect(new Set(GOLDEN_SET.map((c) => c.facts.studentId)).size).toBe(60);
    const personas = new Set(GOLDEN_SET.map((c) => c.expect.persona));
    for (const p of [
      "detention_threat_builder",
      "aspiration_mismatch",
      "false_positive_high_flyer",
      "drifting_student",
      null,
    ])
      expect(personas.has(p as never)).toBe(true);
    expect(new Set(GOLDEN_SET.map((c) => c.expect.band))).toEqual(new Set(["LOW", "MODERATE", "CRITICAL"]));
    expect(new Set(GOLDEN_SET.map((c) => c.facts.aspiration.track).filter(Boolean)).size).toBe(6);
  });

  describe.each(GOLDEN_SET)("$id: $title", (c) => {
    const e = evaluate(c.facts, policy);
    it("gets the persona and the index its designer intended", () => {
      expect(e.primaryPersona).toBe(c.expect.persona);
      expect(e.aegIndex).toBe(c.expect.band);
      expect(e.scoreShown).toBe(c.expect.scoreShown);
      if (c.expect.alsoMatched)
        expect(e.personas.map((p) => p.persona)).toEqual(expect.arrayContaining(c.expect.alsoMatched));
      if (c.expect.attendanceFlag !== undefined) expect(e.attendanceCriticalFlag).toBe(c.expect.attendanceFlag);
      if (c.expect.watchBand !== undefined) expect(e.watchBand).toBe(c.expect.watchBand);
    });
    it("is reproducible and its rules-only narrative passes the validator untouched", () => {
      expect(JSON.stringify(evaluate(structuredClone(c.facts), policy))).toBe(JSON.stringify(e));
      const input = {
        evaluationId: c.id,
        pseudonymousId: c.facts.studentId,
        departmentName: c.facts.department,
        evaluation: e,
        evidence: c.facts.evidence,
        remediation: [
          {
            id: "r",
            title: "Add the item with the largest weight",
            action: "Pick the largest missing item and add it.",
            defaultTargetDays: 14,
          },
        ],
      };
      const { layer } = buildFacts(input, policy);
      const v = validateNarrative(JSON.stringify(templatedNarrative(input, policy)), layer);
      expect(v.ok).toBe(true);
      expect(v.removed).toEqual([]);
    });
  });
});
