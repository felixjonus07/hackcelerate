/**
 * Hand-computed rubric tests for the tracks §5.3.2–§5.3.6 (the Corporate Placement rubric is covered by
 * the §20 golden tests). Every expected number is worked out in the comments so a mentor can check it.
 */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import type { VerificationStatus } from "../../policy/schema";
import { checkGate, evaluate, gateReason, round2, scoreTrack } from "..";
import { FIXTURE_AS_OF } from "../fixtures";
import type { EvidenceItem, FacultyRating, MockAttempt, StudentFacts } from "../types";
import { RULES_ENGINE_VERSION } from "../version";

const policy = loadPolicyFile();
const AS_OF = FIXTURE_AS_OF; // 2026-10-11

const facts = (over: Partial<StudentFacts> = {}): StudentFacts => ({
  studentId: "T-1",
  asOf: AS_OF,
  department: "MECH",
  year: 3,
  cgpa: 8,
  attendancePct: 90,
  aspiration: { track: null, targetOutcome: "t", readiness: 70 },
  evidence: [],
  mocks: [],
  ratings: [],
  verifiedInternshipHours: null,
  campusAptitudePercentile: null,
  ...over,
});
const ev = (component: string, status: VerificationStatus, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: `${component}-${Math.random()}`,
  component,
  label: component,
  status,
  ...over,
});
const rating = (kind: FacultyRating["kind"], value: number, date = "2026-09-01"): FacultyRating => ({
  id: `${kind}-${date}-${value}`,
  kind,
  date,
  rating: value,
  status: "ATTESTED",
});
const mock = (over: Partial<MockAttempt> & Pick<MockAttempt, "testType" | "date">): MockAttempt => ({
  id: `${over.testType}-${over.date}-${Math.random()}`,
  items: 40,
  percentile: 50,
  avgSecondsPerItem: 40,
  status: "VERIFIED",
  ...over,
});
const comp = (t: ReturnType<typeof scoreTrack>, key: string) =>
  t.components.find((c) => c.key === key)?.score ?? Number.NaN;

describe("§5.3.2 Higher Studies and Research", () => {
  const f = facts({
    // academic: cgpa (8−5)/5 = 60, attendance 90/75 → 100, mean 80
    evidence: [
      ev("research_output", "VERIFIED", { weight: 3 }), // 3 × 1.0
      ev("research_output", "SELF_REPORTED", { weight: 2 }), // 2 × 0.5 = 1  → 4 / 6 required = 66.67
      ev("faculty_recommendation_readiness", "ATTESTED", { kind: "sop_review" }),
      ev("faculty_recommendation_readiness", "ATTESTED", { kind: "sop_review" }), // 2 / 3 = 66.67
    ],
    // entrance: mean(60, 70, 80) = 70, all VERIFIED
    mocks: [60, 70, 80].map((p, i) => mock({ testType: "entrance", date: `2026-09-0${i + 1}`, percentile: p })),
    // milestones: 3 are due; 2 on time → 66.67
    milestones: [
      { id: "a", scope: "application", title: "a", dueOn: "2026-08-01", completedOn: "2026-07-30" },
      { id: "b", scope: "application", title: "b", dueOn: "2026-09-01", completedOn: "2026-09-01" },
      { id: "c", scope: "application", title: "c", dueOn: "2026-09-15", completedOn: "2026-09-20" },
      { id: "d", scope: "application", title: "d", dueOn: "2027-01-01", completedOn: null }, // not due yet: ignored
      { id: "e", scope: "venture", title: "other scope", dueOn: "2026-08-01", completedOn: null },
    ],
  });
  const t = scoreTrack("higher_studies", f, policy);

  it("scores each component by its formula", () => {
    expect(round2(comp(t, "academic_baseline"))).toBe(80);
    expect(round2(comp(t, "entrance_exam_readiness"))).toBe(70);
    expect(round2(comp(t, "research_output"))).toBe(66.67);
    expect(round2(comp(t, "faculty_recommendation_readiness"))).toBe(66.67);
    expect(round2(comp(t, "application_timeline_adherence"))).toBe(66.67);
  });
  it("totals 25% × 80 + 25% × 70 + 30% × 66.67 + 10% × 66.67 + 10% × 66.67 = 70.83", () => {
    expect(round2(t.score)).toBe(70.83);
  });
  it("scores mixed sources at the lowest verification multiplier used", () => {
    const mixed = facts({
      ...f,
      mocks: [
        mock({ testType: "entrance", date: "2026-09-01", percentile: 60 }),
        mock({
          testType: "entrance",
          date: "2026-09-02",
          percentile: 70,
          status: "SELF_REPORTED",
          source: "external body",
        }),
        mock({ testType: "entrance", date: "2026-09-03", percentile: 80 }),
      ],
    });
    // mean 70 × lowest multiplier 0.5 = 35
    expect(round2(comp(scoreTrack("higher_studies", mixed, policy), "entrance_exam_readiness"))).toBe(35);
  });
  it("shows speed as a sub-measure without changing the score while its share is 0", () => {
    const timed = facts({
      ...f,
      mocks: [
        mock({
          testType: "entrance",
          date: "2026-09-01",
          percentile: 70,
          targetSecondsPerItem: 30,
          avgSecondsPerItem: 60,
        }),
      ],
    });
    const c = scoreTrack("higher_studies", timed, policy).components.find((x) => x.key === "entrance_exam_readiness");
    expect(round2(c?.score ?? 0)).toBe(70);
    expect(c?.subMeasures).toEqual([{ label: "Speed score", value: "50" }]);
  });
  it("caps SOP reviews at the full count", () => {
    const many = facts({
      evidence: Array.from({ length: 5 }, () => ev("faculty_recommendation_readiness", "ATTESTED")),
    });
    expect(comp(scoreTrack("higher_studies", many, policy), "faculty_recommendation_readiness")).toBe(100);
  });
  it("lists a missing component as a data gap and scores it zero", () => {
    const t0 = scoreTrack("higher_studies", facts(), policy);
    expect(comp(t0, "research_output")).toBe(0);
    expect(t0.dataGaps.join(" ")).toMatch(/Research output: no evidence yet/);
  });
});

