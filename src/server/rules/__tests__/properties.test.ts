/**
 * Property-based tests (§15.1, gate before pilot): across 10,000 generated cases per property,
 * scores stay within 0–100 and adding verified evidence never lowers a score.
 */
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import { TRACK_IDS, type TrackId, VERIFICATION_STATUSES, type VerificationStatus } from "../../policy/schema";
import { evaluate, scoreTrack } from "..";
import type { EvidenceItem, FacultyRating, MockAttempt, StudentFacts } from "../types";

// 10,000 generated cases per property take several seconds, longer when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 180_000 });

const policy = loadPolicyFile();
const RUNS = 10_000;
const DEPTS = Object.keys(policy.department_standards);
const STANDARD_ITEMS = Object.fromEntries(DEPTS.map((d) => [d, Object.keys(policy.department_standards[d].items)]));

const status = fc.constantFrom<VerificationStatus>(...VERIFICATION_STATUSES);
const nullable = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: null });
const day = fc.integer({ min: 0, max: 120 }).map((n) => {
  const d = new Date(Date.UTC(2026, 5, 13) + n * 86_400_000);
  return d.toISOString().slice(0, 10);
});

const componentKeys = (track: TrackId) => Object.keys(policy.tracks[track]?.components ?? {});
const KINDS = ["interview_log", "sop_review", "fitness_record", "camp_record", "medal", "project", "paper"];

const evidenceFor = (track: TrackId, dept: string): fc.Arbitrary<EvidenceItem> =>
  fc.record({
    id: fc.uuid(),
    component: fc.constantFrom(...componentKeys(track)),
    standardItem: fc.option(fc.constantFrom(...STANDARD_ITEMS[dept]), { nil: undefined }),
    label: fc.constant("item"),
    weight: fc.option(fc.double({ min: 0.5, max: 5, noNaN: true }), { nil: undefined }),
    status,
    kind: fc.option(fc.constantFrom(...KINDS), { nil: undefined }),
    details: fc.option(
      fc.record({
        uptimePct: fc.integer({ min: 0, max: 100 }),
        level: fc.constantFrom("university", "state", "national"),
        daysAttended: fc.integer({ min: 0, max: 12 }),
        daysRequired: fc.integer({ min: 1, max: 12 }),
        cooperMetres: fc.integer({ min: 0, max: 3500 }),
        staminaScore: fc.integer({ min: 0, max: 100 }),
        bmiBand: fc.constantFrom("in_range", "borderline", "out_of_range"),
      }),
      { nil: undefined },
    ),
  });

const mockArb: fc.Arbitrary<MockAttempt> = fc.record({
  id: fc.uuid(),
  testType: fc.constantFrom("entrance", "gs_full", "quant", "weekly_test", "practice"),
  date: day,
  items: fc.integer({ min: 1, max: 120 }),
  percentile: fc.double({ min: 0, max: 100, noNaN: true }),
  score: fc.double({ min: 0, max: 40, noNaN: true }),
  maxScore: fc.double({ min: 1, max: 40, noNaN: true }),
  avgSecondsPerItem: fc.double({ min: 1, max: 200, noNaN: true }),
  targetSecondsPerItem: fc.option(fc.double({ min: 1, max: 200, noNaN: true }), { nil: undefined }),
  difficulty: fc.option(fc.constantFrom("easy", "medium", "hard"), { nil: undefined }),
  status,
});

const ratingArb: fc.Arbitrary<FacultyRating> = fc.record({
  id: fc.uuid(),
  kind: fc.constantFrom("mock_interview", "answer_writing", "psychometric", "customer_validation"),
  date: day,
  rating: fc.double({ min: 1, max: 5, noNaN: true }),
  status,
});

