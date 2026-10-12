/** Fairness protocol (§14.1): flag-rate ratios by group, a minimum group size, and demographic data kept out of scoring. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { distributions, flagRates } from "../fairness";

const opts = { minGroup: 20, band: [0.8, 1.25] as const };

describe("flag-rate ratios", () => {
  it("compares each group with the largest one, and asks for review outside 0.8–1.25", () => {
    const r = flagRates(
      [
        { group: "english", n: 100, flagged: 20 }, // 0.20, the reference
        { group: "regional", n: 40, flagged: 12 }, // 0.30 → 1.5
        { group: "other", n: 30, flagged: 5 }, // 0.1667 → 0.833
        { group: "mixed", n: 25, flagged: 4 }, // 0.16 → 0.8 exactly: inside the band
      ],
      opts,
    );
    expect(r.reference).toBe("english");
    const by = Object.fromEntries(r.groups.map((g) => [g.group, g]));
    expect(by.english).toMatchObject({ ratio: null, review: false });
    expect(by.regional.ratio).toBeCloseTo(1.5, 9);
    expect(by.regional.review).toBe(true);
    expect(by.other.review).toBe(false);
    expect(by.mixed.ratio).toBeCloseTo(0.8, 9);
    expect(by.mixed.review).toBe(false);
  });
  it("flags a ratio below 0.8 and above 1.25 and not exactly at the edges", () => {
    const r = (flagged: number) =>
      flagRates(
        [
          { group: "ref", n: 200, flagged: 100 },
          { group: "g", n: 100, flagged },
        ],
        opts,
      ).groups.find((g) => g.group === "g");
    expect(r(39)?.review).toBe(true); // 0.78
    expect(r(40)?.review).toBe(false); // 0.80
    expect(r(62)?.review).toBe(false); // 1.24
    expect(r(63)?.review).toBe(true); // 1.26
  });
  it("never reports a group under the minimum size", () => {
    const r = flagRates(
      [
        { group: "big", n: 60, flagged: 6 },
        { group: "tiny", n: 19, flagged: 19 },
      ],
      opts,
    );
    expect(r.groups.map((g) => g.group)).toEqual(["big"]);
    expect(r.suppressed).toEqual([{ group: "tiny", reason: "fewer than 20 students" }]);
    expect(flagRates([{ group: "a", n: 20, flagged: 1 }], opts).groups).toHaveLength(1); // exactly 20 is enough
  });
  it("has no ratio when the reference group has no flags, and copes with no groups", () => {
    expect(
      flagRates(
        [
          { group: "ref", n: 60, flagged: 0 },
          { group: "g", n: 50, flagged: 5 },
        ],
        opts,
      ).groups.every((g) => g.ratio === null),
    ).toBe(true);
    expect(flagRates([], opts)).toEqual({ groups: [], suppressed: [], reference: null });
  });
});

describe("score distributions", () => {
  it("gives mean and quartiles per group and drops small groups", () => {
    const vals = [
      ...Array.from({ length: 21 }, (_, i) => ({ group: "a", score: i * 5 })),
      ...Array.from({ length: 5 }, () => ({ group: "b", score: 99 })),
    ];
    const d = distributions(vals, 20);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]).toMatchObject({ group: "a", n: 21, mean: 50, median: 50, p25: 25, p75: 75 });
    expect(d.suppressed).toEqual([{ group: "b", reason: "fewer than 20 students" }]);
  });
});

describe("demographic fields are never used in scoring (§14.1)", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? (f === "__tests__" ? [] : files(p)) : p.endsWith(".ts") ? [p] : [];
    });
  const WORDS =
    /demographic|first_generation|firstGeneration|medium_of_instruction|mediumOfInstruction|home_region|homeRegion|device_access|deviceAccess|\bgender\b/i;

  it("the rules engine and the facts it is built from never touch them", () => {
    const scoring = [
      ...files(join(process.cwd(), "src/server/rules")),
      join(process.cwd(), "src/server/services/facts.ts"),
    ].filter((f) => !f.endsWith("fairness.ts"));
    for (const f of scoring) expect(readFileSync(f, "utf8"), f).not.toMatch(WORDS);
  });
  it("the narrative layer never sees them either", () => {
    for (const f of files(join(process.cwd(), "src/server/llm")).filter(
      (x) => !x.endsWith("validator.ts") && !x.endsWith("text.ts"),
    ))
      expect(readFileSync(f, "utf8"), f).not.toMatch(
        /demographic|firstGeneration|mediumOfInstruction|homeRegion|deviceAccess/i,
      );
  });
});
