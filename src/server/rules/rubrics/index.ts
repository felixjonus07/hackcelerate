/**
 * Track rubrics (§5.3). Weights come from the policy file; this module only
 * defines *how* each component turns facts into a 0–100 score.
 *
 * Implements deterministic rubrics for all six tracks (§5.3):
 * 1. Corporate Placement (§5.3.1, §5.4)
 * 2. Higher Studies and Research (§5.3.2) - mixed-source lowest-multiplier rule
 * 3. Entrepreneurship and Startups (§5.3.3)
 * 4. Public Service and Government Exams (§5.3.4)
 * 5. Freelance and Creator Economy (§5.3.5)
 * 6. Sports, Defense and NCC (§5.3.6) - BMI band only, never numeric
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

// ── Shared Component Calculators ───────────────────────────────────────────

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

/** Campus aptitude percentile, falling back to the internal mock percentile (§5.3.1). */
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

// ── Track-Specific Calculators ─────────────────────────────────────────────

/**
 * Higher Studies Entrance Exam Readiness (§5.3.2):
 * Average percentile on practice tests, with speed score as sub-measure.
 * Mixed-source rule: Scored at the lowest verification multiplier used.
 */
const entranceExamReadiness: ComponentCalc = (f, p) => {
  const ms = f.mocks.filter(
    (m) =>
      (m.testType === "entrance" || m.testType === "gre" || m.testType === "gate" || m.testType === "cat") &&
      multiplier(m.status, p) > 0,
  );
  if (!ms.length) {
    const pre = f.precomputed?.entrance_exam_readiness ?? f.precomputed?.entrance;
    if (pre != null) {
      return {
        score: Math.max(0, Math.min(100, pre)),
        evidenceRefs: ["record:entrance_exam_readiness"],
        dataGaps: [],
        calculation: `recorded entrance score: ${fmt(pre)}`,
      };
    }
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No entrance exam practice tests on record"],
      calculation: "no entrance practice tests",
    };
  }

  const mults = ms.map((m) => multiplier(m.status, p));
  const lowestMult = Math.min(...mults);

  const avgPercentile = average(ms.map((m) => m.percentile));
  const timed = ms.filter((m) => m.targetSecondsPerItem && m.avgSecondsPerItem > 0);

  let rawScore = avgPercentile;
  let calcText = `average percentile ${fmt(avgPercentile)}`;
  if (timed.length) {
    const avgSpeed = average(timed.map((m) => speedScore(m.targetSecondsPerItem ?? 0, m.avgSecondsPerItem)));
    rawScore = avgPercentile * 0.7 + avgSpeed * 0.3;
    calcText = `(0.7 × ${fmt(avgPercentile)} percentile + 0.3 × ${fmt(avgSpeed)} speed)`;
  }

  const finalScore = Math.max(0, Math.min(100, rawScore * lowestMult));
  return {
    score: finalScore,
    evidenceRefs: ms.map((m) => m.id),
    dataGaps: [],
    calculation:
      lowestMult < 1.0
        ? `${calcText} × ${lowestMult.toFixed(2)} lowest multiplier (mixed/discounted sources) → ${fmt(finalScore)}`
        : `${calcText} → ${fmt(finalScore)}`,
  };
};

/**
 * Statement-of-purpose drafts reviewed by faculty (§5.3.2):
 * Capped at 3, divided by 3, times 100.
 */
const sopDraftReadiness: ComponentCalc = (f, p, { track }) => {
  const full = Number(p.tracks[track]?.params.sop_reviews_full ?? 3);
  const sopRatings = f.ratings.filter((r) => r.kind === "sop_review" && multiplier(r.status, p) > 0);
  const count =
    f.sopReviewsCount ??
    (sopRatings.length > 0
      ? sopRatings.length
      : f.precomputed?.sop_reviews != null
        ? f.precomputed.sop_reviews
        : f.precomputed?.faculty_recommendation_readiness != null
          ? (f.precomputed.faculty_recommendation_readiness / 100) * full
          : 0);

  if (!count) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No statement-of-purpose drafts reviewed by faculty yet"],
      calculation: `0 SOP drafts reviewed / ${full}`,
    };
  }

  const score = Math.min(1, count / full) * 100;
  return {
    score,
    evidenceRefs: sopRatings.map((r) => r.id),
    dataGaps: [],
    calculation: `min(${count}, ${full}) / ${full} × 100 → ${fmt(score)}`,
  };
};

