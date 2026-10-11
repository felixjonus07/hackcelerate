/**
 * Track rubrics (§5.3). Weights come from the policy file; this module only
 * defines *how* each component turns facts into a 0–100 score.
 *
 * Corporate Placement and Public Service are fully specified in the reference
 * plan. The other tracks are marked "assumed" in §5.1 and are implemented with
 * the same component kinds; their required-item lists are a Phase 2 task.
 */
import { type Policy, type TrackId, trackParams, type VerificationStatus } from "../../policy/schema";
import { addDays } from "../calendar";
import { streakValidDays } from "../integrity";
import {
  attendanceScore,
  average,
  cgpaScore,
  clamp,
  evidenceScore,
  multiplier,
  percentileScore,
  ratingScore,
  speedScore,
  streakScore,
} from "../normalize";
import type { ComponentResult, FacultyRating, MockAttempt, StudentFacts } from "../types";

type ComponentCalc = (
  facts: StudentFacts,
  policy: Policy,
  ctx: { track: TrackId; key: string },
) => Omit<ComponentResult, "key" | "weight" | "contribution" | "label">;

/** Rubrics that depend on dates read `facts.asOf`; they never read the clock (§10.1). */
function asOfOf(facts: StudentFacts): string {
  if (!facts.asOf) throw new Error("facts.asOf is required for this rubric (the rules engine never reads the clock)");
  return facts.asOf;
}

const counted = (status: VerificationStatus, p: Policy) => multiplier(status, p) > 0;
const lowestMultiplier = (statuses: VerificationStatus[], p: Policy) =>
  statuses.length ? Math.min(...statuses.map((s) => multiplier(s, p))) : 0;

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
  if (f.cgpa == null)
    gaps.push(f.dataQuality?.cgpa ? `CGPA excluded: ${f.dataQuality.cgpa}` : "CGPA missing from ERP import");
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
  const missing = required.filter((r) => {
    const s = found.get(r.key);
    return !s || multiplier(s, p) === 0;
  });
  const gaps = missing.map((r) => `${dept.items[r.key].label}: no counted evidence yet`);
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
    missingItems: missing.map((r) => r.key),
    calculation: `(${terms}) / ${total} × 100`,
  };
};

function latestRatings(f: StudentFacts, kind: FacultyRating["kind"], n: number, p: Policy) {
  return f.ratings
    .filter((r) => r.kind === kind && counted(r.status, p))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

/** Average of the latest faculty ratings of one kind, on the five-point scale (§5.2 rating score). */
const ratingsOf =
  (kind: FacultyRating["kind"], window: (p: Policy, track: TrackId) => number, gapLabel: string): ComponentCalc =>
  (f, p, { track }) => {
    const rs = latestRatings(f, kind, window(p, track), p);
    if (!rs.length) return { score: 0, evidenceRefs: [], dataGaps: [gapLabel], calculation: "no ratings" };
    const avg = average(rs.map((r) => r.rating));
    return {
      score: ratingScore(avg),
      evidenceRefs: rs.map((r) => r.id),
      dataGaps: [],
      calculation: `(${fmt(avg)} − 1) / 4 × 100`,
    };
  };

/** Verified internship hours / full hours, capped at 1, × 100. */
const internship: ComponentCalc = (f, p) => {
  const full = trackParams(p, "corporate_placement").internship_hours_full;
  if (f.verifiedInternshipHours == null)
    return { score: 0, evidenceRefs: [], dataGaps: ["No internship record"], calculation: "no record" };
  return {
    score: Math.min(1, f.verifiedInternshipHours / full) * 100,
    evidenceRefs: ["placement:internship_hours"],
    dataGaps: [],
    calculation: `${f.verifiedInternshipHours} verified hours / ${full}`,
  };
};

/** Required evidence weight for a component, from the track's `required_weights` (policy, never code). */
function requiredWeight(p: Policy, track: TrackId, key: string): number {
  const weights = (p.tracks[track]?.params as { required_weights?: Record<string, number> }).required_weights;
  const w = weights?.[key];
  if (w == null) throw new Error(`Policy ${p.policy_version} has no required_weights.${key} for ${track}`);
  return w;
}

/**
 * Evidence score (§5.2): Σ(weight × multiplier) / required weight × 100, capped at 100. Items with no
 * counted status add nothing and are listed as gaps. A deployment's recorded uptime scales its share.
 */
const evidenceOf: ComponentCalc = (f, p, { track, key }) => {
  const items = f.evidence.filter((e) => e.component === key);
  const required = requiredWeight(p, track, key);
  if (!items.length)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: [`${componentLabel(key)}: no evidence yet`],
      calculation: `no evidence; ${required} weight needed`,
    };
  const earned = items.reduce((sum, e) => {
    const uptime = typeof e.details?.uptimePct === "number" ? clamp(e.details.uptimePct / 100, 0, 1) : 1;
    return sum + (e.weight ?? 1) * multiplier(e.status, p) * uptime;
  }, 0);
  return {
    score: Math.min(100, (earned / required) * 100),
    evidenceRefs: items.map((e) => e.id),
    dataGaps: items.filter((e) => !counted(e.status, p)).map((e) => `${e.label}: not counted (${e.status})`),
    calculation: `Σ(weight × multiplier) = ${fmt(earned)} / ${required} required, capped at 100`,
  };
};

