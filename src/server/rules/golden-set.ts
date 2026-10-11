/**
 * Golden evaluation set (§15.3): 60 synthetic records, each with the persona and index band its designer
 * intended. The expectations are written from the plan's rules (boundaries, precedence, gates), not copied from
 * the engine, so a failure means the engine or the intent is wrong. The set includes the plan's worked examples
 * (§20) and the seven seed records (Appendix D). It runs on every model, prompt or policy change (§15.3).
 *
 * SYNTHETIC. Reference narratives are the rules-only narratives; mentors replace them before the pilot.
 */
import type { AegLevel, PersonaId, TrackId, VerificationStatus } from "../policy/schema";
import { addDays } from "./calendar";
import { CS_44, EE_12, FIXTURE_AS_OF, ME_27, SEED_RECORDS } from "./fixtures";
import type { EvidenceItem, FacultyRating, MockAttempt, StudentFacts } from "./types";

export interface GoldenCase {
  id: string;
  title: string;
  facts: StudentFacts;
  expect: {
    persona: PersonaId | null;
    /** The AEG index: the higher of the gap band and the persona floor. */
    band: AegLevel;
    scoreShown: boolean;
    /** Personas that matched but are queued behind the primary one (§7.4). */
    alsoMatched?: PersonaId[];
    attendanceFlag?: boolean;
    watchBand?: boolean;
  };
}

const base = (id: string, over: Partial<StudentFacts> = {}): StudentFacts => ({
  studentId: id,
  asOf: FIXTURE_AS_OF,
  department: "MECH",
  year: 3,
  cgpa: 7,
  attendancePct: 85,
  aspiration: { track: "corporate_placement", targetOutcome: "An offer", targetType: "sector", readiness: 70 },
  evidence: [],
  mocks: [],
  ratings: [],
  verifiedInternshipHours: null,
  campusAptitudePercentile: null,
  activityLast60d: 20,
  verifiedProjects: 0,
  ...over,
});

const ev = (component: string, status: VerificationStatus, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: `${component}-${over.standardItem ?? over.kind ?? status}-${Math.abs(hash(JSON.stringify(over) + status + component))}`,
  component,
  label: component,
  status,
  ...over,
});
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
const std = (item: string, status: VerificationStatus) =>
  ev("domain_practical_evidence", status, { standardItem: item, label: item });
const rate = (kind: FacultyRating["kind"], rating: number, date = "2026-09-10"): FacultyRating => ({
  id: `${kind}-${rating}-${date}`,
  kind,
  date,
  rating,
  status: "ATTESTED",
});
const mock = (testType: string, date: string, over: Partial<MockAttempt> = {}): MockAttempt => ({
  id: `${testType}-${date}-${over.percentile ?? 50}`,
  testType,
  date,
  items: 40,
  percentile: 60,
  avgSecondsPerItem: 40,
  status: "VERIFIED",
  ...over,
});

// ── Corporate Placement archetypes (Mechanical standards: 2 + 1 + 3 + 3 weights)
const cpStrong = (id: string, over: Partial<StudentFacts> = {}) =>
  base(id, {
    cgpa: 9,
    attendancePct: 95,
    campusAptitudePercentile: 85,
    evidence: [
      std("solidworks_lab", "VERIFIED"),
      std("autocad_lab", "VERIFIED"),
      std("gdt_assessment", "VERIFIED"),
      std("factory_internship_hours", "VERIFIED"),
    ],
    ratings: [rate("mock_interview", 5)],
    verifiedInternshipHours: 120,
    verifiedProjects: 2,
    ...over,
  });
const cpWeak = (id: string, over: Partial<StudentFacts> = {}) =>
  base(id, {
    cgpa: 5.8,
    attendancePct: 78,
    campusAptitudePercentile: 30,
    evidence: [std("solidworks_lab", "SELF_REPORTED")],
    ratings: [rate("mock_interview", 2)],
    verifiedInternshipHours: 0,
    ...over,
  });
