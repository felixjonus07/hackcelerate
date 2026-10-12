/**
 * Deterministic generator for the synthetic cohort (everything is SYNTHETIC; no real students).
 * Produces engine facts for every track, so each rubric has data to show in the demo. The seed
 * script inserts these facts into the base tables; nothing here touches the database.
 */
import type { Policy, TrackId, VerificationStatus } from "../src/server/policy/schema";
import { addDays } from "../src/server/rules/calendar";
import { FIXTURE_AS_OF } from "../src/server/rules/fixtures";
import type { EvidenceItem, FacultyRating, MockAttempt, StudentFacts } from "../src/server/rules/types";

export type Rand = () => number;

/** Deterministic PRNG so every seed produces the same cohort. */
export function mulberry32(seed: number): Rand {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIRST = [
  "Arjun",
  "Sneha",
  "Kavin",
  "Priya",
  "Rahul",
  "Ananya",
  "Vikram",
  "Meera",
  "Siddharth",
  "Nila",
  "Farhan",
  "Divya",
  "Joseph",
  "Harini",
  "Aditya",
  "Zoya",
  "Gautam",
  "Ishita",
  "Naveen",
  "Tanvi",
];
export const LAST = [
  "Kumar",
  "Iyer",
  "Reddy",
  "Nair",
  "Sharma",
  "Das",
  "Fernandes",
  "Pillai",
  "Khan",
  "Menon",
  "Rao",
  "Bose",
];

const TRACK_CYCLE: (TrackId | null)[] = [
  "corporate_placement",
  "corporate_placement",
  "higher_studies",
  "corporate_placement",
  "entrepreneurship",
  "public_service",
  "corporate_placement",
  "freelance_creator",
  "sports_defense_ncc",
  null,
];

export interface SeedRecord {
  facts: StudentFacts;
  name: string;
}

export function generateRecord(i: number, rand: Rand, policy: Policy): SeedRecord {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number, dp = 0) => Number((lo + rand() * (hi - lo)).toFixed(dp));
  const asOf = FIXTURE_AS_OF;
  const depts = Object.keys(policy.department_standards);
  const dept = depts[i % depts.length];
  const track = TRACK_CYCLE[i % TRACK_CYCLE.length];
  const year = pick([2, 3, 3, 4]);
  const att = between(track === "freelance_creator" ? 76 : 58, 96, 1);
  const slope = between(-3, 3, 1);
  const status = (...xs: VerificationStatus[]) => pick(xs);
  const id = (k: string) => `gen-${i}-${k}`;
  const ev = (over: Partial<EvidenceItem> & Pick<EvidenceItem, "component" | "label" | "status">): EvidenceItem => ({
    id: id(`${over.component}-${over.kind ?? "e"}-${Math.floor(rand() * 1e6)}`),
    source: "seed",
    ...over,
  });
  const evidence: EvidenceItem[] = [];
  const mocks: MockAttempt[] = [];
  const ratings: FacultyRating[] = [];
  const milestones: NonNullable<StudentFacts["milestones"]> = [];
  const currentAffairsDates: string[] = [];
  const mock = (over: Partial<MockAttempt> & { testType: string; daysAgo: number }): MockAttempt => {
    const { daysAgo, ...rest } = over;
    return {
      id: id(`m-${over.testType}-${daysAgo}`),
      date: addDays(asOf, -daysAgo),
      items: 40,
      percentile: between(35, 92),
      score: between(20, 38),
      maxScore: 40,
      avgSecondsPerItem: between(35, 70),
      source: "campus platform",
      status: "VERIFIED",
      ...rest,
    } as MockAttempt;
  };

  if (track === "corporate_placement" || track === null) {
    const items = Object.keys(policy.department_standards[dept].items);
    for (const [k, item] of items.entries())
      if (rand() > 0.35)
        evidence.push(
          ev({
            component: "domain_practical_evidence",
            standardItem: item,
            label: policy.department_standards[dept].items[item].label,
            status: status("VERIFIED", "VERIFIED", "ATTESTED", "SELF_REPORTED", "LIVE_UNVERIFIED", "UNDER_CHECK"),
            weight: policy.department_standards[dept].items[item].weight,
            kind: k === 0 ? "lab_record" : "project",
          }),
        );
    if (track && rand() > 0.3)
      ratings.push({
        id: id("r"),
        kind: "mock_interview",
        date: "2026-09-15",
        rating: between(2, 5, 1),
        status: "ATTESTED",
      });
  }
  if (track === "higher_studies") {
    for (const d of [30, 20, 9])
      mocks.push(
        mock({
          testType: "entrance",
          daysAgo: d,
          source: pick(["campus platform", "GATE-style practice (synthetic)"]),
          status: status("VERIFIED", "SELF_REPORTED"),
        }),
      );
    evidence.push(
      ev({
        component: "research_output",
        label: "Conference poster",
        kind: "paper",
        weight: 2,
        status: status("VERIFIED", "LIVE_UNVERIFIED", "SELF_REPORTED"),
      }),
    );
    if (rand() > 0.5)
      evidence.push(
        ev({
          component: "research_output",
          label: "Preprint",
          kind: "paper",
          weight: 3,
          status: status("LIVE_UNVERIFIED", "SELF_REPORTED"),
        }),
      );
    for (let k = 0; k < Math.floor(rand() * 4); k++)
      evidence.push(
        ev({
          component: "faculty_recommendation_readiness",
          label: `Statement of purpose draft ${k + 1}`,
          kind: "sop_review",
          status: "ATTESTED",
        }),
      );
    milestones.push(
      {
        id: id("ms1"),
        scope: "application",
        title: "Shortlist programmes",
        dueOn: "2026-08-30",
        completedOn: "2026-08-25",
      },
      {
        id: id("ms2"),
        scope: "application",
        title: "Entrance registration",
        dueOn: "2026-09-25",
        completedOn: rand() > 0.4 ? "2026-09-24" : null,
      },
      { id: id("ms3"), scope: "application", title: "Recommendation letters", dueOn: "2026-12-15", completedOn: null },
    );
  }
  if (track === "entrepreneurship") {
    evidence.push(
      ev({
        component: "venture_traction",
        label: "Pilot customer",
        kind: "client_reference",
        weight: 2,
        status: status("ATTESTED", "SELF_REPORTED"),
      }),
      ev({
        component: "build_evidence",
        label: "Deployed MVP",
        kind: "repository",
        weight: 2,
        status: status("VERIFIED", "LIVE_UNVERIFIED"),
      }),
    );
    const interviews = Math.floor(between(0, 14));
    for (let k = 0; k < interviews; k++)
      evidence.push(
        ev({
          component: "customer_validation",
          label: `Customer interview ${k + 1}`,
          kind: "interview_log",
          status: "ATTESTED",
        }),
      );
    if (interviews)
      ratings.push({
        id: id("cv"),
        kind: "customer_validation",
        date: "2026-09-20",
        rating: between(2.5, 5, 1),
        status: "ATTESTED",
      });
    milestones.push(
      { id: id("v1"), scope: "venture", title: "Prototype", dueOn: "2026-08-20", completedOn: "2026-08-18" },
      {
        id: id("v2"),
        scope: "venture",
        title: "First users",
        dueOn: "2026-09-20",
        completedOn: rand() > 0.5 ? "2026-09-30" : "2026-09-19",
      },
    );
  }
  if (track === "public_service") {
    for (const d of [25, 14, 5]) mocks.push(mock({ testType: "gs_full", daysAgo: d, items: 100 }));
    for (const [d, band] of [
      [18, "easy"],
      [10, "medium"],
      [3, "hard"],
    ] as const)
      mocks.push(
        mock({
          testType: "quant",
          daysAgo: d,
          items: 20,
          difficulty: band,
          targetSecondsPerItem: 50,
          avgSecondsPerItem: between(40, 90),
        }),
      );
    for (const d of [21, 14, 7])
      mocks.push(mock({ testType: "weekly_test", daysAgo: d, items: 30, score: between(14, 28), maxScore: 30 }));
    for (let d = 0; d < Math.floor(between(3, 25)); d++)
      mocks.push(mock({ testType: "practice", daysAgo: d, items: 20 }));
    for (let d = 0; d < Math.floor(between(4, 22)); d++) currentAffairsDates.push(addDays(asOf, -d * 1));
    ratings.push({
      id: id("aw"),
      kind: "answer_writing",
      date: "2026-09-18",
      rating: between(2, 5, 1),
      status: "ATTESTED",
    });
  }
  if (track === "freelance_creator") {
    evidence.push(
      ev({
        component: "live_portfolio",
        label: "Portfolio site",
        kind: "portfolio",
        status: status("VERIFIED", "LIVE_UNVERIFIED"),
      }),
      ev({
        component: "client_work",
        label: "Client gig",
        kind: "client_reference",
        weight: 3,
        status: status("ATTESTED", "SELF_REPORTED"),
      }),
      ev({
        component: "tool_certifications",
        label: "Design tool certificate",
        kind: "certificate",
        weight: 1,
        status: status("ATTESTED", "VERIFIED"),
      }),
      ev({
        component: "live_deployments",
        label: "Deployed app",
        kind: "repository",
        weight: 2,
        status: "VERIFIED",
        details: { uptimePct: between(90, 100, 1) },
      }),
      ev({
        component: "open_source_community",
        label: "Open-source contributions",
        kind: "repository",
        weight: 2,
        status: "VERIFIED",
      }),
    );
  }
  if (track === "sports_defense_ncc") {
    evidence.push(
      ev({
        component: "physical_fitness",
        label: "Fitness test record",
        kind: "fitness_record",
        status: "VERIFIED",
        details: {
          cooperMetres: Math.round(between(1500, 2800)),
          staminaScore: Math.round(between(50, 95)),
          bmiBand: pick(["in_range", "in_range", "borderline"]),
        },
      }),
      ev({
        component: "camp_training_attendance",
        label: "Annual training camp",
        kind: "camp_record",
        status: "VERIFIED",
        details: { daysAttended: Math.round(between(6, 10)), daysRequired: 10 },
      }),
      ev({
        component: "competition_results",
        label: "State championship",
        kind: "medal",
        status: "ATTESTED",
        details: { level: "state" },
      }),
    );
    ratings.push({
      id: id("ps"),
      kind: "psychometric",
      date: "2026-09-10",
      rating: between(2.5, 5, 1),
      status: "ATTESTED",
    });
  }

  const hasAptitude = rand() > 0.15;
  const facts: StudentFacts = {
    studentId: `STU-${1000 + i}`,
    asOf,
    department: dept,
    year,
    cgpa: between(5.6, 9.6, 2),
    attendancePct: att,
    creditsHeld: Math.round(between(60, 140)),
    aspiration: {
      track,
      targetOutcome: track ? `${policy.tracks[track]?.name} goal` : "Not yet chosen",
      targetType: track === "public_service" ? "public_service" : "sector",
      readiness: 70,
    },
    evidence,
    mocks,
    ratings,
    milestones,
    currentAffairsDates,
    verifiedInternshipHours: track === "corporate_placement" && rand() > 0.5 ? Math.round(between(0, 160)) : null,
    campusAptitudePercentile: track === "corporate_placement" && hasAptitude ? Math.round(between(30, 95)) : null,
    attendanceWeekly: [0, 1, 2, 3].map((w) => ({
      week: w + 1,
      value: Math.max(40, Math.min(100, att - slope * (3 - w))),
    })),
    activityLast60d: Math.round(between(track ? 4 : 0, 40)),
    artifactScore: Math.round(between(30, 85)),
    cohortArtifactP75: 66,
  };
  return { facts, name: `${pick(FIRST)} ${pick(LAST)}` };
}
