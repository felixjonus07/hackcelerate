/**
 * Phase 5 Exit Gate Test:
 * 1. Adversarial suite zero failures (verified in adversarial.test.ts).
 * 2. Removing OPENROUTER_API_KEY yields valid fallback narratives for all seed records.
 */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/load";
import { evaluate } from "../../rules";
import { CS_44, EE_12, ME_27, SEED_RECORDS } from "../../rules/fixtures";
import type { StudentFacts } from "../../rules/types";
import { FALLBACK_NOTICE, templatedNarrative } from "../fallback";
import { generateNarrative } from "../narrative";
import { buildFacts, type FactsInput } from "../prompt";
import { narrativeSchema } from "../schema";
import { validateNarrative } from "../validator";

const policy = loadPolicyFile("policy/2026.10-v1.json");

const ALL_SEED_RECORDS: { id: string; facts: StudentFacts }[] = [
  { id: "ME-27", facts: ME_27 },
  { id: "CS-44", facts: CS_44 },
  { id: "EE-12", facts: EE_12 },
  ...SEED_RECORDS.map((r) => ({ id: r.facts.studentId, facts: r.facts })),
];

describe("Phase 5 Exit Gate: Offline Fallback Narratives for All Seed Records", () => {
  for (const record of ALL_SEED_RECORDS) {
    it(`produces a valid, schema-compliant fallback narrative for ${record.id}`, async () => {
      const evaluation = evaluate(record.facts, policy);
      const input: FactsInput = {
        evaluationId: `eval-${record.id}`,
        pseudonymousId: record.id,
        departmentName: record.facts.department,
        evaluation,
        evidence: record.facts.evidence,
        remediation: [
          {
            id: `rem-${record.id}-1`,
            title: "Standard Remediation Action",
            action: "Complete the designated department milestone or practice module.",
            defaultTargetDays: 14,
          },
        ],
      };

      // 1. Test direct templated fallback generator
      const fallback = templatedNarrative(input, policy);
      const schemaCheck = narrativeSchema.safeParse(fallback);
      expect(schemaCheck.success).toBe(true);

      const { layer } = buildFacts(input, policy);
      const validationCheck = validateNarrative(JSON.stringify(fallback), layer);
      expect(validationCheck.ok).toBe(true);
      expect(validationCheck.removed).toHaveLength(0);

      // Verify citations are present
      expect(fallback.risk_summary).toMatch(/\[ev:[^\]]+\]/);
      expect(fallback.department_context_analysis).toMatch(/\[ev:[^\]]+\]/);
      expect(fallback.prescriptive_action_plan.length).toBeGreaterThan(0);

      // 2. Test generateNarrative fallback orchestrator
      const res = await generateNarrative(input, policy);
      expect(res.fallback).toBe(true);
      expect(res.notice).toBe(FALLBACK_NOTICE);
      expect(res.narrative).toBeDefined();
      expect(narrativeSchema.safeParse(res.narrative).success).toBe(true);
    });
  }
});