/** Counted attempts of one test type, newest first. */
const attemptsOf = (f: StudentFacts, testType: string, n: number, p: Policy): MockAttempt[] =>
  f.mocks
    .filter((m) => m.testType === testType && counted(m.status, p))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);

/** Average percentile of the latest attempts, scored at the lowest verification multiplier used (§5.3.2). */
const mockPercentile =
  (testType: (p: Policy) => string, window: (p: Policy) => number): ComponentCalc =>
  (f, p) => {
    const type = testType(p);
    const ms = attemptsOf(f, type, window(p), p);
    if (!ms.length) return { score: 0, evidenceRefs: [], dataGaps: [`No ${type} mocks yet`], calculation: "no mocks" };
    const avg = average(ms.map((m) => m.percentile));
    const lowest = lowestMultiplier(
      ms.map((m) => m.status),
      p,
    );
    return {
      score: percentileScore(avg) * lowest,
      evidenceRefs: ms.map((m) => m.id),
      dataGaps: [],
      calculation: `average percentile of latest ${ms.length}: ${fmt(avg)}${lowest < 1 ? ` × ${lowest} (lowest multiplier used)` : ""}`,
    };
  };

/** Speed score of a set of timed attempts: mean per difficulty band, then mean of the bands (§5.3.4). */
function speedByBand(ms: MockAttempt[]): { score: number; bands: number } | null {
  const timed = ms.filter((m) => m.targetSecondsPerItem && m.avgSecondsPerItem > 0);
  if (!timed.length) return null;
  const bands = new Map<string, number[]>();
  for (const m of timed)
    bands.set(m.difficulty ?? "all", [
      ...(bands.get(m.difficulty ?? "all") ?? []),
      speedScore(m.targetSecondsPerItem ?? 0, m.avgSecondsPerItem),
    ]);
  return { score: average([...bands.values()].map(average)), bands: bands.size };
}

/** Entrance readiness (§5.3.2): average practice percentile for the target exam, speed as a sub-measure. */
const entranceReadiness: ComponentCalc = (f, p) => {
  const prm = trackParams(p, "higher_studies");
  const ms = attemptsOf(f, prm.entrance_test_type, prm.entrance_window, p);
  if (!ms.length)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No practice tests for the target exam yet"],
      calculation: "no practice tests",
    };
  const percentile = percentileScore(average(ms.map((m) => m.percentile)));
  const speed = speedByBand(ms);
  const share = speed ? prm.entrance_speed_share : 0;
  const lowest = lowestMultiplier(
    ms.map((m) => m.status),
    p,
  );
  const sources = [...new Set(ms.map((m) => m.source ?? "unlabelled"))];
  return {
    score: ((1 - share) * percentile + share * (speed?.score ?? 0)) * lowest,
    evidenceRefs: ms.map((m) => m.id),
    dataGaps: [],
    subMeasures: speed ? [{ label: "Speed score", value: fmt(speed.score) }] : [],
    calculation: `average percentile of latest ${ms.length}: ${fmt(percentile)}${share ? `, speed share ${share}` : ""}${lowest < 1 ? `; × ${lowest}, the lowest multiplier among sources (${sources.join(", ")})` : ""}`,
  };
};

