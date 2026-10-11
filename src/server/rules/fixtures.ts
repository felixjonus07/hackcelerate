/**
 * Synthetic records from the reference plan: worked examples (§20) and the
 * Appendix D seed dataset. Used by golden tests and the seed script.
 * SYNTHETIC — none of these are real students.
 */
import type { StudentFacts } from "./types";

/** The date every fixture describes; rubrics that depend on dates read it through `facts.asOf`. */
export const FIXTURE_AS_OF = "2026-10-11";

const base = (over: Partial<StudentFacts> & Pick<StudentFacts, "studentId" | "department" | "year">): StudentFacts => ({
  asOf: FIXTURE_AS_OF,
  cgpa: null,
  attendancePct: null,
  aspiration: {
    track: "corporate_placement",
    targetOutcome: "Offer from a core sector employer",
  },
  evidence: [],
  mocks: [],
  ratings: [],
  verifiedInternshipHours: null,
  campusAptitudePercentile: null,
  ...over,
});

/** §20.1 Example A — Mechanical student on Corporate Placement. Track score 48.14. */
export const ME_27 = base({
  studentId: "ME-27",
  department: "MECH",
  year: 3,
  cgpa: 7.4,
  attendancePct: 81,
  aspiration: {
    track: "corporate_placement",
    targetOutcome: "Offer from a core mechanical employer",
    targetType: "sector",
    readiness: 70,
  },
  campusAptitudePercentile: 52,
  verifiedInternshipHours: 0,
  evidence: [
    {
      id: "ev-me27-sw",
      component: "domain_practical_evidence",
      standardItem: "solidworks_lab",
      label: "SolidWorks lab completion",
      status: "VERIFIED",
      source: "erp",
    },
    {
      id: "ev-me27-acad",
      component: "domain_practical_evidence",
      standardItem: "autocad_lab",
      label: "AutoCAD lab",
      status: "ATTESTED",
      source: "faculty",
    },
    {
      id: "ev-me27-fact",
      component: "domain_practical_evidence",
      standardItem: "factory_internship_hours",
      label: "Factory internship log",
      status: "SELF_REPORTED",
      source: "upload",
    },
  ],
  ratings: [
    {
      id: "rt-me27-1",
      kind: "mock_interview",
      date: "2026-08-20",
      rating: 3,
      status: "ATTESTED",
    },
    {
      id: "rt-me27-2",
      kind: "mock_interview",
      date: "2026-09-10",
      rating: 3.5,
      status: "ATTESTED",
    },
    {
      id: "rt-me27-3",
      kind: "mock_interview",
      date: "2026-10-01",
      rating: 4,
      status: "ATTESTED",
    },
  ],
  attendanceWeekly: [
    { week: 1, value: 79 },
    { week: 2, value: 80 },
    { week: 3, value: 80 },
    { week: 4, value: 81 },
  ],
  mockPercentileWeekly: [
    { week: 1, value: 44 },
    { week: 2, value: 47 },
    { week: 3, value: 50 },
    { week: 4, value: 52 },
  ],
  activityLast60d: 18,
  verifiedProjects: 1,
});

