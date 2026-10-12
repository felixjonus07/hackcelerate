import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import type { VerificationStatus } from "../../policy/schema";
import { VERIFICATION_STATUSES } from "../../policy/schema";
import { attendanceScore, cgpaScore, leastSquaresSlope, ratingScore, scoreTrack, speedScore, streakScore } from "..";
import { ME_27 } from "../fixtures";

const policy = loadPolicyFile("policy/2026.10-v1.json");

describe("§5.2 normalization", () => {
  it("cgpa score clamps to the 5–10 scoring range", () => {
    expect(cgpaScore(4, policy)).toBe(0);
    expect(cgpaScore(7.5, policy)).toBe(50);
    expect(cgpaScore(11, policy)).toBe(100);
  });
  it("attendance score caps at the requirement", () => {
    expect(attendanceScore(81, policy)).toBe(100);
    expect(attendanceScore(60, policy)).toBe(80);
  });
  it("speed, streak and rating scores", () => {
    expect(speedScore(30, 60)).toBe(50);
    expect(speedScore(30, 10)).toBe(100);
    expect(streakScore(45, 30)).toBe(100);
    expect(streakScore(15, 30)).toBe(50);
    expect(ratingScore(3.5)).toBe(62.5);
  });
  it("least-squares slope", () => {
    expect(leastSquaresSlope([1, 2, 3, 4].map((w, i) => ({ week: w, value: 71 - 3 * i })))).toBeCloseTo(-3);
  });
});

describe("§15.1 property-based", () => {
  const status = fc.constantFrom<VerificationStatus>(...VERIFICATION_STATUSES);

  it("scores always stay between 0 and 100", () => {
    fc.assert(
      fc.property(
        fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: null }),
        fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
        fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
        fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
        (cgpa, att, apt, hours) => {
          const s = scoreTrack(
            "corporate_placement",
            {
              ...ME_27,
              cgpa,
              attendancePct: att,
              campusAptitudePercentile: apt,
              verifiedInternshipHours: hours,
            },
            policy,
          );
          return s.score >= 0 && s.score <= 100 && s.components.every((c) => c.score >= 0 && c.score <= 100);
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("adding verified evidence never lowers a score", () => {
    const items = ["solidworks_lab", "autocad_lab", "gdt_assessment", "factory_internship_hours"];
    fc.assert(
      fc.property(fc.constantFrom(...items), status, (item, prior) => {
        const before = {
          ...ME_27,
          evidence: ME_27.evidence
            .filter((e) => e.standardItem !== item)
            .concat([
              {
                id: "x",
                component: "domain_practical_evidence",
                standardItem: item,
                label: item,
                status: prior,
              },
            ]),
        };
        const after = {
          ...before,
          evidence: [
            ...before.evidence,
            {
              id: "y",
              component: "domain_practical_evidence",
              standardItem: item,
              label: item,
              status: "VERIFIED" as const,
            },
          ],
        };
        return (
          scoreTrack("corporate_placement", after, policy).score >=
          scoreTrack("corporate_placement", before, policy).score
        );
      }),
      { numRuns: 2_000 },
    );
  });
});