/** Faculty-reviewed statement-of-purpose drafts, capped, divided by the full count (§5.3.2). */
const sopReviews: ComponentCalc = (f, p, { key }) => {
  const full = trackParams(p, "higher_studies").sop_reviews_full;
  const reviews = f.evidence.filter((e) => e.component === key && (e.status === "ATTESTED" || e.status === "VERIFIED"));
  if (!reviews.length)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No faculty-reviewed statement-of-purpose draft yet"],
      calculation: "no reviews",
    };
  return {
    score: (Math.min(reviews.length, full) / full) * 100,
    evidenceRefs: reviews.map((e) => e.id),
    dataGaps: [],
    calculation: `min(${reviews.length}, ${full}) / ${full} × 100`,
  };
};

/** Share of self-set milestones completed on or before their date (§5.3.2, §5.3.3). */
const milestoneAdherence =
  (scope: "application" | "venture"): ComponentCalc =>
  (f) => {
    const asOf = asOfOf(f);
    const all = (f.milestones ?? []).filter((m) => m.scope === scope);
    // A milestone counts once it is due or done; one that is not yet due is neither late nor on time.
    const relevant = all.filter((m) => m.dueOn <= asOf || m.completedOn != null);
    if (!relevant.length)
      return { score: 0, evidenceRefs: [], dataGaps: ["No milestones set or due yet"], calculation: "no milestones" };
    const onTime = relevant.filter((m) => m.completedOn != null && m.completedOn <= m.dueOn);
    return {
      score: (onTime.length / relevant.length) * 100,
      evidenceRefs: relevant.map((m) => m.id),
      dataGaps: [],
      calculation: `${onTime.length} of ${relevant.length} milestones on time`,
    };
  };

/** Logged customer interviews (capped, ÷ full) times the mentor's quality rating (§5.3.3). */
const customerValidation: ComponentCalc = (f, p, { key }) => {
  const prm = trackParams(p, "entrepreneurship");
  const logs = f.evidence.filter(
    (e) => e.component === key && e.kind === "interview_log" && (e.status === "ATTESTED" || e.status === "VERIFIED"),
  );
  const ratings = latestRatings(f, "customer_validation", prm.customer_rating_window, p);
  const gaps: string[] = [];
  if (!logs.length) gaps.push("No reviewed customer interview log yet");
  if (!ratings.length) gaps.push("Mentor quality rating pending");
  if (gaps.length) return { score: 0, evidenceRefs: [], dataGaps: gaps, calculation: "interviews or rating missing" };
  const quality = ratingScore(average(ratings.map((r) => r.rating))) / 100;
  return {
    score: (Math.min(logs.length, prm.customer_interviews_full) / prm.customer_interviews_full) * quality * 100,
    evidenceRefs: [...logs.map((e) => e.id), ...ratings.map((r) => r.id)],
    dataGaps: [],
    calculation: `min(${logs.length}, ${prm.customer_interviews_full}) / ${prm.customer_interviews_full} × quality ${fmt(quality)}`,
  };
};

/** Days with a current-affairs session × accuracy on weekly tests, over the window (§5.3.4). */
const currentAffairs: ComponentCalc = (f, p) => {
  const prm = trackParams(p, "public_service");
  const asOf = asOfOf(f);
  const from = addDays(asOf, -(prm.current_affairs_window_days - 1));
  const days = new Set((f.currentAffairsDates ?? []).filter((d) => d >= from && d <= asOf));
  const tests = f.mocks.filter(
    (m) =>
      m.testType === prm.weekly_test_type &&
      counted(m.status, p) &&
      m.score != null &&
      m.maxScore &&
      m.date >= from &&
      m.date <= asOf,
  );
  if (!tests.length)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No weekly test results in the last 30 days"],
      calculation: `${days.size} session days; accuracy unknown`,
    };
  const accuracy = average(tests.map((m) => clamp((m.score ?? 0) / (m.maxScore ?? 1), 0, 1)));
  return {
    score: (days.size / prm.current_affairs_window_days) * accuracy * 100,
    evidenceRefs: tests.map((m) => m.id),
    dataGaps: [],
    calculation: `${days.size} / ${prm.current_affairs_window_days} days × accuracy ${fmt(accuracy)}`,
  };
};

const quantSpeed: ComponentCalc = (f, p) => {
  const type = trackParams(p, "public_service").quant_test_type;
  const ms = f.mocks.filter((m) => m.testType === type && counted(m.status, p));
  const r = speedByBand(ms);
  if (!r) return { score: 0, evidenceRefs: [], dataGaps: [`No timed ${type} sets yet`], calculation: "no timed sets" };
  const lowest = lowestMultiplier(
    ms.map((m) => m.status),
    p,
  );
  return {
    score: r.score * lowest,
    evidenceRefs: ms.map((m) => m.id),
    dataGaps: [],
    calculation: `mean of ${r.bands} difficulty band(s) of speed scores`,
  };
};