/** §20.3 Example B — Detention Threat Builder (also seed SYN-03). */
export const CS_44 = base({
  studentId: "CS-44",
  department: "CSE",
  year: 3,
  cgpa: 7.9,
  attendancePct: 62,
  aspiration: {
    track: "entrepreneurship",
    targetOutcome: "Launch a funded venture",
    targetType: "venture",
    readiness: 70,
  },
  artifactScore: 71,
  cohortArtifactP75: 66,
  verifiedProjects: 3,
  evidence: [
    {
      id: "ev-cs44-oss",
      component: "build_evidence",
      label: "14 merged pull requests to an open-source project",
      status: "VERIFIED",
      source: "github",
      weight: 2,
    },
    {
      id: "ev-cs44-p1",
      component: "venture_traction",
      label: "Pilot customer 1 (E-Cell confirmed)",
      status: "ATTESTED",
      source: "ecell",
    },
    {
      id: "ev-cs44-p2",
      component: "venture_traction",
      label: "Pilot customer 2 (E-Cell confirmed)",
      status: "ATTESTED",
      source: "ecell",
    },
  ],
  ratings: [{ id: "rt-cs44-cv", kind: "customer_validation", date: "2026-09-20", rating: 4, status: "ATTESTED" }],
  milestones: [
    { id: "ms-cs44-1", scope: "venture", title: "Pilot signed", dueOn: "2026-08-15", completedOn: "2026-08-10" },
    { id: "ms-cs44-2", scope: "venture", title: "MVP live", dueOn: "2026-09-15", completedOn: "2026-09-14" },
    { id: "ms-cs44-3", scope: "venture", title: "First paid invoice", dueOn: "2026-10-01", completedOn: "2026-10-05" },
    { id: "ms-cs44-4", scope: "venture", title: "Seed pitch", dueOn: "2026-12-01", completedOn: null },
  ],
  attendanceWeekly: [
    { week: 1, value: 71 },
    { week: 2, value: 68 },
    { week: 3, value: 65 },
    { week: 4, value: 62 },
  ],
  activityLast60d: 40,
});

/** §20.4 Example C — False-Positive High Flyer (also seed SYN-01). */
export const EE_12 = base({
  studentId: "EE-12",
  department: "EEE",
  year: 4,
  cgpa: 9.2,
  attendancePct: 92,
  aspiration: {
    track: "corporate_placement",
    targetOutcome: "Offer from a core electrical employer",
    targetType: "sector",
    readiness: 70,
  },
  campusAptitudePercentile: 47,
  verifiedProjects: 0,
  verifiedInternshipHours: 62,
  evidence: [
    {
      id: "ev-ee12-lab",
      component: "domain_practical_evidence",
      standardItem: "embedded_lab_hours",
      label: "Embedded lab hours",
      status: "VERIFIED",
      source: "erp",
    },
  ],
  ratings: [
    {
      id: "rt-ee12-1",
      kind: "mock_interview",
      date: "2026-09-12",
      rating: 4,
      status: "ATTESTED",
    },
  ],
  activityLast60d: 12,
});

