/**
 * Rubric specification tests for all 6 tracks (§5.3):
 * Tests track rubrics, gates, mixed-source lowest-multiplier rule,
 * and band-only BMI rule.
 */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/load";
import { evaluate, round1, round2, scoreTrack } from "..";
import type { StudentFacts } from "../types";
import { RULES_ENGINE_VERSION } from "../version";

const policy = loadPolicyFile("policy/2026.10-v1.json");

const baseStudent = (overrides: Partial<StudentFacts> = {}): StudentFacts => ({
  studentId: "TEST-STU-01",
  department: "CSE",
  year: 3,
  cgpa: 8.0,
  attendancePct: 85,
  aspiration: {
    track: "corporate_placement",
    targetOutcome: "Software Engineer",
  },
  evidence: [],
  mocks: [],
  ratings: [],
  verifiedInternshipHours: null,
  campusAptitudePercentile: null,
  ...overrides,
});

function comp(s: ReturnType<typeof scoreTrack>, key: string) {
  const found = s.components.find((c) => c.key === key);
  if (!found) throw new Error(`Component ${key} not found`);
  return found;
}

describe("§5.3.2 Higher Studies & Research Rubric", () => {
  it("enforces mixed-source lowest-multiplier rule on entrance exams", () => {
    // 1. Pure VERIFIED attempt
    const pureVerified = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "MS in CS" },
      mocks: [
        {
          id: "mock-1",
          testType: "entrance",
          date: "2026-09-01",
          items: 20,
          avgSecondsPerItem: 60,
          percentile: 80,
          status: "VERIFIED",
        },
      ],
    });
    const s1 = scoreTrack("higher_studies", pureVerified, policy);
    const entrance1 = comp(s1, "entrance_exam_readiness");
    expect(round1(entrance1.score)).toBe(80.0);

    // 2. Pure SELF_REPORTED attempt (multiplier 0.5)
    const pureSelfReported = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "MS in CS" },
      mocks: [
        {
          id: "mock-2",
          testType: "entrance",
          date: "2026-09-01",
          items: 20,
          avgSecondsPerItem: 60,
          percentile: 80,
          status: "SELF_REPORTED",
        },
      ],
    });
    const s2 = scoreTrack("higher_studies", pureSelfReported, policy);
    const entrance2 = comp(s2, "entrance_exam_readiness");
    expect(round1(entrance2.score)).toBe(40.0); // 80 * 0.5

    // 3. Mixed sources: 1 VERIFIED (1.0) and 1 SELF_REPORTED (0.5)
    // Avg percentile = 80, lowest multiplier = 0.5 -> 80 * 0.5 = 40.0
    const mixed = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "MS in CS" },
      mocks: [
        {
          id: "mock-v",
          testType: "entrance",
          date: "2026-09-01",
          items: 20,
          avgSecondsPerItem: 60,
          percentile: 80,
          status: "VERIFIED",
        },
        {
          id: "mock-sr",
          testType: "entrance",
          date: "2026-09-15",
          items: 20,
          avgSecondsPerItem: 60,
          percentile: 80,
          status: "SELF_REPORTED",
        },
      ],
    });
    const s3 = scoreTrack("higher_studies", mixed, policy);
    const entrance3 = comp(s3, "entrance_exam_readiness");
    expect(round1(entrance3.score)).toBe(40.0);
    expect(entrance3.calculation).toContain("lowest multiplier");

    // 4. Mixed sources: 1 VERIFIED (1.0) and 1 ATTESTED (0.9)
    // Avg percentile = 80, lowest multiplier = 0.9 -> 80 * 0.9 = 72.0
    const mixedAttested = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "MS in CS" },
      mocks: [
        {
          id: "mock-v",
          testType: "entrance",
          date: "2026-09-01",
          items: 20,
          avgSecondsPerItem: 60,
          percentile: 80,
          status: "VERIFIED",
        },
        {
          id: "mock-att",
          testType: "entrance",
          date: "2026-09-15",
          items: 20,
          avgSecondsPerItem: 60,
          percentile: 80,
          status: "ATTESTED",
        },
      ],
    });
    const s4 = scoreTrack("higher_studies", mixedAttested, policy);
    const entrance4 = comp(s4, "entrance_exam_readiness");
    expect(round1(entrance4.score)).toBe(72.0);
  });

  it("calculates timed entrance mock with speed score submeasure", () => {
    // Percentile 80, speed score: target 60s, avg 60s -> speed score 100
    // raw = 0.7 * 80 + 0.3 * 100 = 56 + 30 = 86
    const timedStudent = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "MS in CS" },
      mocks: [
        {
          id: "mock-timed",
          testType: "entrance",
          date: "2026-09-01",
          items: 20,
          percentile: 80,
          targetSecondsPerItem: 60,
          avgSecondsPerItem: 60,
          status: "VERIFIED",
        },
      ],
    });
    const s = scoreTrack("higher_studies", timedStudent, policy);
    const entrance = comp(s, "entrance_exam_readiness");
    expect(round1(entrance.score)).toBe(86.0);
  });

  it("calculates statement of purpose reviews capped at 3", () => {
    const student1 = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "Research" },
      sopReviewsCount: 2,
    });
    const s1 = scoreTrack("higher_studies", student1, policy);
    const sop1 = comp(s1, "faculty_recommendation_readiness");
    expect(round2(sop1.score)).toBe(66.67);

    const student3 = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "Research" },
      sopReviewsCount: 3,
    });
    const s3 = scoreTrack("higher_studies", student3, policy);
    const sop3 = comp(s3, "faculty_recommendation_readiness");
    expect(round1(sop3.score)).toBe(100.0);

    const studentOver = baseStudent({
      aspiration: { track: "higher_studies", targetOutcome: "Research" },
      sopReviewsCount: 5,
    });
    const sOver = scoreTrack("higher_studies", studentOver, policy);
    const sopOver = comp(sOver, "faculty_recommendation_readiness");
    expect(round1(sopOver.score)).toBe(100.0);
  });
});