/** Streak score over the policy window; one credit per day with a complete mock (§5.2, §6.3). */
const mockStreak: ComponentCalc = (f, p) => {
  const days = streakValidDays(f.mocks, asOfOf(f), p);
  if (f.mocks.length === 0)
    return { score: 0, evidenceRefs: [], dataGaps: ["No mock attempts yet"], calculation: "no mocks" };
  return {
    score: streakScore(days, p.streak.target_days),
    evidenceRefs: ["platform:streak"],
    dataGaps: [],
    calculation: `min(${days}, ${p.streak.target_days}) / ${p.streak.target_days} × 100`,
  };
};

/**
 * Physical fitness (§5.3.6): the mean of the Cooper band score, the stamina score and the BMI band
 * score, from a record the sports or NCC officer signed. BMI is held only as a band, never as a number.
 */
const physicalFitness: ComponentCalc = (f, p, { key }) => {
  const prm = trackParams(p, "sports_defense_ncc");
  const records = f.evidence.filter((e) => e.component === key && e.kind === "fitness_record" && counted(e.status, p));
  if (!records.length)
    return {
      score: 0,
      evidenceRefs: [],
      dataGaps: ["No fitness record signed by the sports or NCC officer yet"],
      calculation: "no signed record",
    };
  const scored = records.map((rec) => {
    const parts: number[] = [];
    const notes: string[] = [];
    const d = rec.details ?? {};
    if (typeof d.cooperMetres === "number") {
      const metres = d.cooperMetres;
      const band = [...prm.cooper_bands]
        .sort((a, b) => b.min_metres - a.min_metres)
        .find((b) => metres >= b.min_metres);
      parts.push(band?.score ?? 0);
      notes.push("Cooper distance band");
    }
    if (typeof d.staminaScore === "number") {
      parts.push(clamp(d.staminaScore, 0, 100));
      notes.push("stamina score");
    }
    if (d.bmiBand === "in_range" || d.bmiBand === "borderline" || d.bmiBand === "out_of_range") {
      parts.push(prm.bmi_band_scores[d.bmiBand]);
      notes.push(`BMI band: ${String(d.bmiBand).replace("_", " ")}`);
    }
    return { rec, notes, score: parts.length ? average(parts) * multiplier(rec.status, p) : 0 };
  });
  // The strongest signed record counts, so adding a record can never lower the component.
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  if (best.notes.length === 0)
    return {
      score: 0,
      evidenceRefs: [best.rec.id],
      dataGaps: ["The fitness record has no measures"],
      calculation: "empty record",
    };
  return {
    score: best.score,
    evidenceRefs: [best.rec.id],
    dataGaps: [],
    calculation: `mean of ${best.notes.join(", ")}`,
  };
};

/** Camp days attended / days required, capped at 1 (§5.3.6). */
const campAttendance: ComponentCalc = (f, p, { key }) => {
  const recs = f.evidence.filter((e) => e.component === key && e.kind === "camp_record" && counted(e.status, p));
  const attended = recs.reduce((n, e) => n + (Number(e.details?.daysAttended) || 0), 0);
  const required = recs.reduce((n, e) => n + (Number(e.details?.daysRequired) || 0), 0);
  if (!recs.length || required <= 0)
    return { score: 0, evidenceRefs: [], dataGaps: ["No camp attendance record yet"], calculation: "no records" };
  return {
    score:
      Math.min(1, attended / required) *
      lowestMultiplier(
        recs.map((e) => e.status),
        p,
      ) *
      100,
    evidenceRefs: recs.map((e) => e.id),
    dataGaps: [],
    calculation: `${attended} of ${required} camp days, capped at 1`,
  };
};

