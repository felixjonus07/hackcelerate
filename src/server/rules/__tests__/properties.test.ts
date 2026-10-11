/**
 * Property-based testing with fast-check (§15.1):
 * - Scores stay between 0 and 100
 * - Adding verified evidence never lowers a score (monotonicity)
 * - 10,000 generated cases across all six tracks
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/load";
import type { TrackId, VerificationStatus } from "../../policy/schema";
import { gapRatio, scoreTrack } from "..";
import type { EvidenceFact, FacultyRating, MockAttempt, StudentFacts } from "../types";

const policy = loadPolicyFile("policy/2026.10-v1.json");

const TRACKS: TrackId[] = [
  "corporate_placement",
  "higher_studies",
  "entrepreneurship",
  "public_service",
  "freelance_creator",
  "sports_defense_ncc",
];

const arbTrack = fc.constantFrom<TrackId>(...TRACKS);

const arbStatus = fc.constantFrom<VerificationStatus>(
  "VERIFIED",
  "ATTESTED",
  "LIVE_UNVERIFIED",
  "SELF_REPORTED",
  "UNVERIFIED",
  "REJECTED",
  "SUBMITTED",
  "UNDER_CHECK",
  "STALE",
);

const arbEvidenceItem: fc.Arbitrary<EvidenceFact> = fc.record({
  id: fc.uuid(),
  component: fc.constantFrom(
    "academic_baseline",
    "aptitude",
    "domain_practical_evidence",
    "mock_interview_readiness",
    "verified_experience",
    "entrance_exam_readiness",
    "research_output",
    "faculty_recommendation_readiness",
    "application_timeline_adherence",
    "venture_traction",
    "build_evidence",
    "customer_validation",
    "team_and_execution",
    "academic_continuity",
    "current_affairs_consistency",
    "general_studies_mock",
    "quantitative_speed",
    "mock_streak",
    "answer_writing",
    "live_portfolio",
    "client_work",
    "tool_certifications",
    "live_deployments",
    "open_source_community",
    "physical_fitness",
    "camp_training_attendance",
    "competition_results",
    "psychometric_readiness",
  ),
  standardItem: fc.option(
    fc.constantFrom(
      "solidworks_lab",
      "autocad_lab",
      "timed_gdt_assessment",
      "factory_internship_hours",
      "excel_financial_model",
      "tally_erp",
      "taxation_knowledge",
      "circuit_pcb_project",
      "embedded_lab",
      "signal_power_test",
      "practice_problem_sets",
      "deployed_projects",
      "systems_design_notes",
    ),
    { nil: undefined },
  ),
  label: fc.string({ minLength: 1, maxLength: 30 }),
  status: arbStatus,
  weight: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
});

const arbMock: fc.Arbitrary<MockAttempt> = fc.record({
  id: fc.uuid(),
  testType: fc.constantFrom(
    "entrance",
    "gre",
    "gate",
    "cat",
    "campus_aptitude",
    "internal_aptitude",
    "gs_full",
    "quant",
  ),
  date: fc.constant("2026-09-01"),
  items: fc.integer({ min: 10, max: 100 }),
  score: fc.float({ min: 0, max: 100, noNaN: true }),
  percentile: fc.float({ min: 0, max: 100, noNaN: true }),
  targetSecondsPerItem: fc.option(fc.integer({ min: 10, max: 120 }), { nil: undefined }),
  avgSecondsPerItem: fc.float({ min: 1, max: 180, noNaN: true }),
  status: arbStatus,
});

const arbRating: fc.Arbitrary<FacultyRating> = fc.record({
  id: fc.uuid(),
  kind: fc.constantFrom("mock_interview", "answer_writing", "psychometric", "customer_validation", "sop_review"),
  date: fc.constant("2026-09-01"),
  rating: fc.float({ min: 1, max: 5, noNaN: true }),
  status: arbStatus,
});

const arbStudentFacts: fc.Arbitrary<StudentFacts> = fc.record({
  studentId: fc.uuid(),
  department: fc.constantFrom("MECH", "CSE", "ECE", "CIVIL", "COMM", "BIO", "LAW"),
  year: fc.integer({ min: 1, max: 5 }),
  cgpa: fc.option(fc.float({ min: 0, max: 10, noNaN: true }), { nil: null }),
  attendancePct: fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
  aspiration: fc.record({
    track: arbTrack,
    targetOutcome: fc.constant("Target Outcome"),
    readiness: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  }),
  campusAptitudePercentile: fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
  internalAptitudePercentile: fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
  verifiedInternshipHours: fc.option(fc.float({ min: 0, max: 300, noNaN: true }), { nil: null }),
  streakValidDays: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
  sopReviewsCount: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
  applicationMilestonesCompletedPct: fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
  customerInterviewsCount: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
  ventureMilestonesOnTimePct: fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
  currentAffairsDaysLogged: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
  currentAffairsWeeklyAccuracy: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: null }),
  physicalFitnessBmiBand: fc.option(fc.constantFrom("NORMAL", "WATCH", "EVALUATE"), { nil: null }),
  physicalFitnessCooperBandScore: fc.option(fc.float({ min: 0, max: 100, noNaN: true }), { nil: null }),
  campDaysAttended: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
  campDaysRequired: fc.option(fc.integer({ min: 1, max: 30 }), { nil: null }),
  competitionPoints: fc.option(fc.integer({ min: 0, max: 10 }), { nil: null }),
  creditsHeld: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  minimumCreditsRequired: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
  evidence: fc.array(arbEvidenceItem, { maxLength: 6 }),
  mocks: fc.array(arbMock, { maxLength: 4 }),
  ratings: fc.array(arbRating, { maxLength: 4 }),
});

describe("§15.1 Property-based testing (fast-check)", () => {
  it("invariably keeps scores between 0 and 100 across 10,000 runs", () => {
    fc.assert(
      fc.property(arbTrack, arbStudentFacts, (track, facts) => {
        const trackScore = scoreTrack(track, facts, policy);

        // Overall track score must be bounded in [0, 100]
        expect(trackScore.score).toBeGreaterThanOrEqual(0);
        expect(trackScore.score).toBeLessThanOrEqual(100.000001);

        // Each individual component score must be bounded in [0, 100]
        for (const comp of trackScore.components) {
          expect(comp.score).toBeGreaterThanOrEqual(0);
          expect(comp.score).toBeLessThanOrEqual(100.000001);
          expect(comp.contribution).toBeGreaterThanOrEqual(0);
          expect(comp.contribution).toBeLessThanOrEqual(comp.weight + 0.000001);
        }

        // Gap ratio is always non-negative
        const readiness = facts.aspiration.readiness ?? policy.readiness_default;
        const ratio = gapRatio(readiness, trackScore.score);
        expect(ratio).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 10_000 },
    );
  }, 30_000);

  it("guarantees adding verified evidence never lowers a score across 10,000 runs", () => {
    fc.assert(
      fc.property(
        arbTrack,
        arbStudentFacts,
        fc.constantFrom(
          "domain_practical_evidence",
          "research_output",
          "venture_traction",
          "build_evidence",
          "live_portfolio",
          "client_work",
          "tool_certifications",
          "live_deployments",
          "open_source_community",
        ),
        (track, facts, compKey) => {
          const scoreBefore = scoreTrack(track, facts, policy).score;

          // Department standard item key if MECH, CSE, etc.
          const dept = policy.department_standards[facts.department];
          const standardItem = dept ? Object.keys(dept.items)[0] : undefined;

          const verifiedPiece: EvidenceFact = {
            id: "ev-new-verified",
            component: compKey,
            standardItem,
            label: "New verified artifact",
            status: "VERIFIED",
            weight: 1,
          };

          const factsWithEvidence: StudentFacts = {
            ...facts,
            evidence: [...facts.evidence, verifiedPiece],
          };

          const scoreAfter = scoreTrack(track, factsWithEvidence, policy).score;

          // Monotonicity invariant: adding verified evidence never lowers the score
          expect(scoreAfter).toBeGreaterThanOrEqual(scoreBefore - 1e-6);
        },
      ),
      { numRuns: 10_000 },
    );
  }, 30_000);

  it("guarantees upgrading existing evidence to VERIFIED never lowers a score", () => {
    fc.assert(
      fc.property(arbTrack, arbStudentFacts, (track, facts) => {
        if (facts.evidence.length === 0) return true;

        const scoreBefore = scoreTrack(track, facts, policy).score;

        // Upgrade the first evidence item to VERIFIED
        const upgradedEvidence: EvidenceFact[] = facts.evidence.map((item, idx) =>
          idx === 0 ? { ...item, status: "VERIFIED" as const } : item,
        );

        const factsUpgraded: StudentFacts = {
          ...facts,
          evidence: upgradedEvidence,
        };

        const scoreAfter = scoreTrack(track, factsUpgraded, policy).score;

        expect(scoreAfter).toBeGreaterThanOrEqual(scoreBefore - 1e-6);
        return true;
      }),
      { numRuns: 1_000 },
    );
  });
});