/**
 * Application timeline adherence (§5.3.2):
 * Share of self-set milestones completed on or before their dates.
 */
const applicationMilestonesAdherence: ComponentCalc = (f) => {
  const pct =
    f.applicationMilestonesCompletedPct ??
    f.precomputed?.application_timeline_adherence ??
    f.precomputed?.milestones_completed_pct;
  if (pct == null) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No application milestones recorded yet"],
      calculation: "no milestone records",
    };
  }
  const score = Math.max(0, Math.min(100, pct));
  return {
    score,
    evidenceRefs: ["record:application_milestones"],
    dataGaps: [],
    calculation: `application milestones completed on time: ${fmt(score)}%`,
  };
};

/**
 * Entrepreneurship customer validation (§5.3.3):
 * Logged customer interviews (capped at 15) / 15 × mentor quality rating.
 */
const customerValidation: ComponentCalc = (f, p, { track }) => {
  const full = Number(p.tracks[track]?.params.customer_interviews_full ?? 15);
  const interviews = f.customerInterviewsCount ?? f.precomputed?.customer_interviews;
  const ratingRec = f.ratings.find((r) => r.kind === "customer_validation" && multiplier(r.status, p) > 0);
  const rating = ratingRec ? ratingRec.rating : (f.precomputed?.customer_validation_rating ?? 4.0);

  if (interviews == null || interviews === 0) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No customer validation interviews logged yet"],
      calculation: "0 customer interviews logged",
    };
  }

  const ratio = Math.min(interviews, full) / full;
  const ratingMult = Math.min(5, Math.max(1, rating)) / 5;
  const score = ratio * ratingMult * 100;

  return {
    score,
    evidenceRefs: ratingRec ? [ratingRec.id] : ["record:customer_interviews"],
    dataGaps: [],
    calculation: `(min(${interviews}, ${full}) / ${full}) × (${fmt(rating)} / 5) × 100 → ${fmt(score)}`,
  };
};

/**
 * Entrepreneurship team & execution (§5.3.3):
 * Share of venture milestones completed on time.
 */
const ventureMilestones: ComponentCalc = (f) => {
  const pct =
    f.ventureMilestonesOnTimePct ?? f.precomputed?.team_and_execution ?? f.precomputed?.milestones_on_time_pct;
  if (pct == null) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No venture milestones recorded yet"],
      calculation: "no milestone records",
    };
  }
  const score = Math.max(0, Math.min(100, pct));
  return {
    score,
    evidenceRefs: ["record:venture_milestones"],
    dataGaps: [],
    calculation: `venture milestones completed on time: ${fmt(score)}%`,
  };
};

/**
 * Public Service current affairs consistency (§5.3.4):
 * Days with a logged session in the last 30 / 30 × accuracy on weekly tests.
 */
const currentAffairsConsistency: ComponentCalc = (f) => {
  const days =
    f.currentAffairsDaysLogged ??
    (f.streakValidDays != null ? Math.min(f.streakValidDays, 30) : (f.precomputed?.current_affairs_days ?? null));
  const accuracy =
    f.currentAffairsWeeklyAccuracy ??
    (f.precomputed?.current_affairs_accuracy != null ? f.precomputed.current_affairs_accuracy / 100 : null);

  if (days == null || days === 0) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No logged current affairs sessions in the last 30 days"],
      calculation: "0 days logged",
    };
  }

  const effectiveAcc = accuracy != null ? Math.max(0, Math.min(1, accuracy)) : 0.75;
  const score = (Math.min(days, 30) / 30) * effectiveAcc * 100;

  return {
    score,
    evidenceRefs: ["platform:current_affairs"],
    dataGaps: [],
    calculation: `(min(${days}, 30) / 30) × ${(effectiveAcc * 100).toFixed(0)}% accuracy × 100 → ${fmt(score)}`,
  };
};

