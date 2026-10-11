/**
 * LLM contract metrics report (§15.2): runs the narrative pipeline over the 60-record golden set (§15.3) and the
 * adversarial suite, and prints each measure against its acceptance threshold. Exit code 1 on a failure.
 *
 *   npm run llm:report             live model when OPENROUTER_API_KEY is set, else offline
 *   npm run llm:report -- --offline   force offline (templated outputs; checks the pipeline only)
 */

import { llmEnabled } from "../src/server/env";
import { callModel } from "../src/server/llm/adapter";
import { followedInjection, loadCases, runCase } from "../src/server/llm/adversarial";
import { templatedNarrative } from "../src/server/llm/fallback";
import { measureRun, renderReport, summarize } from "../src/server/llm/metrics";
import { generateNarrative } from "../src/server/llm/narrative";
import { buildFacts, type FactsInput } from "../src/server/llm/prompt";
import { loadPolicyFile } from "../src/server/policy/file";
import { evaluate } from "../src/server/rules";
import { GOLDEN_SET } from "../src/server/rules/golden-set";

const policy = loadPolicyFile();
const offline = process.argv.includes("--offline") || !llmEnabled;

/** The 60-record golden evaluation set (§15.3). */
const records = () => GOLDEN_SET.map((c) => c.facts);

async function main() {
  const runs = [];
  for (const [i, facts] of records().entries()) {
    const evaluation = evaluate(facts, policy);
    const input: FactsInput = {
      evaluationId: `eval-${i}`,
      pseudonymousId: facts.studentId,
      departmentName: policy.department_standards[facts.department]?.name ?? facts.department,
      evaluation,
      evidence: facts.evidence,
      remediation: [
        {
          id: "rem-1",
          title: "Add your largest missing item",
          action: "Pick the item with the largest weight that has no evidence yet and add it.",
          defaultTargetDays: 14,
        },
      ],
    };
    const { layer } = buildFacts(input, policy);
    const result = await generateNarrative(input, policy, {
      enabled: true,
      cache: null,
      // Offline, the "model" returns the rules-only narrative as JSON: it exercises parse, schema and validation.
      callModel: offline
        ? async () => ({
            provider: "openrouter",
            model: "offline-templated",
            temperature: 0,
            promptVersion: "offline",
            latencyMs: 0,
            content: JSON.stringify(templatedNarrative(input, policy)),
          })
        : callModel,
    });
    runs.push(measureRun(result, layer));
  }
  const cases = loadCases();
  let followed = 0;
  for (const c of cases) if (followedInjection(c, (await runCase(c, policy)).result)) followed++;
  const report = summarize(offline ? "offline" : "live", runs, { cases: cases.length, followed });
  console.log(renderReport(report));
  process.exitCode = report.passed ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