const factsArb = (track: TrackId): fc.Arbitrary<StudentFacts> =>
  fc.constantFrom(...DEPTS).chain((department) =>
    fc.record({
      studentId: fc.constant("P-1"),
      asOf: fc.constant("2026-10-11"),
      department: fc.constant(department),
      year: fc.integer({ min: 1, max: 5 }),
      cgpa: nullable(fc.double({ min: 0, max: 10, noNaN: true })),
      attendancePct: nullable(fc.double({ min: 0, max: 100, noNaN: true })),
      creditsHeld: nullable(fc.integer({ min: 0, max: 200 })),
      aspiration: fc.constant({ track, targetOutcome: "t", readiness: 70 }),
      evidence: fc.array(evidenceFor(track, department), { maxLength: 8 }),
      mocks: fc.array(mockArb, { maxLength: 8 }),
      ratings: fc.array(ratingArb, { maxLength: 5 }),
      milestones: fc.array(
        fc.record({
          id: fc.uuid(),
          scope: fc.constantFrom("application" as const, "venture" as const),
          title: fc.constant("m"),
          dueOn: day,
          completedOn: nullable(day),
        }),
        { maxLength: 5 },
      ),
      currentAffairsDates: fc.array(day, { maxLength: 20 }),
      verifiedInternshipHours: nullable(fc.integer({ min: 0, max: 500 })),
      campusAptitudePercentile: nullable(fc.double({ min: 0, max: 100, noNaN: true })),
    }),
  );

describe.each(TRACK_IDS)("%s", (track) => {
  it(`scores stay between 0 and 100, with no NaN (${RUNS} cases)`, () => {
    fc.assert(
      fc.property(factsArb(track), (f) => {
        const s = scoreTrack(track, f, policy);
        const ok = (x: number) => Number.isFinite(x) && x >= 0 && x <= 100;
        return ok(s.score) && s.components.every((c) => ok(c.score) && ok(c.contribution));
      }),
      { numRuns: RUNS },
    );
  });

  it(`adding verified evidence never lowers the score (${RUNS} cases)`, () => {
    // Additive evidence: items whose rubric only ever adds (camp attendance is a ratio, so a record
    // of fewer days than before can lower it by design, and is excluded here).
    const additive = fc
      .tuple(
        factsArb(track),
        fc.double({ min: 0.5, max: 5, noNaN: true }),
        fc.nat(),
        fc.nat(),
        fc.integer({ min: 0, max: 100 }),
      )
      .map(([f, weight, ci, si, uptime]) => {
        const keys = componentKeys(track).filter((k) => k !== "camp_training_attendance");
        const component = keys[ci % keys.length];
        const items = STANDARD_ITEMS[f.department];
        const added: EvidenceItem = {
          id: "added",
          component,
          label: "added",
          weight,
          status: "VERIFIED",
          standardItem: component === "domain_practical_evidence" ? items[si % items.length] : undefined,
          kind:
            component === "faculty_recommendation_readiness"
              ? "sop_review"
              : component === "customer_validation"
                ? "interview_log"
                : component === "competition_results"
                  ? "medal"
                  : component === "physical_fitness"
                    ? "fitness_record"
                    : undefined,
          details: { uptimePct: uptime, level: "state", staminaScore: uptime, cooperMetres: uptime * 30 },
        };
        return { f, added };
      });
    fc.assert(
      fc.property(additive, ({ f, added }) => {
        const before = scoreTrack(track, f, policy).score;
        const after = scoreTrack(track, { ...f, evidence: [...f.evidence, added] }, policy).score;
        return after >= before - 1e-9;
      }),
      { numRuns: RUNS },
    );
  });
});

describe("evaluation as a whole", () => {
  it("is deterministic and keeps the gap ratio within 0–1 (10,000 cases)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TRACK_IDS).chain((t) => factsArb(t)),
        (f) => {
          const a = evaluate(f, policy);
          const b = evaluate(structuredClone(f), policy);
          return JSON.stringify(a) === JSON.stringify(b) && a.gapRatio >= 0 && a.gapRatio <= 1;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("every component computes on empty facts (no missing parameter in the policy)", () => {
    for (const track of TRACK_IDS) {
      const s = scoreTrack(
        track,
        {
          studentId: "E",
          asOf: "2026-10-11",
          department: "MECH",
          year: 3,
          cgpa: null,
          attendancePct: null,
          aspiration: { track, targetOutcome: "t" },
          evidence: [],
          mocks: [],
          ratings: [],
          verifiedInternshipHours: null,
          campusAptitudePercentile: null,
        },
        policy,
      );
      expect(s.score).toBe(0);
      expect(s.components.map((c) => c.key).sort()).toEqual(componentKeys(track).sort());
    }
  });
});
