/**
 * Track rubrics (§5.3). Weights come from the policy file; this module only
 * defines *how* each component turns facts into a 0–100 score.
 *
 * Corporate Placement and Public Service are fully specified in the reference
 * plan. The other tracks are marked "assumed" in §5.1 and are implemented with
 * the same component kinds; their required-item lists are a Phase 2 task.
 */
import type { Policy, TrackId, VerificationStatus } from "../../policy/schema";
import {
  attendanceScore,
  average,
  cgpaScore,
  evidenceScore,
  multiplier,
  percentileScore,
  ratingScore,
  speedScore,
  streakScore,
} from "../normalize";
import type { ComponentResult, FacultyRating, StudentFacts } from "../types";

type ComponentCalc = (
  facts: StudentFacts,
  policy: Policy,
  ctx: { track: TrackId; key: string },
) => Omit<ComponentResult, "key" | "weight" | "contribution" | "label">;

const LABELS: Record<string, string> = {
  academic_baseline: "Academic baseline",
  aptitude: "Aptitude",
  domain_practical_evidence: "Domain practical evidence",
  mock_interview_readiness: "Mock interview readiness",
  verified_experience: "Verified experience",
  entrance_exam_readiness: "Entrance exam readiness",
  research_output: "Research output",
  faculty_recommendation_readiness: "Faculty recommendation readiness",
  application_timeline_adherence: "Application timeline adherence",
  venture_traction: "Venture traction",
  build_evidence: "Build evidence",
  customer_validation: "Customer validation",
  team_and_execution: "Team and execution",
  academic_continuity: "Academic continuity",
  current_affairs_consistency: "Current affairs consistency",
  general_studies_mock: "General studies mock",
  quantitative_speed: "Quantitative speed",
  mock_streak: "Mock streak",
  answer_writing: "Answer writing",
  live_portfolio: "Live portfolio",
  client_work: "Client work",
  tool_certifications: "Tool certifications",
  live_deployments: "Live deployments",
  open_source_community: "Open source and community",
  physical_fitness: "Physical fitness",
  camp_training_attendance: "Camp and training attendance",
  competition_results: "Competition results",
  psychometric_readiness: "Psychometric readiness",
};

export const componentLabel = (key: string) => LABELS[key] ?? key;

const fmt = (x: number) => (Math.round(x * 100) / 100).toString();

// ── Component kinds ─────────────────────────────────────────────────────────

/** Equal-weight average of the CGPA score and the attendance score. */
const academic: ComponentCalc = (f, p) => {
  const gaps: string[] = [];
  const parts: number[] = [];
  const calc: string[] = [];
  if (f.cgpa == null) gaps.push("CGPA missing from ERP import");
  else {
    const s = cgpaScore(f.cgpa, p);
    parts.push(s);
    calc.push(`CGPA score (${f.cgpa} − 5) / 5 → ${fmt(s)}`);
  }
  if (f.attendancePct == null) gaps.push("Attendance missing from ERP import");
  else {
    const s = attendanceScore(f.attendancePct, p);
    parts.push(s);
    calc.push(`attendance ${f.attendancePct} / ${p.attendance.requirement_pct} capped at 1 → ${fmt(s)}`);
  }
  return {
    score: parts.length === 2 ? average(parts) : parts.length ? parts[0] / 2 : 0,
    evidenceRefs: ["erp:cgpa", "erp:attendance"].filter((_, i) => (i === 0 ? f.cgpa : f.attendancePct) != null),
    dataGaps: gaps,
    calculation: `${calc.join("; ")}${parts.length === 2 ? "; average" : ""}`,
  };
};

/** Campus aptitude percentile, falling back to the internal mock percentile. */
const aptitude: ComponentCalc = (f) => {
  const value = f.campusAptitudePercentile ?? f.internalAptitudePercentile ?? null;
  if (value == null)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["Campus aptitude test not taken yet"],
      calculation: "no aptitude percentile on record",
    };
  const source = f.campusAptitudePercentile != null ? "campus percentile" : "internal mock percentile";
  return {
    score: percentileScore(value),
    evidenceRefs: [f.campusAptitudePercentile != null ? "test:campus_aptitude" : "test:internal_aptitude"],
    dataGaps: [],
    calculation: `${source} ${value}`,
  };
};

function bestStatus(statuses: VerificationStatus[], p: Policy): VerificationStatus {
  return statuses.reduce((best, s) => (multiplier(s, p) > multiplier(best, p) ? s : best));
}