describe("§5.3.3 Entrepreneurship and Startups", () => {
  const f = facts({
    cgpa: 7, // 40
    attendancePct: 80, // 100 → mean 70
    evidence: [
      ev("venture_traction", "ATTESTED", { weight: 2 }),
      ev("venture_traction", "ATTESTED", { weight: 2 }), // 3.6 / 5 = 72
      ev("build_evidence", "VERIFIED", { weight: 2 }),
      ev("build_evidence", "LIVE_UNVERIFIED", { weight: 2 }), // 2 + 1.2 = 3.2 / 4 = 80
      ...Array.from({ length: 9 }, () => ev("customer_validation", "ATTESTED", { kind: "interview_log" })),
    ],
    ratings: [rating("customer_validation", 4)], // quality (4−1)/4 = 0.75; 9/15 × 0.75 = 45
    milestones: [
      { id: "a", scope: "venture", title: "a", dueOn: "2026-08-01", completedOn: "2026-08-01" },
      { id: "b", scope: "venture", title: "b", dueOn: "2026-09-01", completedOn: "2026-09-05" }, // late
      { id: "c", scope: "venture", title: "c", dueOn: "2026-09-20", completedOn: "2026-09-10" },
    ],
  });
  const t = scoreTrack("entrepreneurship", f, policy);

  it("scores each component by its formula", () => {
    expect(round2(comp(t, "venture_traction"))).toBe(72);
    expect(round2(comp(t, "build_evidence"))).toBe(80);
    expect(round2(comp(t, "customer_validation"))).toBe(45);
    expect(round2(comp(t, "team_and_execution"))).toBe(66.67);
    expect(round2(comp(t, "academic_continuity"))).toBe(70);
  });
  it("totals 21.6 + 16 + 9 + 10 + 10.5 = 67.1", () => {
    expect(round2(t.score)).toBe(67.1);
  });
  it("needs the mentor's quality rating as well as the logs", () => {
    const noRating = facts({ ...f, ratings: [] });
    const c = scoreTrack("entrepreneurship", noRating, policy);
    expect(comp(c, "customer_validation")).toBe(0);
    expect(c.dataGaps).toContain("Mentor quality rating pending");
  });
  it("caps interviews at 15", () => {
    const lots = facts({
      ...f,
      evidence: Array.from({ length: 40 }, () => ev("customer_validation", "ATTESTED", { kind: "interview_log" })),
      ratings: [rating("customer_validation", 5)],
    });
    expect(comp(scoreTrack("entrepreneurship", lots, policy), "customer_validation")).toBe(100);
  });
});