describe("§5.3.3 Entrepreneurship Rubric", () => {
  it("calculates customer validation interviews capped at 15 times rating", () => {
    // 15 interviews, 5.0 rating -> (15 / 15) * (5 / 5) * 100 = 100
    const stuFull = baseStudent({
      aspiration: { track: "entrepreneurship", targetOutcome: "SaaS Founder" },
      customerInterviewsCount: 15,
      ratings: [
        {
          id: "rat-cust",
          kind: "customer_validation",
          date: "2026-09-01",
          rating: 5,
          status: "ATTESTED",
        },
      ],
    });
    const sFull = scoreTrack("entrepreneurship", stuFull, policy);
    const compFull = comp(sFull, "customer_validation");
    expect(round1(compFull.score)).toBe(100.0);

    // 10 interviews, 4.0 rating -> (10 / 15) * (4 / 5) * 100 = 53.33
    const stuPartial = baseStudent({
      aspiration: { track: "entrepreneurship", targetOutcome: "SaaS Founder" },
      customerInterviewsCount: 10,
      ratings: [
        {
          id: "rat-cust",
          kind: "customer_validation",
          date: "2026-09-01",
          rating: 4,
          status: "ATTESTED",
        },
      ],
    });
    const sPartial = scoreTrack("entrepreneurship", stuPartial, policy);
    const compPartial = comp(sPartial, "customer_validation");
    expect(round2(compPartial.score)).toBe(53.33);
  });
});

describe("§5.3.4 Public Service Rubric & Gate", () => {
  it("calculates current affairs consistency", () => {
    // 30 days logged, 80% accuracy -> (30 / 30) * 0.8 * 100 = 80
    const stu = baseStudent({
      aspiration: { track: "public_service", targetOutcome: "IAS Officer" },
      currentAffairsDaysLogged: 30,
      currentAffairsWeeklyAccuracy: 0.8,
    });
    const s = scoreTrack("public_service", stu, policy);
    const ca = comp(s, "current_affairs_consistency");
    expect(round1(ca.score)).toBe(80.0);
  });

  it("enforces CGPA eligibility floor gate (5.0)", () => {
    // CGPA 5.1 -> gate passed
    const passStu = baseStudent({
      aspiration: { track: "public_service", targetOutcome: "IAS Officer" },
      cgpa: 5.1,
    });
    expect(scoreTrack("public_service", passStu, policy).gateFailed).toBeNull();

    // CGPA 5.0 -> gate failed
    const failStu50 = baseStudent({
      aspiration: { track: "public_service", targetOutcome: "IAS Officer" },
      cgpa: 5.0,
    });
    expect(scoreTrack("public_service", failStu50, policy).gateFailed).toBe("CGPA is not above the eligibility floor");

    // CGPA 4.8 -> gate failed
    const failStu48 = baseStudent({
      aspiration: { track: "public_service", targetOutcome: "IAS Officer" },
      cgpa: 4.8,
    });
    expect(scoreTrack("public_service", failStu48, policy).gateFailed).toBe("CGPA is not above the eligibility floor");
  });
});