/** Evidence score over the department's standard items (§5.4). */
const departmentStandards: ComponentCalc = (f, p, { key }) => {
  const dept = p.department_standards[f.department];
  if (!dept)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: [`No standards defined for department ${f.department}`],
      calculation: "department standards missing from policy",
    };
  const required = Object.entries(dept.items).map(([k, v]) => ({
    key: k,
    weight: v.weight,
  }));
  const found = new Map<string, VerificationStatus>();
  const refs: string[] = [];
  for (const item of required) {
    const matches = f.evidence.filter((e) => e.component === key && e.standardItem === item.key);
    if (matches.length) {
      found.set(
        item.key,
        bestStatus(
          matches.map((m) => m.status),
          p,
        ),
      );
      refs.push(...matches.map((m) => m.id));
    }
  }
  const gaps = required
    .filter((r) => {
      const s = found.get(r.key);
      return !s || multiplier(s, p) === 0;
    })
    .map((r) => `${dept.items[r.key].label}: no counted evidence yet`);
  const total = required.reduce((s, r) => s + r.weight, 0);
  const terms = required
    .map((r) => {
      const s = found.get(r.key);
      return `${r.weight} × ${(s ? multiplier(s, p) : 0).toFixed(2)}`;
    })
    .join(" + ");
  return {
    score: evidenceScore(required, found, p),
    evidenceRefs: refs,
    dataGaps: gaps,
    calculation: `(${terms}) / ${total} × 100`,
  };
};

function latestRatings(f: StudentFacts, kind: FacultyRating["kind"], n: number, p: Policy) {
  return f.ratings
    .filter((r) => r.kind === kind && multiplier(r.status, p) > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

const ratingsOf =
  (kind: FacultyRating["kind"], window = 3, gapLabel = "No faculty ratings yet"): ComponentCalc =>
  (f, p) => {
    const rs = latestRatings(f, kind, window, p);
    if (!rs.length)
      return {
        score: 0,
        evidenceRefs: [],
        dataGaps: [gapLabel],
        calculation: "no ratings",
      };
    const avg = average(rs.map((r) => r.rating));
    return {
      score: ratingScore(avg),
      evidenceRefs: rs.map((r) => r.id),
      dataGaps: [],
      calculation: `(${fmt(avg)} − 1) / 4 × 100`,
    };
  };

/** Verified internship hours / full hours, capped at 1, × 100. */
const internship: ComponentCalc = (f, p, { track }) => {
  const full = Number(p.tracks[track]?.params.internship_hours_full ?? 120);
  if (f.verifiedInternshipHours == null)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No internship record"],
      calculation: "no record",
    };
  return {
    score: Math.min(1, f.verifiedInternshipHours / full) * 100,
    evidenceRefs: ["placement:internship_hours"],
    dataGaps: [],
    calculation: `${f.verifiedInternshipHours} verified hours / ${full}`,
  };
};

/** Evidence score over the items the student has for this component. */
const evidenceOf: ComponentCalc = (f, p, { key }) => {
  const items = f.evidence.filter((e) => e.component === key);
  if (!items.length)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: [`${componentLabel(key)}: no evidence yet`],
      calculation: "no evidence",
    };
  const required = items.map((e) => ({ key: e.id, weight: e.weight ?? 1 }));
  const found = new Map(items.map((e) => [e.id, e.status] as const));
  return {
    score: evidenceScore(required, found, p),
    evidenceRefs: items.map((e) => e.id),
    dataGaps: items.filter((e) => multiplier(e.status, p) === 0).map((e) => `${e.label}: not counted (${e.status})`),
    calculation: `Σ(weight × multiplier) / Σ weight over ${items.length} item(s)`,
  };
};

const mockPercentile =
  (testType: string, window: number): ComponentCalc =>
  (f, p) => {
    const ms = f.mocks
      .filter((m) => m.testType === testType && multiplier(m.status, p) > 0)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, window);
    if (!ms.length)
      return {
        score: 0,
        evidenceRefs: [],
        dataGaps: [`No ${testType} mocks yet`],
        calculation: "no mocks",
      };
    const avg = average(ms.map((m) => m.percentile));
    return {
      score: percentileScore(avg),
      evidenceRefs: ms.map((m) => m.id),
      dataGaps: [],
      calculation: `average percentile of latest ${ms.length}: ${fmt(avg)}`,
    };
  };