describe("§5.3.4 Public Service and Government Exams", () => {
  // Valid streak days: 12 distinct days with a complete mock of at least 15 items inside the 30-day window.
  // Every other mock below falls on one of those days, so the day count stays 12.
  const streakDays = [
    ...Array.from({ length: 10 }, (_, i) => `2026-10-${String(10 - i).padStart(2, "0")}`),
    "2026-09-30",
    "2026-09-29",
  ];
  const f = facts({
    mocks: [
      ...[50, 60, 70].map((p, i) =>
        mock({ testType: "gs_full", date: `2026-10-0${i + 1}`, percentile: p, items: 100 }),
      ),
      mock({
        testType: "quant",
        date: "2026-10-04",
        difficulty: "easy",
        targetSecondsPerItem: 50,
        avgSecondsPerItem: 100,
      }), // 50
      mock({
        testType: "quant",
        date: "2026-10-05",
        difficulty: "hard",
        targetSecondsPerItem: 50,
        avgSecondsPerItem: 50,
      }), // 100
      mock({ testType: "weekly_test", date: "2026-10-06", score: 24, maxScore: 30 }), // 0.8
      mock({ testType: "weekly_test", date: "2026-10-07", score: 18, maxScore: 30 }), // 0.6
      ...streakDays.map((d) => mock({ testType: "practice", date: d, items: 20 })),
      mock({ testType: "practice", date: "2026-10-11", items: 10 }), // too short: no credit, no flag
    ],
    currentAffairsDates: Array.from({ length: 15 }, (_, i) => `2026-09-${String(12 + i).padStart(2, "0")}`),
    ratings: [rating("answer_writing", 3.5)],
  });
  const t = scoreTrack("public_service", f, policy);

  it("scores each component by its formula", () => {
    expect(round2(comp(t, "current_affairs_consistency"))).toBe(35); // 15/30 days × accuracy 0.7
    expect(round2(comp(t, "general_studies_mock"))).toBe(60);
    expect(round2(comp(t, "quantitative_speed"))).toBe(75); // mean of bands 50 and 100
    expect(round2(comp(t, "mock_streak"))).toBe(40); // 12 / 30
    expect(round2(comp(t, "answer_writing"))).toBe(62.5);
  });
  it("totals 8.75 + 18 + 15 + 6 + 6.25 = 54", () => {
    expect(round2(t.score)).toBe(54);
  });
  it("gives no streak credit for a day with only short sets", () => {
    const short = facts({ mocks: [mock({ testType: "practice", date: "2026-10-11", items: 14 })] });
    expect(comp(scoreTrack("public_service", short, policy), "mock_streak")).toBe(0);
  });
  it("refuses to run without a snapshot date, instead of reading the clock", () => {
    expect(() => scoreTrack("public_service", { ...f, asOf: undefined }, policy)).toThrow(/asOf is required/);
  });
  it("gate: CGPA must be above the eligibility floor of 5.0", () => {
    expect(checkGate("public_service", facts({ cgpa: 5.01 }), policy)).toBeNull();
    expect(checkGate("public_service", facts({ cgpa: 5 }), policy)).toBe("Not enough evidence yet");
    expect(checkGate("public_service", facts({ cgpa: null }), policy)).toBe("Not enough evidence yet");
    expect(gateReason("public_service", facts({ cgpa: 5 }), policy)).toMatch(/eligibility floor of 5/);
  });
});

describe("§5.3.5 Freelance and Creator Economy", () => {
  const f = facts({
    evidence: [
      ev("live_portfolio", "VERIFIED", { weight: 1 }), // 1 / 1 = 100
      ev("client_work", "ATTESTED", { weight: 3 }),
      ev("client_work", "SELF_REPORTED", { weight: 3 }), // 2.7 + 1.5 = 4.2 / 6 = 70
      ev("tool_certifications", "VERIFIED", { weight: 1 }),
      ev("tool_certifications", "ATTESTED", { weight: 1 }), // 1.9 / 3 = 63.33
      ev("live_deployments", "VERIFIED", { weight: 2, details: { uptimePct: 90 } }),
      ev("live_deployments", "VERIFIED", { weight: 2, details: { uptimePct: 100 } }), // 1.8 + 2 = 3.8 / 4 = 95
      ev("open_source_community", "VERIFIED", { weight: 2 }), // 2 / 3 = 66.67
    ],
  });
  const t = scoreTrack("freelance_creator", f, policy);
  it("scores each component by its formula", () => {
    expect(round2(comp(t, "live_portfolio"))).toBe(100);
    expect(round2(comp(t, "client_work"))).toBe(70);
    expect(round2(comp(t, "tool_certifications"))).toBe(63.33);
    expect(round2(comp(t, "live_deployments"))).toBe(95);
    expect(round2(comp(t, "open_source_community"))).toBe(66.67);
  });
  it("totals 25 + 21 + 9.5 + 19 + 6.67 = 81.17", () => {
    expect(round2(t.score)).toBe(81.17);
  });
  it("a live portfolio without owner proof counts at 0.6", () => {
    const live = facts({ evidence: [ev("live_portfolio", "LIVE_UNVERIFIED", { weight: 1 })] });
    expect(comp(scoreTrack("freelance_creator", live, policy), "live_portfolio")).toBe(60);
  });
  it("gate: attendance at or above the requirement", () => {
    expect(checkGate("freelance_creator", facts({ attendancePct: 75 }), policy)).toBeNull();
    expect(checkGate("freelance_creator", facts({ attendancePct: 74.9 }), policy)).toBe("Not enough evidence yet");
  });
});

