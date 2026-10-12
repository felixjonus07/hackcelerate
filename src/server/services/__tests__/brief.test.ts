/** The mentor brief (§12.2): three facts, gaps, two questions, pivot options, each fact with its source. */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import { evaluate } from "../../rules";
import { CS_44, EE_12, ME_27, SEED_RECORDS } from "../../rules/fixtures";
import { buildBrief } from "../brief";

const policy = loadPolicyFile();

describe("buildBrief", () => {
  it("has exactly three facts, each tied to a source field and an anchor", () => {
    for (const f of [ME_27, CS_44, EE_12, ...SEED_RECORDS.map((r) => r.facts)]) {
      const b = buildBrief(evaluate(f, policy), policy);
      expect(b.facts).toHaveLength(3);
      for (const fact of b.facts) {
        expect(fact.text.length).toBeGreaterThan(10);
        expect(fact.source.field).toMatch(/^(trackScore|personas|trend)/);
        expect(fact.source.anchor).toMatch(/^[a-z][a-z-_]*$/);
      }
      expect(b.questions).toHaveLength(2);
      expect(b.questions[0]).not.toBe(b.questions[1]);
    }
  });

  it("ME-27 (§20.1): score, the GD&T shortfall, and the strongest area when no persona fired", () => {
    const b = buildBrief(evaluate(ME_27, policy), policy);
    expect(b.facts[0].text).toBe("Corporate Placement score 48.1 against a readiness of 70; the gap is moderate.");
    expect(b.facts[1].text).toMatch(/^Domain practical evidence is the largest shortfall/);
    expect(b.facts[1].source).toMatchObject({
      field: "trackScore.components.domain_practical_evidence",
      anchor: "component-domain_practical_evidence",
    });
    expect(b.facts[2].text).toMatch(/strongest area/);
    expect(b.dataGaps.map((g) => g.text)).toEqual(["Timed GD&T assessment: no counted evidence yet"]);
    expect(b.dataGaps[0].source.anchor).toBe("component-domain_practical_evidence");
  });

  it("CS-44 (§20.3): the persona's own reason is the third fact, and the first question is about attendance", () => {
    const b = buildBrief(evaluate(CS_44, policy), policy);
    expect(b.facts[2].text).toMatch(/Attendance 62% is below the condonation floor/);
    expect(b.facts[2].source.field).toBe("personas.detention_threat_builder");
    expect(b.questions[0]).toMatch(/hard to be in class/);
  });

  it("EE-12 (§20.4): the first question starts from the student's strength", () => {
    expect(buildBrief(evaluate(EE_12, policy), policy).questions[0]).toMatch(/academic record is strong/);
  });

  it("always offers to continue; a moderate gap offers to extend the date; a pivot is the student's choice", () => {
    const moderate = buildBrief(evaluate(ME_27, policy), policy);
    expect(moderate.pivot.options.map((o) => o.key)).toEqual(["continue", "extend"]);
    const mismatch = buildBrief(evaluate(SEED_RECORDS[4].facts, policy), policy);
    const pivot = mismatch.pivot.options.find((o) => o.key === "pivot");
    expect(pivot?.detail).toMatch(/student chooses; no track changes automatically/);
  });

  it("is deterministic: the same evaluation gives the same brief", () => {
    const ev = evaluate(CS_44, policy);
    expect(JSON.stringify(buildBrief(ev, policy))).toBe(JSON.stringify(buildBrief(structuredClone(ev), policy)));
  });

  it("never names a persona to the student or uses a banned label in the questions", () => {
    for (const f of [ME_27, CS_44, EE_12, ...SEED_RECORDS.map((r) => r.facts)]) {
      const q = buildBrief(evaluate(f, policy), policy).questions.join(" ");
      expect(q).not.toMatch(/drifting|at risk|failing|lazy|you must|high flyer/i);
    }
  });

  it("explains a hidden score instead of printing one", () => {
    const b = buildBrief(evaluate(SEED_RECORDS[5].facts, policy), policy); // SYN-06: no declared track, gate not met
    expect(b.facts[0].text).toMatch(/^Not enough evidence yet/);
  });
});