const mockSpeed =
  (testType: string): ComponentCalc =>
  (f, p) => {
    const ms = f.mocks.filter((m) => m.testType === testType && m.targetSecondsPerItem && multiplier(m.status, p) > 0);
    if (!ms.length)
      return {
        score: 0,
        evidenceRefs: [],
        dataGaps: [`No timed ${testType} sets yet`],
        calculation: "no timed sets",
      };
    const s = average(ms.map((m) => speedScore(m.targetSecondsPerItem ?? 0, m.avgSecondsPerItem)));
    return {
      score: s,
      evidenceRefs: ms.map((m) => m.id),
      dataGaps: [],
      calculation: `average speed score over ${ms.length} set(s)`,
    };
  };

const streak: ComponentCalc = (f) =>
  f.streakValidDays == null
    ? {
        score: 0,
        evidenceRefs: [],
        dataGaps: ["No streak data"],
        calculation: "no data",
      }
    : {
        score: streakScore(f.streakValidDays),
        evidenceRefs: ["platform:streak"],
        dataGaps: [],
        calculation: `min(${f.streakValidDays}, 30) / 30 × 100`,
      };

/** A score computed upstream (ingestion) and passed in as 0–100. */
const precomputed: ComponentCalc = (f, _p, { key }) => {
  const v = f.precomputed?.[key];
  return v == null
    ? {
        score: 0,
        evidenceRefs: [],
        dataGaps: [`${componentLabel(key)}: no record yet`],
        calculation: "no record",
      }
    : {
        score: Math.max(0, Math.min(100, v)),
        evidenceRefs: [`record:${key}`],
        dataGaps: [],
        calculation: `recorded score ${fmt(v)}`,
      };
};

// ── Track specs ─────────────────────────────────────────────────────────────

export const RUBRICS: Record<TrackId, Record<string, ComponentCalc>> = {
  corporate_placement: {
    academic_baseline: academic,
    aptitude,
    domain_practical_evidence: departmentStandards,
    mock_interview_readiness: ratingsOf("mock_interview", 3, "No faculty mock interviews yet"),
    verified_experience: internship,
  },
  higher_studies: {
    academic_baseline: academic,
    entrance_exam_readiness: mockPercentile("entrance", 5),
    research_output: evidenceOf,
    faculty_recommendation_readiness: precomputed,
    application_timeline_adherence: precomputed,
  },
  entrepreneurship: {
    venture_traction: evidenceOf,
    build_evidence: evidenceOf,
    customer_validation: precomputed,
    team_and_execution: precomputed,
    academic_continuity: academic,
  },
  public_service: {
    current_affairs_consistency: precomputed,
    general_studies_mock: mockPercentile("gs_full", 3),
    quantitative_speed: mockSpeed("quant"),
    mock_streak: streak,
    answer_writing: ratingsOf("answer_writing", 3, "No answer-writing ratings yet"),
  },
  freelance_creator: {
    live_portfolio: evidenceOf,
    client_work: evidenceOf,
    tool_certifications: evidenceOf,
    live_deployments: evidenceOf,
    open_source_community: evidenceOf,
  },
  sports_defense_ncc: {
    physical_fitness: precomputed,
    camp_training_attendance: precomputed,
    competition_results: precomputed,
    psychometric_readiness: ratingsOf("psychometric", 3, "No psychometric ratings yet"),
  },
};

/** Gates (§5.3): conditions that must hold before a track score is shown. */
export function checkGate(track: TrackId, facts: StudentFacts, policy: Policy): string | null {
  const gate = policy.tracks[track]?.gate;
  switch (gate) {
    case null:
    case undefined:
      return null;
    case "at_least_one_department_standard_item": {
      const counted = facts.evidence.some((e) => e.standardItem && multiplier(e.status, policy) > 0);
      return counted ? null : "Not enough evidence yet";
    }
    case "cgpa_above_eligibility_floor":
      return facts.cgpa != null && facts.cgpa > policy.academic.eligibility_cgpa_above
        ? null
        : "CGPA is not above the eligibility floor";
    case "attendance_at_or_above_requirement":
      return facts.attendancePct != null && facts.attendancePct >= policy.attendance.requirement_pct
        ? null
        : "Attendance is below the requirement";
    case "minimum_credits_held":
      return facts.precomputed?.minimum_credits_held === 0 ? "Minimum credits not held" : null;
    default:
      return `Unknown gate ${gate}`;
  }
}