describe("§5.3.6 Sports, Defense and NCC", () => {
  const f = facts({
    creditsHeld: 100,
    evidence: [
      // mean(Cooper 2100 m → band 75, stamina 80, BMI band borderline → 50) = 68.33
      ev("physical_fitness", "VERIFIED", {
        kind: "fitness_record",
        details: { cooperMetres: 2100, staminaScore: 80, bmiBand: "borderline" },
      }),
      ev("camp_training_attendance", "VERIFIED", {
        kind: "camp_record",
        details: { daysAttended: 8, daysRequired: 10 },
      }), // 80
      ev("competition_results", "ATTESTED", { kind: "medal", details: { level: "state" } }), // 2 × 0.9 = 1.8
      ev("competition_results", "VERIFIED", { kind: "medal", details: { level: "university" } }), // + 1 = 2.8 / 6 = 46.67
    ],
    ratings: [rating("psychometric", 4, "2026-09-01"), rating("psychometric", 3, "2026-09-10")], // mean 3.5 → 62.5
  });
  const t = scoreTrack("sports_defense_ncc", f, policy);
  it("scores each component by its formula", () => {
    expect(round2(comp(t, "physical_fitness"))).toBe(68.33);
    expect(round2(comp(t, "camp_training_attendance"))).toBe(80);
    expect(round2(comp(t, "competition_results"))).toBe(46.67);
    expect(round2(comp(t, "psychometric_readiness"))).toBe(62.5);
  });
  it("totals 20.5 + 16 + 11.67 + 15.63 = 63.79", () => {
    expect(round2(t.score)).toBe(63.79);
  });
  it("never outputs BMI as a number: only the band is read and shown", () => {
    const out = JSON.stringify(evaluate(f, policy));
    expect(out).not.toMatch(/bmi\W{0,4}\d/i);
    expect(t.components.find((c) => c.key === "physical_fitness")?.calculation).toMatch(/BMI band: borderline/);
  });
  it("an unsigned fitness record does not count", () => {
    const unsigned = facts({
      evidence: [ev("physical_fitness", "UNVERIFIED", { kind: "fitness_record", details: { cooperMetres: 3000 } })],
    });
    expect(comp(scoreTrack("sports_defense_ncc", unsigned, policy), "physical_fitness")).toBe(0);
  });
  it("takes the strongest signed record, so adding one never lowers the component", () => {
    const strong = ev("physical_fitness", "VERIFIED", { kind: "fitness_record", details: { staminaScore: 90 } });
    const weak = ev("physical_fitness", "VERIFIED", { kind: "fitness_record", details: { staminaScore: 20 } });
    const before = comp(scoreTrack("sports_defense_ncc", facts({ evidence: [strong] }), policy), "physical_fitness");
    const after = comp(
      scoreTrack("sports_defense_ncc", facts({ evidence: [strong, weak] }), policy),
      "physical_fitness",
    );
    expect(after).toBe(before);
  });
  it("gate: minimum credits held to preserve sports quota eligibility", () => {
    expect(checkGate("sports_defense_ncc", facts({ creditsHeld: 80 }), policy)).toBeNull();
    expect(checkGate("sports_defense_ncc", facts({ creditsHeld: 79 }), policy)).toBe("Not enough evidence yet");
    expect(checkGate("sports_defense_ncc", facts({ creditsHeld: null }), policy)).toBe("Not enough evidence yet");
  });
});

describe("gates (§5.3)", () => {
  it("a failed gate hides the score but adds or removes no points", () => {
    const base = facts({
      creditsHeld: 10,
      aspiration: { track: "sports_defense_ncc", targetOutcome: "t", readiness: 70 },
      ratings: [rating("psychometric", 5)],
    });
    const blocked = evaluate(base, policy);
    expect(blocked.scoreShown).toBe(false);
    expect(blocked.trackScore.gateFailed).toBe("Not enough evidence yet");
    const open = evaluate({ ...base, creditsHeld: 200 }, policy);
    expect(open.scoreShown).toBe(true);
    expect(open.trackScore.score).toBe(blocked.trackScore.score);
  });
  it("Corporate Placement needs one department standard item with counted evidence", () => {
    const none = facts({
      evidence: [ev("domain_practical_evidence", "UNVERIFIED", { standardItem: "gdt_assessment" })],
    });
    expect(checkGate("corporate_placement", none, policy)).toBe("Not enough evidence yet");
    const one = facts({
      evidence: [ev("domain_practical_evidence", "SELF_REPORTED", { standardItem: "gdt_assessment" })],
    });
    expect(checkGate("corporate_placement", one, policy)).toBeNull();
  });
});

describe("version stamp (§9.4)", () => {
  it("records the engine version on every evaluation", () => {
    expect(evaluate(facts(), policy).engineVersion).toBe(RULES_ENGINE_VERSION);
    expect(RULES_ENGINE_VERSION).toBe("0.2.0");
  });
});
