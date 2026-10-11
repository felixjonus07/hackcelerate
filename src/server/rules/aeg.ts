/**
 * Aspiration-Execution Gap engine (§7): gap index, personas, precedence,
 * trend and pivot advisory. Pure functions over facts + policy.
 */
import type { AegLevel, PersonaId, Policy, TrackId } from "../policy/schema";
import { AEG_LEVELS, TRACK_IDS } from "../policy/schema";
import { leastSquaresSlope } from "./normalize";
import { scoreTrack } from "./score";
import type { PersonaMatch, StudentFacts, TrendLabel, WeeklySignal } from "./types";

export const levelRank = (l: AegLevel) => AEG_LEVELS.indexOf(l);
export const maxLevel = (a: AegLevel, b: AegLevel) => (levelRank(a) >= levelRank(b) ? a : b);

/** gap ratio = max(0, (A − S) / A) (§7.2). */
export function gapRatio(readiness: number, score: number): number {
  if (readiness <= 0) return 0;
  return Math.max(0, (readiness - score) / readiness);
}

export function gapIndex(ratio: number, policy: Policy): AegLevel {
  if (ratio >= policy.aeg_bands.critical_from) return "CRITICAL";
  if (ratio >= policy.aeg_bands.moderate_from) return "MODERATE";
  return "LOW";
}

/** Persona triggers (§7.3). Returns every match; precedence is applied later. */
export function matchPersonas(
  facts: StudentFacts,
  policy: Policy,
): {
  matches: PersonaMatch[];
  attendanceCriticalFlag: boolean;
  watchBand: boolean;
} {
  const p = policy.personas;
  const matches: PersonaMatch[] = [];
  const att = facts.attendancePct;

  // Detention Threat Builder
  let attendanceCriticalFlag = false;
  if (att != null && att < p.detention_threat_builder.attendance_below_pct) {
    const artifact = facts.artifactScore;
    const p75 = facts.cohortArtifactP75;
    if (artifact != null && p75 != null && artifact >= p75) {
      matches.push({
        persona: "detention_threat_builder",
        floor: p.detention_threat_builder.floor,
        reasons: [
          `Attendance ${att}% is below the condonation floor of ${p.detention_threat_builder.attendance_below_pct}%`,
          `Verified artifact score ${artifact} is at or above the cohort 75th percentile (${p75})`,
        ],
      });
    } else {
      attendanceCriticalFlag = true;
    }
  }

  // Aspiration Mismatch
  const am = p.aspiration_mismatch;
  const months = facts.monthsToDeadline;
  if (
    facts.aspiration.targetType === "abroad" &&
    (facts.activeBacklogs ?? 0) >= am.abroad.backlogs_min &&
    months != null &&
    months <= am.abroad.deadline_within_months
  ) {
    matches.push({
      persona: "aspiration_mismatch",
      floor: am.floor,
      reasons: [
        `Target is admission abroad with ${facts.activeBacklogs} active backlogs`,
        `Application deadline within ${months} months`,
      ],
    });
  } else if (
    facts.aspiration.targetType === "public_service" &&
    (facts.mocksLast60d ?? 0) <= am.public_service.mocks_last_60d_max &&
    months != null &&
    months <= am.public_service.exam_within_months
  ) {
    matches.push({
      persona: "aspiration_mismatch",
      floor: am.floor,
      reasons: [`No mock attempts in the last 60 days`, `Exam within ${months} months`],
    });
  }

  // False-Positive High Flyer
  const hf = p.false_positive_high_flyer;
  const apt = facts.campusAptitudePercentile;
  if (
    facts.cgpa != null &&
    facts.cgpa >= hf.cgpa_min &&
    (facts.verifiedProjects ?? 0) <= hf.verified_projects_min &&
    apt != null &&
    apt < hf.aptitude_below_pct
  ) {
    matches.push({
      persona: "false_positive_high_flyer",
      floor: hf.floor,
      reasons: [
        `CGPA ${facts.cgpa} is at or above ${hf.cgpa_min}`,
        `No verified practical projects`,
        `Placement aptitude ${apt}% is below ${hf.aptitude_below_pct}%`,
      ],
    });
  }

  // Drifting Student (never shown to the student by this name)
  const ds = p.drifting_student;
  if (
    facts.year >= ds.min_year &&
    facts.aspiration.track == null &&
    facts.cgpa != null &&
    facts.cgpa <= ds.cgpa_avg_max &&
    (facts.activityLast60d ?? 0) <= ds.activity_last_60d_max
  ) {
    matches.push({
      persona: "drifting_student",
      floor: ds.floor,
      reasons: [
        `Year ${facts.year} with no declared track`,
        `Average CGPA ${facts.cgpa}`,
        `No platform activity in the last 60 days`,
      ],
    });
  }

  const [lo, hi] = policy.attendance.watch_band_pct;
  const watchBand = att != null && att >= lo && att <= hi;
  return { matches, attendanceCriticalFlag, watchBand };
}

