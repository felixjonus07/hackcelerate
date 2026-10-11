/**
 * One-page mentor brief (§12.2): three facts, data gaps, the proposal, the
 * narrative with evidence references, and the decision. Persona names are
 * internal and appear only on staff screens.
 * Also shows two suggested questions (§8.2) and pivot advisory (§7.6).
 */
import { Info } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { score1 } from "@/lib/format";
import { CONFIDENCE_NOTE, PERSONA_STAFF, TRACK_LABELS } from "@/lib/labels";
import type { ApprovalRow } from "@/server/services/approvals";
import type { studentBrief } from "@/server/services/students";
import { DecisionForm } from "./decision-form";
import { NarrativeText } from "./narrative-text";

type Brief = Awaited<ReturnType<typeof studentBrief>>;

/** Two contextual questions the mentor can ask (§8.2). Derived from rules output; no model. */
function buildSuggestedQuestions(aegIndex: string, targetDate?: string | null): string[] {
  const q1 =
    aegIndex === "CRITICAL" || aegIndex === "MODERATE"
      ? "What has been the biggest obstacle to making progress this term?"
      : "Which quest feels most achievable in the next two weeks?";
  const q2 = targetDate
    ? (() => {
        const months = Math.max(0, Math.round((new Date(targetDate).getTime() - Date.now()) / (30 * 86_400_000)));
        return `With ${months} month${months !== 1 ? "s" : ""} to the target date, what one action would most move the score?`;
      })()
    : "Have you thought about which career track to commit to this term?";
  return [q1, q2];
}

