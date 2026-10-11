/**
 * Nightly batch benchmark (§10.3): evaluates 2,000 synthetic students at concurrency 8 and checks the run fits the
 * two-hour budget with a wide margin. It measures the rules engine plus the templated narrative, which is the
 * compute-bound part of the nightly job; database writes are bounded separately by the evaluation worker.
 *
 *   npm run bench:nightly              2,000 students
 *   npm run bench:nightly -- 5000      another size
 */

import { templatedNarrative } from "../src/server/llm/fallback";
import { buildFacts } from "../src/server/llm/prompt";
import { loadPolicyFile } from "../src/server/policy/file";
import { evaluate } from "../src/server/rules";
import { GOLDEN_SET } from "../src/server/rules/golden-set";

const STUDENTS = Number(process.argv[2]) || 2000;
const CONCURRENCY = 8;
const BUDGET_MS = 2 * 60 * 60 * 1000;

const policy = loadPolicyFile();

async function one(i: number) {
  const base = GOLDEN_SET[i % GOLDEN_SET.length].facts;
  const facts = { ...base, studentId: `BENCH-${i}` };
  const evaluation = evaluate(facts, policy);
  const input = {
    evaluationId: `bench-${i}`,
    pseudonymousId: facts.studentId,
    departmentName: policy.department_standards[facts.department]?.name ?? facts.department,
    evaluation,
    evidence: facts.evidence,
    remediation: [],
  };
  buildFacts(input, policy);
  templatedNarrative(input, policy);
}

async function main() {
  let next = 0;
  const times: number[] = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < STUDENTS) {
        const i = next++;
        const t0 = performance.now();
        await one(i);
        times.push(performance.now() - t0);
        await Promise.resolve();
      }
    }),
  );
  const total = performance.now() - started;
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(2);
  console.log(`students       ${STUDENTS} at concurrency ${CONCURRENCY}`);
  console.log(`wall time      ${(total / 1000).toFixed(2)} s   (budget ${BUDGET_MS / 1000} s)`);
  console.log(`per student    p50 ${p(0.5)} ms   p95 ${p(0.95)} ms   max ${times.at(-1)?.toFixed(2)} ms`);
  const ok = total < BUDGET_MS;
  console.log(ok ? "PASS: within the nightly budget" : "FAIL: over the nightly budget");
  process.exit(ok ? 0 : 1);
}

main();