/** Precedence (§7.4): the highest-priority persona acts; the rest queue. */
export function primaryPersona(matches: PersonaMatch[], policy: Policy): PersonaId | null {
  for (const id of policy.persona_precedence) if (matches.some((m) => m.persona === id)) return id;
  return null;
}

function signalTrend(
  points: WeeklySignal[] | undefined,
  rule: { worsening_slope_max: number; improving_slope_min: number },
  policy: Policy,
): { slope: number | null; label: TrendLabel } {
  if (!points?.length) return { slope: null, label: "INSUFFICIENT_DATA" };
  const lastWeek = Math.max(...points.map((p) => p.week));
  const window = points.filter((p) => p.week > lastWeek - policy.trend.window_weeks);
  if (window.length < policy.trend.min_observations) return { slope: null, label: "INSUFFICIENT_DATA" };
  const slope = leastSquaresSlope(window);
  if (slope <= rule.worsening_slope_max) return { slope, label: "WORSENING" };
  if (slope >= rule.improving_slope_min) return { slope, label: "IMPROVING" };
  return { slope, label: "STABLE" };
}

/** Trend engine (§7.5). */
export function trend(facts: StudentFacts, policy: Policy) {
  const signals = {
    attendance: signalTrend(facts.attendanceWeekly, policy.trend.attendance, policy),
    mock_percentile: signalTrend(facts.mockPercentileWeekly, policy.trend.mock_percentile, policy),
  };
  const labels = Object.values(signals).map((s) => s.label);
  let overall: TrendLabel;
  if (labels.every((l) => l === "INSUFFICIENT_DATA")) overall = "INSUFFICIENT_DATA";
  else if (labels.includes("WORSENING")) overall = "WORSENING";
  else if (labels.includes("IMPROVING")) overall = "IMPROVING";
  else overall = "STABLE";
  const gaps = facts.streakGapDays14;
  const streakNote =
    gaps != null && gaps >= policy.trend.streak_gap_note_days
      ? `${gaps} gap days in the last ${policy.trend.streak_window_days}`
      : null;
  return { overall, signals, streakNote };
}

/** Pivot advisory (§7.6). Never changes a track; the student chooses. */
export function pivotAdvisory(
  facts: StudentFacts,
  currentTrack: TrackId,
  currentScore: number,
  currentGap: AegLevel,
  personas: PersonaMatch[],
  policy: Policy,
  eligibleTracks: TrackId[] = [...TRACK_IDS],
) {
  const reasons: string[] = [];
  if (personas.some((m) => m.persona === "aspiration_mismatch"))
    reasons.push("The current plan leaves a large gap to the target date");
  let best: { track: TrackId; score: number } | null = null;
  if (levelRank(currentGap) >= levelRank(policy.pivot.min_gap_index)) {
    for (const t of eligibleTracks) {
      if (t === currentTrack) continue;
      const s = scoreTrack(t, facts, policy);
      if (s.gateFailed) continue;
      if (s.score >= currentScore + policy.pivot.score_advantage_min && (!best || s.score > best.score))
        best = { track: t, score: s.score };
    }
    if (best)
      reasons.push(
        `${policy.tracks[best.track]?.name} scores ${best.score.toFixed(1)}, at least ${policy.pivot.score_advantage_min} points above the current track`,
      );
  }
  return {
    recommended: reasons.length > 0,
    recommendedTrack: best?.track ?? null,
    reasons,
  };
}