/** Appendix D seed dataset with expected personas and index floors. */
export const SEED_RECORDS: {
  facts: StudentFacts;
  expectedPersona: string | null;
  expectedFloor: "MODERATE" | "CRITICAL" | null;
}[] = [
  {
    facts: {
      ...EE_12,
      studentId: "SYN-01",
      department: "MECH",
      evidence: [
        {
          id: "ev-syn01-sw",
          component: "domain_practical_evidence",
          standardItem: "solidworks_lab",
          label: "SolidWorks lab completion",
          status: "VERIFIED",
          source: "erp",
        },
      ],
    },
    expectedPersona: "false_positive_high_flyer",
    expectedFloor: "MODERATE",
  },
  {
    facts: base({
      studentId: "SYN-02",
      department: "COMM",
      year: 3,
      cgpa: 8.1,
      attendancePct: 88,
      aspiration: {
        track: "corporate_placement",
        targetOutcome: "Analyst role in a finance firm",
        targetType: "sector",
        readiness: 70,
      },
      campusAptitudePercentile: 68,
      verifiedInternshipHours: 60,
      evidence: [
        {
          id: "ev-syn02-xl",
          component: "domain_practical_evidence",
          standardItem: "excel_financial_model",
          label: "Advanced Excel financial model",
          status: "VERIFIED",
          source: "faculty",
        },
        {
          id: "ev-syn02-tally",
          component: "domain_practical_evidence",
          standardItem: "tally_erp",
          label: "Tally ERP proficiency",
          status: "ATTESTED",
          source: "faculty",
        },
      ],
      ratings: [
        {
          id: "rt-syn02-1",
          kind: "mock_interview",
          date: "2026-09-20",
          rating: 4,
          status: "ATTESTED",
        },
      ],
      activityLast60d: 22,
      verifiedProjects: 1,
    }),
    expectedPersona: null,
    expectedFloor: null,
  },
  {
    facts: { ...CS_44, studentId: "SYN-03" },
    expectedPersona: "detention_threat_builder",
    expectedFloor: "CRITICAL",
  },
  {
    facts: base({
      studentId: "SYN-04",
      department: "BIOT",
      year: 3,
      cgpa: 7.8,
      attendancePct: 84,
      aspiration: {
        track: "corporate_placement",
        targetOutcome: "Clinical research associate",
        targetType: "sector",
        readiness: 70,
      },
      campusAptitudePercentile: 61,
      verifiedInternshipHours: 80,
      evidence: [
        {
          id: "ev-syn04-wet",
          component: "domain_practical_evidence",
          standardItem: "wet_lab_hours",
          label: "Wet-lab hours",
          status: "ATTESTED",
          source: "lab",
        },
        {
          id: "ev-syn04-gcp",
          component: "domain_practical_evidence",
          standardItem: "gcp_awareness",
          label: "Good Clinical Practice module",
          status: "UNDER_CHECK",
          source: "upload",
        },
      ],
      ratings: [
        {
          id: "rt-syn04-1",
          kind: "mock_interview",
          date: "2026-09-02",
          rating: 3.5,
          status: "ATTESTED",
        },
      ],
      activityLast60d: 9,
      verifiedProjects: 1,
    }),
    expectedPersona: null,
    expectedFloor: null,
  },
  {
    facts: base({
      studentId: "SYN-05",
      department: "LAW",
      year: 4,
      cgpa: 6.9,
      attendancePct: 79,
      aspiration: {
        track: "higher_studies",
        targetOutcome: "LLM admission abroad",
        targetType: "abroad",
        readiness: 70,
      },
      activeBacklogs: 3,
      monthsToDeadline: 8,
      evidence: [
        {
          id: "ev-syn05-moot",
          component: "research_output",
          label: "Moot court citations",
          status: "ATTESTED",
          source: "faculty",
          weight: 3,
        },
        {
          id: "ev-syn05-sop",
          component: "faculty_recommendation_readiness",
          label: "Statement of purpose reviewed by faculty",
          status: "ATTESTED",
          source: "faculty",
          kind: "sop_review",
        },
      ],
      milestones: [
        {
          id: "ms-syn05-1",
          scope: "application",
          title: "Shortlist universities",
          dueOn: "2026-08-30",
          completedOn: "2026-08-28",
        },
        {
          id: "ms-syn05-2",
          scope: "application",
          title: "Entrance exam registration",
          dueOn: "2026-09-30",
          completedOn: null,
        },
      ],
      activityLast60d: 6,
    }),
    expectedPersona: "aspiration_mismatch",
    expectedFloor: "MODERATE",
  },
  {
    facts: base({
      studentId: "SYN-06",
      department: "CIVIL",
      year: 3,
      cgpa: 6.4,
      attendancePct: 76,
      aspiration: { track: null, targetOutcome: "Not yet chosen" },
      activityLast60d: 0,
    }),
    expectedPersona: "drifting_student",
    expectedFloor: "MODERATE",
  },
  {
    facts: base({
      studentId: "SYN-07",
      department: "CIVIL",
      year: 4,
      cgpa: 7.1,
      attendancePct: 83,
      aspiration: {
        track: "public_service",
        targetOutcome: "Clear UPSC Civil Services prelims",
        targetType: "public_service",
        readiness: 70,
      },
      mocksLast60d: 0,
      monthsToDeadline: 10,
      currentAffairsDates: ["2026-09-20", "2026-09-27", "2026-10-04"],
      activityLast60d: 3,
    }),
    expectedPersona: "aspiration_mismatch",
    expectedFloor: "MODERATE",
  },
];