/** A student with a moderate gap whose other facts can be varied to trigger one persona at a time. */
const cpMid = (id: string, over: Partial<StudentFacts> = {}) =>
  base(id, {
    cgpa: 7.4,
    attendancePct: 81,
    campusAptitudePercentile: 52,
    evidence: [
      std("solidworks_lab", "VERIFIED"),
      std("autocad_lab", "ATTESTED"),
      std("factory_internship_hours", "SELF_REPORTED"),
    ],
    ratings: [rate("mock_interview", 3.5)],
    verifiedInternshipHours: 0,
    ...over,
  });

const seed = (id: string) => SEED_RECORDS.find((r) => r.facts.studentId === id) as (typeof SEED_RECORDS)[number];

export const GOLDEN_SET: GoldenCase[] = [
  // ── A. The plan's worked examples and seed records (§20, Appendix D)
  {
    id: "G-01",
    title: "ME-27: mechanical student, moderate gap, no persona (§20.1)",
    facts: { ...ME_27 },
    expect: { persona: null, band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-02",
    title: "CS-44: attendance 62%, strong builder (§20.3)",
    facts: { ...CS_44 },
    expect: { persona: "detention_threat_builder", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-03",
    title: "EE-12: CGPA 9.2, aptitude 47, no projects (§20.4)",
    facts: { ...EE_12 },
    expect: { persona: "false_positive_high_flyer", band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-04",
    title: "SYN-01 high flyer, Mechanical",
    facts: { ...seed("SYN-01").facts },
    expect: { persona: "false_positive_high_flyer", band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-05",
    title: "SYN-02 commerce student: no coding, no penalty",
    facts: { ...seed("SYN-02").facts },
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-06",
    title: "SYN-03 detention threat builder",
    facts: { ...seed("SYN-03").facts },
    expect: { persona: "detention_threat_builder", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-07",
    title: "SYN-04 biotechnology: GCP module pending",
    facts: { ...seed("SYN-04").facts },
    expect: { persona: null, band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-08",
    title: "SYN-05 law: abroad target with 3 backlogs",
    facts: { ...seed("SYN-05").facts },
    expect: { persona: "aspiration_mismatch", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-09",
    title: "SYN-06 civil, no declared track, year 3",
    facts: { ...seed("SYN-06").facts },
    expect: { persona: "drifting_student", band: "CRITICAL", scoreShown: false },
  },
  {
    id: "G-10",
    title: "SYN-07 public service, no mocks in 60 days",
    facts: { ...seed("SYN-07").facts },
    expect: { persona: "aspiration_mismatch", band: "CRITICAL", scoreShown: true },
  },

  // ── B. High Flyer boundaries (CGPA ≥ 8.8, no verified projects, aptitude < 55)
  {
    id: "G-11",
    title: "High flyer: CGPA exactly 8.8 fires",
    facts: cpMid("G-11", { cgpa: 8.8, campusAptitudePercentile: 47 }),
    expect: { persona: "false_positive_high_flyer", band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-12",
    title: "High flyer: CGPA 8.79 does not fire",
    facts: cpMid("G-12", { cgpa: 8.79, campusAptitudePercentile: 47 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-13",
    title: "High flyer: aptitude 54 fires",
    facts: cpMid("G-13", { cgpa: 9.1, campusAptitudePercentile: 54 }),
    expect: { persona: "false_positive_high_flyer", band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-14",
    title: "High flyer: aptitude 55 does not fire",
    facts: cpMid("G-14", { cgpa: 9.1, campusAptitudePercentile: 55 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-15",
    title: "High flyer: one verified project does not fire",
    facts: cpMid("G-15", { cgpa: 9.1, campusAptitudePercentile: 47, verifiedProjects: 1 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true },
  },

  // ── Detention Threat Builder boundaries (attendance < 65, artifact score ≥ cohort p75)
  {
    id: "G-16",
    title: "Detention: 64.9% with artifact at the 75th percentile fires",
    facts: cpMid("G-16", { attendancePct: 64.9, artifactScore: 66, cohortArtifactP75: 66 }),
    expect: { persona: "detention_threat_builder", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-17",
    title: "Detention: 64.9% with artifact below p75 gives the attendance flag, no persona",
    facts: cpMid("G-17", { attendancePct: 64.9, artifactScore: 65, cohortArtifactP75: 66 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true, attendanceFlag: true },
  },
  {
    id: "G-18",
    title: "Detention: exactly 65% is the watch band, not a persona",
    facts: cpMid("G-18", { attendancePct: 65, artifactScore: 90, cohortArtifactP75: 66 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true, watchBand: true },
  },
  {
    id: "G-19",
    title: "Detention: 74% is still the watch band",
    facts: cpMid("G-19", { attendancePct: 74 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true, watchBand: true },
  },
  {
    id: "G-20",
    title: "Detention: 75% is not watched",
    facts: cpMid("G-20", { attendancePct: 75 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true, watchBand: false },
  },
  {
    id: "G-21",
    title: "Detention: no artifact data means no persona, only the flag",
    facts: cpMid("G-21", { attendancePct: 50 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true, attendanceFlag: true },
  },

  // ── Aspiration Mismatch boundaries
  {
    id: "G-22",
    title: "Mismatch abroad: 3 backlogs, 12 months fires",
    facts: cpMid("G-22", {
      aspiration: { track: "higher_studies", targetOutcome: "MS abroad", targetType: "abroad", readiness: 70 },
      activeBacklogs: 3,
      monthsToDeadline: 12,
    }),
    expect: { persona: "aspiration_mismatch", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-23",
    title: "Mismatch abroad: 2 backlogs does not fire",
    facts: cpMid("G-23", {
      aspiration: { track: "higher_studies", targetOutcome: "MS abroad", targetType: "abroad", readiness: 70 },
      activeBacklogs: 2,
      monthsToDeadline: 12,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-24",
    title: "Mismatch abroad: deadline in 13 months does not fire",
    facts: cpMid("G-24", {
      aspiration: { track: "higher_studies", targetOutcome: "MS abroad", targetType: "abroad", readiness: 70 },
      activeBacklogs: 3,
      monthsToDeadline: 13,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-25",
    title: "Mismatch public service: no mocks in 60 days, exam in 12 months fires",
    facts: base("G-25", {
      aspiration: {
        track: "public_service",
        targetOutcome: "Civil services",
        targetType: "public_service",
        readiness: 70,
      },
      mocksLast60d: 0,
      monthsToDeadline: 12,
    }),
    expect: { persona: "aspiration_mismatch", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-26",
    title: "Mismatch public service: one recent mock does not fire",
    facts: base("G-26", {
      aspiration: {
        track: "public_service",
        targetOutcome: "Civil services",
        targetType: "public_service",
        readiness: 70,
      },
      mocksLast60d: 1,
      monthsToDeadline: 12,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-27",
    title: "Mismatch public service: exam in 13 months does not fire",
    facts: base("G-27", {
      aspiration: {
        track: "public_service",
        targetOutcome: "Civil services",
        targetType: "public_service",
        readiness: 70,
      },
      mocksLast60d: 0,
      monthsToDeadline: 13,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },

  // ── Drifting Student (year ≥ 3, no declared track, CGPA ≤ 6.5, no activity in 60 days)
  {
    id: "G-28",
    title: "Drifting: year 3, no track, CGPA 6.5, no activity fires",
    facts: base("G-28", {
      cgpa: 6.5,
      activityLast60d: 0,
      aspiration: { track: null, targetOutcome: "Not yet chosen" },
    }),
    expect: { persona: "drifting_student", band: "CRITICAL", scoreShown: false },
  },
  {
    id: "G-29",
    title: "Drifting: CGPA 6.51 does not fire",
    facts: base("G-29", {
      cgpa: 6.51,
      activityLast60d: 0,
      aspiration: { track: null, targetOutcome: "Not yet chosen" },
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: false },
  },
  {
    id: "G-30",
    title: "Drifting: year 2 does not fire",
    facts: base("G-30", {
      year: 2,
      cgpa: 6,
      activityLast60d: 0,
      aspiration: { track: null, targetOutcome: "Not yet chosen" },
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: false },
  },
  {
    id: "G-31",
    title: "Drifting: a declared track does not fire",
    facts: cpWeak("G-31", { cgpa: 6, activityLast60d: 0 }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },

  // ── Precedence when several personas match (§7.4): detention > mismatch > high flyer > drifting
  {
    id: "G-32",
    title: "Precedence: detention outranks mismatch and high flyer",
    facts: cpMid("G-32", {
      cgpa: 9,
      campusAptitudePercentile: 47,
      attendancePct: 60,
      artifactScore: 90,
      cohortArtifactP75: 66,
      aspiration: { track: "higher_studies", targetOutcome: "MS abroad", targetType: "abroad", readiness: 70 },
      activeBacklogs: 3,
      monthsToDeadline: 8,
    }),
    expect: {
      persona: "detention_threat_builder",
      band: "CRITICAL",
      scoreShown: true,
      alsoMatched: ["aspiration_mismatch"],
    },
  },
  {
    id: "G-33",
    title: "Precedence: mismatch outranks high flyer",
    facts: cpMid("G-33", {
      cgpa: 9,
      campusAptitudePercentile: 47,
      aspiration: { track: "higher_studies", targetOutcome: "MS abroad", targetType: "abroad", readiness: 70 },
      activeBacklogs: 3,
      monthsToDeadline: 8,
    }),
    expect: {
      persona: "aspiration_mismatch",
      band: "CRITICAL",
      scoreShown: true,
      alsoMatched: ["false_positive_high_flyer"],
    },
  },
  {
    id: "G-34",
    title: "Precedence: a persona floor never lowers a worse gap",
    facts: cpWeak("G-34", { cgpa: 9, campusAptitudePercentile: 30 }),
    expect: { persona: "false_positive_high_flyer", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-35",
    title: "No persona, small gap: index LOW",
    facts: cpStrong("G-35"),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-36",
    title: "No persona, large gap: index CRITICAL",
    facts: cpWeak("G-36"),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },

  // ── Every track at a low and a critical gap
  {
    id: "G-37",
    title: "Higher studies, well evidenced",
    facts: base("G-37", {
      cgpa: 8,
      attendancePct: 90,
      aspiration: { track: "higher_studies", targetOutcome: "MS", targetType: "program", readiness: 70 },
      mocks: [60, 70, 80].map((p, i) => mock("entrance", `2026-09-0${i + 1}`, { percentile: p })),
      evidence: [
        ev("research_output", "VERIFIED", { weight: 3 }),
        ev("research_output", "VERIFIED", { weight: 3 }),
        ev("faculty_recommendation_readiness", "ATTESTED", { kind: "sop_review" }),
        ev("faculty_recommendation_readiness", "ATTESTED", { kind: "sop_review" }),
        ev("faculty_recommendation_readiness", "ATTESTED", { kind: "sop_review" }),
      ],
      milestones: [
        { id: "m1", scope: "application", title: "a", dueOn: "2026-08-01", completedOn: "2026-07-30" },
        { id: "m2", scope: "application", title: "b", dueOn: "2026-09-01", completedOn: "2026-09-01" },
      ],
    }),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-38",
    title: "Higher studies, nothing evidenced yet",
    facts: base("G-38", {
      aspiration: { track: "higher_studies", targetOutcome: "MS", targetType: "program", readiness: 70 },
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-39",
    title: "Entrepreneurship, strong traction",
    facts: base("G-39", {
      cgpa: 7,
      attendancePct: 80,
      aspiration: { track: "entrepreneurship", targetOutcome: "Launch", targetType: "venture", readiness: 70 },
      evidence: [
        ev("venture_traction", "ATTESTED", { weight: 3 }),
        ev("venture_traction", "ATTESTED", { weight: 3 }),
        ev("build_evidence", "VERIFIED", { weight: 2 }),
        ev("build_evidence", "VERIFIED", { weight: 2 }),
        ...Array.from({ length: 15 }, (_, i) =>
          ev("customer_validation", "ATTESTED", { kind: "interview_log", id: `iv-${i}` }),
        ),
      ],
      ratings: [rate("customer_validation", 5)],
      milestones: [
        { id: "v1", scope: "venture", title: "a", dueOn: "2026-08-01", completedOn: "2026-08-01" },
        { id: "v2", scope: "venture", title: "b", dueOn: "2026-09-01", completedOn: "2026-08-30" },
      ],
    }),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-40",
    title: "Entrepreneurship, idea only",
    facts: base("G-40", {
      aspiration: { track: "entrepreneurship", targetOutcome: "Launch", targetType: "venture", readiness: 70 },
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-41",
    title: "Public service, steady practice",
    facts: base("G-41", {
      cgpa: 8,
      attendancePct: 90,
      aspiration: {
        track: "public_service",
        targetOutcome: "Civil services",
        targetType: "public_service",
        readiness: 70,
      },
      mocksLast60d: 12,
      monthsToDeadline: 10,
      mocks: [
        ...[80, 85, 90].map((p, i) => mock("gs_full", `2026-10-0${i + 1}`, { percentile: p, items: 100 })),
        mock("quant", "2026-10-04", { targetSecondsPerItem: 50, avgSecondsPerItem: 50 }),
        mock("weekly_test", "2026-10-05", { score: 28, maxScore: 30 }),
        ...Array.from({ length: 30 }, (_, i) =>
          mock("practice", addDays(FIXTURE_AS_OF, -i), { items: 20, id: `p-${i}` }),
        ),
      ],
      currentAffairsDates: Array.from({ length: 28 }, (_, i) => addDays(FIXTURE_AS_OF, -i)),
      ratings: [rate("answer_writing", 5)],
    }),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-42",
    title: "Public service, not started, exam far away",
    facts: base("G-42", {
      aspiration: {
        track: "public_service",
        targetOutcome: "Civil services",
        targetType: "public_service",
        readiness: 70,
      },
      mocksLast60d: 0,
      monthsToDeadline: 30,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-43",
    title: "Freelance, portfolio and clients in place",
    facts: base("G-43", {
      attendancePct: 80,
      aspiration: { track: "freelance_creator", targetOutcome: "Freelance", targetType: "sector", readiness: 70 },
      evidence: [
        ev("live_portfolio", "VERIFIED", { weight: 1 }),
        ev("client_work", "ATTESTED", { weight: 3 }),
        ev("client_work", "ATTESTED", { weight: 3 }),
        ev("tool_certifications", "VERIFIED", { weight: 2 }),
        ev("tool_certifications", "VERIFIED", { weight: 1 }),
        ev("live_deployments", "VERIFIED", { weight: 4 }),
        ev("open_source_community", "VERIFIED", { weight: 3 }),
      ],
    }),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-44",
    title: "Freelance, nothing shown yet",
    facts: base("G-44", {
      attendancePct: 80,
      aspiration: { track: "freelance_creator", targetOutcome: "Freelance", targetType: "sector", readiness: 70 },
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-45",
    title: "Sports and NCC, fit and decorated",
    facts: base("G-45", {
      creditsHeld: 120,
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Commission", targetType: "exam", readiness: 70 },
      evidence: [
        ev("physical_fitness", "VERIFIED", {
          kind: "fitness_record",
          details: { cooperMetres: 2600, staminaScore: 90, bmiBand: "in_range" },
        }),
        ev("camp_training_attendance", "VERIFIED", {
          kind: "camp_record",
          details: { daysAttended: 10, daysRequired: 10 },
        }),
        ev("competition_results", "ATTESTED", { kind: "medal", details: { level: "national" } }),
        ev("competition_results", "ATTESTED", { kind: "medal", details: { level: "state" } }),
        ev("competition_results", "VERIFIED", { kind: "medal", details: { level: "university" } }),
      ],
      ratings: [rate("psychometric", 5)],
    }),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-46",
    title: "Sports and NCC, eligible but no records",
    facts: base("G-46", {
      creditsHeld: 120,
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Commission", targetType: "exam", readiness: 70 },
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-47",
    title: "Corporate placement, strong in every part",
    facts: cpStrong("G-47", {
      department: "COMM",
      evidence: ["excel_financial_model", "tally_erp", "taxation_knowledge"].map((i) => std(i, "VERIFIED")),
    }),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-48",
    title: "Corporate placement, civil: one lab record only",
    facts: base("G-48", {
      department: "CIVIL",
      cgpa: 7,
      attendancePct: 80,
      campusAptitudePercentile: 40,
      evidence: [std("site_visit_log", "ATTESTED")],
      ratings: [rate("mock_interview", 2.5)],
      verifiedInternshipHours: 20,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },

  // ── Gates (§5.3): a failed gate hides the score but still routes
  {
    id: "G-49",
    title: "Gate: public service needs CGPA above 5.0 (exactly 5.0 fails)",
    facts: base("G-49", {
      cgpa: 5,
      aspiration: {
        track: "public_service",
        targetOutcome: "Civil services",
        targetType: "public_service",
        readiness: 70,
      },
      mocksLast60d: 5,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: false },
  },
  {
    id: "G-50",
    title: "Gate: freelance needs attendance at the requirement (74.9 fails)",
    facts: base("G-50", {
      attendancePct: 74.9,
      aspiration: { track: "freelance_creator", targetOutcome: "Freelance", targetType: "sector", readiness: 70 },
      evidence: [ev("live_portfolio", "VERIFIED", { weight: 1 })],
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: false, watchBand: true },
  },
  {
    id: "G-51",
    title: "Gate: sports needs the minimum credits (79 fails)",
    facts: base("G-51", {
      creditsHeld: 79,
      aspiration: { track: "sports_defense_ncc", targetOutcome: "Commission", targetType: "exam", readiness: 70 },
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: false },
  },
  {
    id: "G-52",
    title: "Gate: corporate placement needs one counted department item",
    facts: cpMid("G-52", { evidence: [std("gdt_assessment", "UNVERIFIED")] }),
    expect: { persona: null, band: "CRITICAL", scoreShown: false },
  },

  // ── Confidence and data quality (§4.3, §5.6)
  {
    id: "G-53",
    title: "Everything verified, nothing missing: score computed",
    facts: cpStrong("G-53"),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-54",
    title: "CGPA missing from the ERP: a missing part never raises the score, so the academic part halves",
    facts: cpMid("G-54", { cgpa: null }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-55",
    title: "Attendance missing: the academic part halves rather than rising to the CGPA alone",
    facts: cpMid("G-55", { attendancePct: null }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-56",
    title: "Self-reported evidence only: counts at half weight",
    facts: cpMid("G-56", {
      evidence: [
        std("solidworks_lab", "SELF_REPORTED"),
        std("gdt_assessment", "SELF_REPORTED"),
        std("factory_internship_hours", "SELF_REPORTED"),
      ],
    }),
    expect: { persona: null, band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-57",
    title: "A source failed this week: confidence drops",
    facts: cpMid("G-57", { recentSourceFailures: 1 }),
    expect: { persona: null, band: "MODERATE", scoreShown: true },
  },
  {
    id: "G-58",
    title: "Strong student with a high CGPA and good aptitude is not a high flyer",
    facts: cpStrong("G-58", { cgpa: 9.4, verifiedProjects: 0 }),
    expect: { persona: null, band: "LOW", scoreShown: true },
  },
  {
    id: "G-59",
    title: "Low attendance, good evidence, but a gentle gap: persona floor lifts the index",
    facts: cpStrong("G-59", { attendancePct: 60, artifactScore: 80, cohortArtifactP75: 66 }),
    expect: { persona: "detention_threat_builder", band: "CRITICAL", scoreShown: true },
  },
  {
    id: "G-60",
    title: "Abroad target but few backlogs and a distant deadline: no persona, large gap stays CRITICAL",
    facts: cpWeak("G-60", {
      aspiration: { track: "higher_studies", targetOutcome: "MS abroad", targetType: "abroad", readiness: 70 },
      activeBacklogs: 1,
      monthsToDeadline: 20,
    }),
    expect: { persona: null, band: "CRITICAL", scoreShown: true },
  },
];

export const GOLDEN_TRACKS: TrackId[] = [
  "corporate_placement",
  "higher_studies",
  "entrepreneurship",
  "public_service",
  "freelance_creator",
  "sports_defense_ncc",
];