export function MentorBrief({ row, brief }: { row: ApprovalRow; brief: Brief }) {
  const ev = brief.evaluation;
  const result = ev?.result;
  const persona = result?.personas.find((p) => p.persona === result.primaryPersona);
  const evidenceIds = new Map(brief.evidence.map((e) => [e.id, e.label]));
  const evRef = ev ? `ev:${ev.id.slice(0, 8)}` : "ev:pending";
  const verifiedCount = brief.evidence.filter((e) => e.status === "VERIFIED" || e.status === "ATTESTED").length;
  const structuredFacts = [
    {
      label: "Track score vs target readiness",
      value: `${score1(ev?.trackScore)} / ${ev?.readiness ?? "—"}`,
      sourceField: "evaluations.track_score, evaluations.readiness",
      evRef,
    },
    {
      label: "Gap index & trend",
      value: `${ev?.aegIndex ?? "—"} · ${ev?.trend.toLowerCase() ?? "—"}`,
      sourceField: "evaluations.aeg_index, evaluations.trend",
      evRef,
    },
    {
      label: "Verified evidence items",
      value: `${verifiedCount} of ${brief.evidence.length} verified`,
      sourceField: "artifacts.status",
      evRef,
    },
  ];

  const questions = ev ? buildSuggestedQuestions(ev.aegIndex) : null;
  const pivotAdvisory = (result as { pivotAdvisory?: { advisedTrack?: string; scoreDelta?: number } } | undefined)
    ?.pivotAdvisory;

  return (
    <Card aria-labelledby="brief-h" className="self-start">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="brief-h" className="text-xl font-black">
            {brief.student.pseudonymousId} · {TRACK_LABELS[row.track]}
          </h2>
          <p className="text-sm text-ink-2">
            {brief.departmentName}, year {brief.student.year} · synthetic record · view logged (approval decision)
          </p>
        </div>
        <Link
          href={`/admin/students/${brief.student.id}?reason=approval_decision`}
          className="text-sm font-bold text-act hover:underline"
        >
          Full record
        </Link>
      </div>

      {persona ? (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-sand px-3 py-1.5 text-sm font-bold">
          <Info aria-hidden className="size-4 text-ink-2" />
          {PERSONA_STAFF[persona.persona]} · floor {persona.floor.toLowerCase()} · index driven by {result?.aegDrivenBy}
        </p>
      ) : null}

      {/* Three facts (§8.2) — each fact linked to its source field */}
      <div className="mt-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-2">Three verifiable facts</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {structuredFacts.map((f) => (
            <li key={f.label} className="rounded-2xl bg-sand p-3 text-[0.92rem] font-semibold leading-snug">
              <span className="block text-xs font-medium text-ink-2">{f.label}</span>
              <span className="mt-0.5 block font-black text-ink">{f.value}</span>
              <span className="mt-1.5 block text-[0.72rem] font-mono text-ink-3">
                src: {f.sourceField} · {f.evRef}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Data gaps */}
      {result?.trackScore.dataGaps.length ? (
        <div className="mt-5">
          <h3 className="font-extrabold">Data gaps</h3>
          <ul className="mt-1.5 list-disc pl-5 text-[0.95rem] text-ink-2">
            {result.trackScore.dataGaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Proposed message */}
      <div className="mt-5 rounded-2xl bg-sand-2 p-4">
        <h3 className="font-extrabold">Proposed next step</h3>
        <p className="mt-1 text-[1.02rem]">{row.proposedMessage}</p>
        <p className="mt-2 text-sm text-ink-2">Nothing is sent until you approve it.</p>
      </div>

      {/* Narrative */}
      {ev?.narrative ? (
        <div className="mt-5 grid gap-2 text-[0.95rem]">
          <h3 className="font-extrabold">Narrative</h3>
          {ev.fallback ? (
            <p className="text-sm font-bold text-mod">Narrative generated from rules; AI narrative unavailable.</p>
          ) : null}
          <NarrativeText text={ev.narrative.risk_summary} labels={evidenceIds} />
          <NarrativeText text={ev.narrative.department_context_analysis} labels={evidenceIds} />
        </div>
      ) : null}

      {/* Evidence preview */}
      {brief.evidence.length ? (
        <ul className="mt-5 divide-y divide-line border-t border-line">
          {brief.evidence.slice(0, 6).map((e) => (
            <li key={e.id} id={`ev-${e.id}`} className="flex items-center justify-between gap-3 py-2.5 text-[0.95rem]">
              <span className="min-w-0 truncate">{e.label}</span>
              <EvidenceChip status={e.status} className="shrink-0" />
            </li>
          ))}
        </ul>
      ) : null}

      {/* Two suggested questions (§8.2) */}
      {questions ? (
        <div className="mt-5">
          <h3 className="font-extrabold">Suggested questions</h3>
          <ol className="mt-1.5 grid list-decimal gap-1.5 pl-5 text-[0.95rem] text-ink-2">
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* Pivot advisory (§7.6) */}
      {pivotAdvisory?.advisedTrack ? (
        <div className="mt-5 rounded-2xl border border-line p-4">
          <h3 className="font-extrabold">Pivot advisory</h3>
          <p className="mt-1 text-[0.95rem] text-ink-2">
            A pivot to <strong>{pivotAdvisory.advisedTrack}</strong> could improve the score by approximately{" "}
            <strong>{(pivotAdvisory.scoreDelta ?? 0).toFixed(1)} points</strong> based on current evidence. This is
            advisory only — a human must confirm any pivot (§7.6).
          </p>
        </div>
      ) : null}

      <p className="mt-4 text-sm text-ink-2">{ev ? CONFIDENCE_NOTE[ev.confidence] : null}</p>
      <DecisionForm interventionId={row.id} proposed={row.proposedMessage} />
    </Card>
  );
}

export function MentorGuidanceCard({ brief }: { brief: Brief }) {
  const ev = brief.evaluation;
  if (!ev) return null;
  const result = ev.result;
  const evRef = `ev:${ev.id.slice(0, 8)}`;
  const verifiedCount = brief.evidence.filter((e) => e.status === "VERIFIED" || e.status === "ATTESTED").length;
  const structuredFacts = [
    {
      label: "Track score vs target readiness",
      value: `${score1(ev.trackScore)} / ${ev.readiness}`,
      sourceField: "evaluations.track_score, evaluations.readiness",
      evRef,
    },
    {
      label: "Gap index & trend",
      value: `${ev.aegIndex} · ${ev.trend.toLowerCase()}`,
      sourceField: "evaluations.aeg_index, evaluations.trend",
      evRef,
    },
    {
      label: "Verified evidence items",
      value: `${verifiedCount} of ${brief.evidence.length} verified`,
      sourceField: "artifacts.status",
      evRef,
    },
  ];

  const questions = buildSuggestedQuestions(ev.aegIndex);
  const pivotAdvisory = (result as { pivotAdvisory?: { advisedTrack?: string; scoreDelta?: number } } | undefined)
    ?.pivotAdvisory;

  return (
    <Card aria-labelledby="guidance-h">
      <h2 id="guidance-h" className="text-lg font-black">
        Mentor guidance (§8.2)
      </h2>
      <p className="text-sm text-ink-2">Rule-derived facts, suggested questions and pivot advisory</p>

      {/* Three facts (§8.2) — each fact linked to its source field */}
      <div className="mt-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-2">Three verifiable facts</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-3">
          {structuredFacts.map((f) => (
            <li key={f.label} className="rounded-2xl bg-sand p-3 text-[0.92rem] font-semibold leading-snug">
              <span className="block text-xs font-medium text-ink-2">{f.label}</span>
              <span className="mt-0.5 block font-black text-ink">{f.value}</span>
              <span className="mt-1.5 block text-[0.72rem] font-mono text-ink-3">
                src: {f.sourceField} · {f.evRef}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Data gaps */}
      {result?.trackScore.dataGaps.length ? (
        <div className="mt-5">
          <h3 className="font-extrabold">Data gaps</h3>
          <ul className="mt-1.5 list-disc pl-5 text-[0.95rem] text-ink-2">
            {result.trackScore.dataGaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Two suggested questions (§8.2) */}
      <div className="mt-5">
        <h3 className="font-extrabold">Suggested questions for conversation</h3>
        <ol className="mt-1.5 grid list-decimal gap-1.5 pl-5 text-[0.95rem] text-ink-2">
          {questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </div>

      {/* Pivot advisory (§7.6) */}
      {pivotAdvisory?.advisedTrack ? (
        <div className="mt-5 rounded-2xl border border-line p-4">
          <h3 className="font-extrabold">Pivot advisory</h3>
          <p className="mt-1 text-[0.95rem] text-ink-2">
            A pivot to <strong>{pivotAdvisory.advisedTrack}</strong> could improve the score by approximately{" "}
            <strong>{(pivotAdvisory.scoreDelta ?? 0).toFixed(1)} points</strong> based on current evidence. This is
            advisory only — a human must confirm any pivot (§7.6).
          </p>
        </div>
      ) : null}
    </Card>
  );
}
