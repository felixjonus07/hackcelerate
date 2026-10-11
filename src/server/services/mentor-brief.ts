/**
 * Mentor brief builder (§8.2).
 * Produces three verifiable facts, identified data gaps, two suggested
 * questions, and pivot advisory — each fact linked to its source field.
 * Numbers come from the evaluation result and facts; model writes no numbers here.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { artifacts, aspirations, evaluations } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import type { AegLevel } from "../rules/types";
import { loadStudentFacts } from "./facts";

export interface MentorFact {
  label: string;
  value: string;
  sourceField: string;
  /** ev:ID reference format for audit trail */
  evRef: string;
}

export interface MentorBrief {
  studentPseudonymousId: string;
  aegIndex: AegLevel;
  trackName: string;
  trackScore: number;
  readiness: number;
  facts: MentorFact[];
  dataGaps: string[];
  suggestedQuestions: string[];
  pivotAdvice: string | null;
  evaluationId: string;
  fallback: boolean;
}

/** Build a mentor brief for a student from their latest evaluation. */
export async function buildMentorBrief(studentId: string): Promise<MentorBrief | null> {
  const policy = getActivePolicy();

  // Load latest evaluation
  const [ev] = await db
    .select()
    .from(evaluations)
    .where(eq(evaluations.studentId, studentId))
    .orderBy(desc(evaluations.createdAt))
    .limit(1);

  if (!ev) return null;

  const facts = await loadStudentFacts(studentId);
  const [asp] = await db
    .select()
    .from(aspirations)
    .where(and(eq(aspirations.studentId, studentId), eq(aspirations.isCurrent, true)))
    .orderBy(desc(aspirations.createdAt))
    .limit(1);

  const evidenceRows = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.studentId, studentId))
    .orderBy(desc(artifacts.createdAt));

  const trackConfig = (policy.tracks as Record<string, (typeof policy.tracks)[keyof typeof policy.tracks] | undefined>)[
    ev.track
  ];
  const trackName = trackConfig?.name ?? ev.track;
  const evRef = `ev:${ev.id.slice(0, 8)}`;

  // ── Build three facts (rule-derived, never from model) ──────────────────────
  const mentorFacts: MentorFact[] = [];

  // Fact 1: Track score vs readiness
  mentorFacts.push({
    label: "Track score vs target readiness",
    value: `${Number(ev.trackScore).toFixed(1)} out of ${ev.readiness}`,
    sourceField: "evaluations.track_score, evaluations.readiness",
    evRef,
  });

  // Fact 2: GAP index
  mentorFacts.push({
    label: "Gap index",
    value: ev.aegIndex,
    sourceField: "evaluations.aeg_index",
    evRef,
  });

  // Fact 3: Most impactful evidence status (best verified vs unverified count)
  const verifiedCount = evidenceRows.filter((e) => e.status === "VERIFIED" || e.status === "ATTESTED").length;
  const totalCount = evidenceRows.length;
  mentorFacts.push({
    label: "Verified evidence items",
    value: `${verifiedCount} of ${totalCount}`,
    sourceField: "artifacts.status",
    evRef,
  });

  // ── Identify data gaps ──────────────────────────────────────────────────────
  const dataGaps: string[] = [];

  if (!asp) {
    dataGaps.push("No ambition declared — student has not set a career track or target date");
  }
  if (facts.cgpa == null) {
    dataGaps.push("CGPA not recorded");
  }
  if (facts.attendancePct == null) {
    dataGaps.push("Attendance not recorded");
  }
  if (evidenceRows.length === 0) {
    dataGaps.push("No evidence items added yet");
  }
  // Find components with zero verified evidence
  const verifiedComponents = new Set(
    evidenceRows.filter((e) => e.status === "VERIFIED" || e.status === "ATTESTED").map((e) => e.component),
  );
  const trackComponents = Object.keys(trackConfig?.components ?? {});
  for (const comp of trackComponents) {
    if (!verifiedComponents.has(comp)) {
      dataGaps.push(`No verified evidence in component: ${comp.replaceAll("_", " ")}`);
    }
  }

  // ── Two suggested questions ─────────────────────────────────────────────────
  const suggestedQuestions: string[] = [];

  if (ev.aegIndex === "CRITICAL" || ev.aegIndex === "MODERATE") {
    suggestedQuestions.push("What has been the biggest obstacle to submitting evidence this term?");
  } else {
    suggestedQuestions.push("Which of the current quests feels most achievable in the next two weeks?");
  }

  if (asp?.targetDate) {
    const monthsLeft = Math.max(0, Math.round((new Date(asp.targetDate).getTime() - Date.now()) / (30 * 86_400_000)));
    suggestedQuestions.push(
      `With ${monthsLeft} months to the target date, what's the one thing that would most change your readiness score?`,
    );
  } else {
    suggestedQuestions.push("Have you thought about which career track you want to commit to this term?");
  }

  // ── Pivot advisory (§7.6) ───────────────────────────────────────────────────
  let pivotAdvice: string | null = null;
  const result = ev.result as { pivotAdvisory?: { advisedTrack?: string; scoreDelta?: number } };
  if (result.pivotAdvisory?.advisedTrack) {
    const advisedName =
      (policy.tracks as Record<string, { name: string } | undefined>)[result.pivotAdvisory.advisedTrack]?.name ??
      result.pivotAdvisory.advisedTrack;
    const delta = result.pivotAdvisory.scoreDelta?.toFixed(1) ?? "?";
    pivotAdvice = `A pivot to "${advisedName}" could improve the score by approximately ${delta} points based on current evidence.`;
  }

  // ── Active interventions ────────────────────────────────────────────────────
  // (Included for context; not displayed to avoid policy-violation showing dispatched messages)

  return {
    studentPseudonymousId: facts.studentId,
    aegIndex: ev.aegIndex as AegLevel,
    trackName,
    trackScore: Number(ev.trackScore),
    readiness: ev.readiness,
    facts: mentorFacts,
    dataGaps,
    suggestedQuestions,
    pivotAdvice,
    evaluationId: ev.id,
    fallback: ev.fallback,
  };
}
