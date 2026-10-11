/**
 * Mentor brief (§12.2): a one-page summary of three facts, the data gaps, two suggested questions and
 * the pivot options, each fact tied to the field it came from. Everything is derived from the rules
 * output by fixed rules, so the same evaluation always produces the same brief; no model is involved.
 * Pure: no I/O.
 */
import type { Policy } from "../policy/schema";
import type { Evaluation } from "../rules/types";

export interface BriefSource {
  /** Where the fact lives in the evaluation, e.g. "trackScore.components.aptitude". */
  field: string;
  /** Human label for the link. */
  label: string;
  /** In-page anchor on the student record. */
  anchor: string;
}

export interface BriefFact {
  text: string;
  source: BriefSource;
}

export interface BriefPivotOption {
  key: "continue" | "extend" | "pivot";
  label: string;
  detail: string;
}

export interface Brief {
  facts: [BriefFact, BriefFact, BriefFact];
  dataGaps: { text: string; source: BriefSource }[];
  questions: [string, string];
  pivot: { options: BriefPivotOption[]; recommended: boolean };
}

const one = (x: number) => (Math.round(x * 10) / 10).toString();

const PERSONA_QUESTION: Record<string, string> = {
  detention_threat_builder:
    "What is making it hard to be in class right now, and what would you like to protect of what you have built?",
  attendance_critical: "What is making it hard to be in class right now?",
  aspiration_mismatch:
    "What does the timeline look like if the target date stays where it is, and what would change it?",
  false_positive_high_flyer: "Your academic record is strong; which project could you present to show it in practice?",
  drifting_student: "Which areas have you enjoyed or would you like to explore?",
};

export function buildBrief(ev: Evaluation, policy: Pick<Policy, "tracks">): Brief {
  const t = ev.trackScore;
  const trackName = policy.tracks[t.track]?.name ?? t.track;
  const byShortfall = [...t.components].sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score));
  const worst = byShortfall[0];
  const best = [...t.components].sort((a, b) => b.score - a.score)[0];
  const persona = ev.personas.find((p) => p.persona === ev.primaryPersona);
  const attendance = ev.trend.signals.attendance;

  const f1: BriefFact = {
    text: ev.scoreShown
      ? `${trackName} score ${one(t.score)} against a readiness of ${ev.readiness}; the gap is ${ev.gapIndex.toLowerCase()}.`
      : `Not enough evidence yet to show a ${trackName} score; the gap index is ${ev.gapIndex.toLowerCase()}.`,
    source: { field: "trackScore.score", label: "Score and gap", anchor: "score" },
  };
  const f2: BriefFact = {
    text: `${worst.label} is the largest shortfall: it scores ${one(worst.score)} and carries weight ${worst.weight}.`,
    source: { field: `trackScore.components.${worst.key}`, label: worst.label, anchor: `component-${worst.key}` },
  };
  const f3: BriefFact = persona
    ? {
        text: persona.reasons[0],
        source: { field: `personas.${persona.persona}`, label: "What triggered the route", anchor: "personas" },
      }
    : attendance.label === "WORSENING"
      ? {
          text: `Attendance is slipping by ${one(Math.abs(attendance.slope ?? 0))} points a week over the last four weeks.`,
          source: { field: "trend.signals.attendance", label: "Attendance trend", anchor: "trend" },
        }
      : {
          text: `${best.label} is the strongest area at ${one(best.score)}.`,
          source: { field: `trackScore.components.${best.key}`, label: best.label, anchor: `component-${best.key}` },
        };

  const dataGaps = t.components.flatMap((c) =>
    c.dataGaps.map((text) => ({
      text,
      source: { field: `trackScore.components.${c.key}`, label: c.label, anchor: `component-${c.key}` },
    })),
  );

  // Two questions: one from the persona or route that fired (if any), one from the biggest gap.
  const fromRoute = ev.primaryPersona
    ? PERSONA_QUESTION[ev.primaryPersona]
    : ev.attendanceCriticalFlag
      ? PERSONA_QUESTION.attendance_critical
      : null;
  const fromGap = `Which part of ${worst.label.toLowerCase()} would you like to start with, and what would make the next two weeks workable?`;
  const generic = "What would you like to get out of the next few weeks, and what is in the way?";
  const questions: [string, string] = fromRoute ? [fromRoute, fromGap] : [fromGap, generic];

  const options: BriefPivotOption[] = [
    {
      key: "continue",
      label: `Continue on ${trackName}`,
      detail: `The next step is the largest shortfall: ${worst.label.toLowerCase()}.`,
    },
  ];
  if (ev.gapIndex !== "LOW")
    options.push({
      key: "extend",
      label: "Extend the target date",
      detail: "The student records the decision; nothing changes until they do.",
    });
  if (ev.pivot.recommended)
    options.push({
      key: "pivot",
      label: ev.pivot.recommendedTrack
        ? `Look at ${policy.tracks[ev.pivot.recommendedTrack]?.name ?? ev.pivot.recommendedTrack}`
        : "Talk through the timeline",
      detail:
        `${ev.pivot.reasons.map((r) => (/[.!?]$/.test(r) ? r : `${r}.`)).join(" ")} The student chooses; no track changes automatically.`.trim(),
    });

  return { facts: [f1, f2, f3], dataGaps, questions, pivot: { options, recommended: ev.pivot.recommended } };
}
