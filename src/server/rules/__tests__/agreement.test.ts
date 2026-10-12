/** Agreement metrics (§15.4) with Wilson intervals. */
import { describe, expect, it } from "vitest";
import { agreement, wilson } from "../agreement";

describe("Wilson interval", () => {
  it("matches known values", () => {
    const w = wilson(8, 10);
    expect(w.value).toBe(0.8);
    expect(w.low).toBeCloseTo(0.4902, 3);
    expect(w.high).toBeCloseTo(0.9433, 3);
  });
  it("is wide for a small sample and narrow for a large one", () => {
    const small = wilson(9, 10);
    const large = wilson(900, 1000);
    expect((small.high ?? 0) - (small.low ?? 0)).toBeGreaterThan(((large.high ?? 0) - (large.low ?? 0)) * 5);
  });
  it("stays within 0 and 1 at the extremes, and says so when there is nothing to estimate", () => {
    expect(wilson(0, 20)).toMatchObject({ value: 0, low: 0 });
    expect(wilson(20, 20).high).toBe(1);
    expect(wilson(0, 0)).toEqual({ value: null, low: null, high: null, n: 0 });
  });
});

describe("agreement between system and mentors", () => {
  const pairs = [
    { system: "a", mentor: "a" },
    { system: "a", mentor: "a" },
    { system: "a", mentor: null },
    { system: null, mentor: "a" },
    { system: "b", mentor: "b" },
    { system: null, mentor: null },
    { system: null, mentor: null },
    { system: "b", mentor: "a" },
  ];
  const r = agreement(pairs, ["a", "b"]);
  it("counts agreement including the case of no persona", () => {
    expect(r.agreement).toMatchObject({ value: 5 / 8, n: 8 }); // 2×a, b, and 2×none agree
  });
  it("precision is correct flags over all flags; recall over everyone the mentor labelled", () => {
    const a = r.perPersona.find((p) => p.persona === "a");
    expect(a?.precision).toMatchObject({ value: 2 / 3, n: 3 });
    expect(a?.recall).toMatchObject({ value: 2 / 4, n: 4 });
    const b = r.perPersona.find((p) => p.persona === "b");
    expect(b?.precision).toMatchObject({ value: 1 / 2, n: 2 });
    expect(b?.recall).toMatchObject({ value: 1, n: 1 });
  });
  it("a persona never flagged or never labelled has no estimate rather than a made-up one", () => {
    expect(agreement([{ system: null, mentor: null }], ["a"]).perPersona[0].precision.value).toBeNull();
  });
});