/** Points by level, over the required points, capped at 100 (§5.3.6). */
const competitionResults: ComponentCalc = (f, p, { key }) => {
  const prm = trackParams(p, "sports_defense_ncc");
  const medals = f.evidence.filter((e) => e.component === key && e.kind === "medal");
  const earned = medals.reduce((sum, e) => {
    const level = String(e.details?.level) as keyof typeof prm.competition_points;
    return sum + (prm.competition_points[level] ?? 0) * multiplier(e.status, p);
  }, 0);
  if (!medals.length)
    return { score: 0, evidenceRefs: [], dataGaps: ["No competition result attested yet"], calculation: "no results" };
  return {
    score: Math.min(100, (earned / prm.competition_required_points) * 100),
    evidenceRefs: medals.map((e) => e.id),
    dataGaps: medals.filter((e) => !counted(e.status, p)).map((e) => `${e.label}: not counted (${e.status})`),
    calculation: `${fmt(earned)} points / ${prm.competition_required_points} required, capped at 100`,
  };
};

// ── Track specs ─────────────────────────────────────────────────────────────

export const RUBRICS: Record<TrackId, Record<string, ComponentCalc>> = {
  corporate_placement: {
    academic_baseline: academic,
    aptitude,
    domain_practical_evidence: departmentStandards,
    mock_interview_readiness: ratingsOf(
      "mock_interview",
      (p) => trackParams(p, "corporate_placement").mock_interview_window,
      "No faculty mock interviews yet",
    ),
    verified_experience: internship,
  },
  higher_studies: {
    academic_baseline: academic,
    entrance_exam_readiness: entranceReadiness,
    research_output: evidenceOf,
    faculty_recommendation_readiness: sopReviews,
    application_timeline_adherence: milestoneAdherence("application"),
  },
  entrepreneurship: {
    venture_traction: evidenceOf,
    build_evidence: evidenceOf,
    customer_validation: customerValidation,
    team_and_execution: milestoneAdherence("venture"),
    academic_continuity: academic,
  },
  public_service: {
    current_affairs_consistency: currentAffairs,
    general_studies_mock: mockPercentile(
      (p) => trackParams(p, "public_service").gs_test_type,
      (p) => trackParams(p, "public_service").gs_mock_window,
    ),
    quantitative_speed: quantSpeed,
    mock_streak: mockStreak,
    answer_writing: ratingsOf(
      "answer_writing",
      (p) => trackParams(p, "public_service").answer_writing_window,
      "No answer-writing ratings yet",
    ),
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
    camp_training_attendance: campAttendance,
    competition_results: competitionResults,
    psychometric_readiness: ratingsOf(
      "psychometric",
      (p) => trackParams(p, "sports_defense_ncc").psychometric_window,
      "No psychometric ratings yet",
    ),
  },
};

/** Gates (§5.3): conditions that must hold before a track score is shown. Gates add no points. */
export function checkGate(track: TrackId, facts: StudentFacts, policy: Policy): string | null {
  const gate = policy.tracks[track]?.gate;
  switch (gate) {
    case null:
    case undefined:
      return null;
    case "at_least_one_department_standard_item": {
      const counted_ = facts.evidence.some((e) => e.standardItem && multiplier(e.status, policy) > 0);
      return counted_ ? null : "Not enough evidence yet";
    }
    case "cgpa_above_eligibility_floor":
      return facts.cgpa != null && facts.cgpa > policy.academic.eligibility_cgpa_above
        ? null
        : "Not enough evidence yet";
    case "attendance_at_or_above_requirement":
      return facts.attendancePct != null && facts.attendancePct >= policy.attendance.requirement_pct
        ? null
        : "Not enough evidence yet";
    case "minimum_credits_held":
      return facts.creditsHeld != null && facts.creditsHeld >= trackParams(policy, "sports_defense_ncc").min_credits
        ? null
        : "Not enough evidence yet";
    default:
      return `Unknown gate ${gate}`;
  }
}

/** Why a gate is not met, in staff terms; the student sees only "Not enough evidence yet" (§5.3). */
export function gateReason(track: TrackId, facts: StudentFacts, policy: Policy): string | null {
  if (checkGate(track, facts, policy) === null) return null;
  const gate = policy.tracks[track]?.gate;
  switch (gate) {
    case "at_least_one_department_standard_item":
      return "No department standard item has counted evidence";
    case "cgpa_above_eligibility_floor":
      return `CGPA is not above the eligibility floor of ${policy.academic.eligibility_cgpa_above}`;
    case "attendance_at_or_above_requirement":
      return `Attendance is below the requirement of ${policy.attendance.requirement_pct}%`;
    case "minimum_credits_held":
      return "Minimum credits for sports quota eligibility are not on record";
    default:
      return `Unknown gate ${gate}`;
  }
}