/**
 * Sports, Defense & NCC physical fitness (§5.3.6):
 * Cooper test distance band, stamina score, and BMI shown ONLY as a band.
 * HARD DOMAIN RULE (§5.3.6): BMI is NEVER output as a number to protect students from body-image harm.
 */
const physicalFitness: ComponentCalc = (f) => {
  const cooperScore =
    f.physicalFitnessCooperBandScore ?? f.precomputed?.cooper_score ?? f.precomputed?.physical_fitness ?? null;
  const bmiBand = f.physicalFitnessBmiBand ?? "NORMAL";
  const bmiFactor = bmiBand === "NORMAL" ? 1.0 : bmiBand === "WATCH" ? 0.85 : 0.7;

  if (cooperScore == null) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No physical fitness or Cooper test records on file"],
      calculation: "no fitness test on record",
    };
  }

  const score = Math.max(0, Math.min(100, cooperScore * bmiFactor));
  return {
    score,
    evidenceRefs: ["record:physical_fitness"],
    dataGaps: [],
    calculation: `Cooper test score ${fmt(cooperScore)} × BMI band factor (${bmiBand}) → ${fmt(score)}`,
  };
};

/**
 * Sports, Defense & NCC camp & training attendance (§5.3.6):
 * Days attended / days required, capped at 1, times 100.
 */
const campTrainingAttendance: ComponentCalc = (f) => {
  const attended = f.campDaysAttended ?? f.precomputed?.camp_days_attended ?? f.precomputed?.camp_training_attendance;
  const required = f.campDaysRequired ?? f.precomputed?.camp_days_required ?? 14;

  if (attended == null || attended === 0) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No camp or training attendance recorded yet"],
      calculation: `0 days attended / ${required}`,
    };
  }

  const score = Math.min(1, attended / required) * 100;
  return {
    score,
    evidenceRefs: ["record:camp_attendance"],
    dataGaps: [],
    calculation: `min(1, ${attended} / ${required}) × 100 → ${fmt(score)}`,
  };
};

/**
 * Sports, Defense & NCC competition results (§5.3.6):
 * Points by level (university 1, state 2, national 3), capped at 100.
 */
const competitionResults: ComponentCalc = (f) => {
  const points = f.competitionPoints ?? f.precomputed?.competition_results ?? f.precomputed?.competition_points ?? null;

  if (points == null || points === 0) {
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No sports/defense competition results on record"],
      calculation: "0 competition points",
    };
  }

  const score = Math.min(100, points * 25);
  return {
    score,
    evidenceRefs: ["record:competition_results"],
    dataGaps: [],
    calculation: `competition score from level points: ${fmt(score)}`,
  };
};

// ── Track Specifications (§5.3) ───────────────────────────────────────────

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
    entrance_exam_readiness: entranceExamReadiness,
    research_output: evidenceOf,
    faculty_recommendation_readiness: sopDraftReadiness,
    application_timeline_adherence: applicationMilestonesAdherence,
  },
  entrepreneurship: {
    venture_traction: evidenceOf,
    build_evidence: evidenceOf,
    customer_validation: customerValidation,
    team_and_execution: ventureMilestones,
    academic_continuity: academic,
  },
  public_service: {
    current_affairs_consistency: currentAffairsConsistency,
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
    physical_fitness: physicalFitness,
    camp_training_attendance: campTrainingAttendance,
    competition_results: competitionResults,
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
    case "minimum_credits_held": {
      const minRequired = facts.minimumCreditsRequired ?? 20;
      if (facts.creditsHeld != null) {
        return facts.creditsHeld >= minRequired ? null : "Minimum credits not held";
      }
      if (facts.precomputed?.minimum_credits_held != null) {
        return facts.precomputed.minimum_credits_held > 0 ? null : "Minimum credits not held";
      }
      return null;
    }
    default:
      return `Unknown gate ${gate}`;
  }
}