describe("§5.3.5 Freelance & Creator Economy Gate", () => {
  it("enforces attendance requirement gate (75%)", () => {
    const passStu = baseStudent({
      aspiration: { track: "freelance_creator", targetOutcome: "Full-stack Freelancer" },
      attendancePct: 75,
    });
    expect(scoreTrack("freelance_creator", passStu, policy).gateFailed).toBeNull();

    const failStu = baseStudent({
      aspiration: { track: "freelance_creator", targetOutcome: "Full-stack Freelancer" },
      attendancePct: 74.9,
    });
    expect(scoreTrack("freelance_creator", failStu, policy).gateFailed).toBe("Attendance is below the requirement");
  });
});

describe("§5.3.6 Sports, Defense & NCC Rubric & Gate", () => {
  it("scales physical fitness by BMI band factor without outputting numeric BMI", () => {
    // NORMAL band (factor 1.0)
    const normalStu = baseStudent({
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Army Officer (CDS)" },
      physicalFitnessCooperBandScore: 80,
      physicalFitnessBmiBand: "NORMAL",
    });
    const sNormal = scoreTrack("sports_defense_ncc", normalStu, policy);
    const normalComp = comp(sNormal, "physical_fitness");
    expect(round1(normalComp.score)).toBe(80.0);
    expect(normalComp.calculation).toContain("BMI band factor (NORMAL)");
    expect(normalComp.calculation).not.toMatch(/bmi\s*:\s*\d+(\.\d+)?/i);

    // WATCH band (factor 0.85) -> 80 * 0.85 = 68.0
    const watchStu = baseStudent({
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Army Officer (CDS)" },
      physicalFitnessCooperBandScore: 80,
      physicalFitnessBmiBand: "WATCH",
    });
    const sWatch = scoreTrack("sports_defense_ncc", watchStu, policy);
    const watchComp = comp(sWatch, "physical_fitness");
    expect(round1(watchComp.score)).toBe(68.0);
    expect(watchComp.calculation).toContain("BMI band factor (WATCH)");
    expect(watchComp.calculation).not.toMatch(/bmi\s*:\s*\d+(\.\d+)?/i);

    // EVALUATE band (factor 0.7) -> 80 * 0.7 = 56.0
    const evalStu = baseStudent({
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Army Officer (CDS)" },
      physicalFitnessCooperBandScore: 80,
      physicalFitnessBmiBand: "EVALUATE",
    });
    const sEval = scoreTrack("sports_defense_ncc", evalStu, policy);
    const evalComp = comp(sEval, "physical_fitness");
    expect(round1(evalComp.score)).toBe(56.0);
    expect(evalComp.calculation).toContain("BMI band factor (EVALUATE)");
    expect(evalComp.calculation).not.toMatch(/bmi\s*:\s*\d+(\.\d+)?/i);
  });

  it("enforces minimum credits held gate", () => {
    const passStu = baseStudent({
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Army Officer (CDS)" },
      creditsHeld: 24,
      minimumCreditsRequired: 20,
    });
    expect(scoreTrack("sports_defense_ncc", passStu, policy).gateFailed).toBeNull();

    const failStu = baseStudent({
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Army Officer (CDS)" },
      creditsHeld: 18,
      minimumCreditsRequired: 20,
    });
    expect(scoreTrack("sports_defense_ncc", failStu, policy).gateFailed).toBe("Minimum credits not held");
  });
});

describe("Evaluation Version Stamp", () => {
  it("records RULES_ENGINE_VERSION on every evaluation and matches semver", () => {
    const ev = evaluate(baseStudent(), policy);
    expect(ev.engineVersion).toBe(RULES_ENGINE_VERSION);
    expect(ev.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
