/**
 * One-page mentor brief (§12.2): three facts, data gaps, the proposal, the
 * narrative with evidence references, and the decision. Persona names are
 * internal and appear only on staff screens.
 */
import { Info } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { CONFIDENCE_NOTE, PERSONA_STAFF, TRACK_LABELS } from "@/lib/labels";
import type { ApprovalRow } from "@/server/services/approvals";
import type { Brief as BuiltBrief } from "@/server/services/brief";
import type { studentBrief } from "@/server/services/students";
import { DecisionForm } from "./decision-form";
import { NarrativeText } from "./narrative-text";

type Brief = Awaited<ReturnType<typeof studentBrief>>;

/** Brief anchors point at sections of the student record (§12.2: each fact links to its source field). */
const sectionOf = (anchor: string) => (anchor.startsWith("component-") ? "components" : anchor);

export function MentorBrief({ row, brief, built }: { row: ApprovalRow; brief: Brief; built: BuiltBrief | null }) {
  const ev = brief.evaluation;
  const result = ev?.result;
  const persona = result?.personas.find((p) => p.persona === result.primaryPersona);
  const evidenceIds = new Map(brief.evidence.map((e) => [e.id, e.label]));
  const recordHref = (anchor: string) =>
    `/admin/students/${brief.student.id}?reason=approval_decision#${sectionOf(anchor)}`;

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

      {built ? (
        <>
          <ol className="mt-4 grid gap-2 sm:grid-cols-3">
            {built.facts.map((f) => (
              <li key={f.source.field} className="rounded-2xl bg-sand p-3 text-[0.92rem] font-semibold leading-snug">
                {f.text}
                <Link
                  href={recordHref(f.source.anchor)}
                  className="mt-1.5 block text-sm font-bold text-act-hover hover:underline"
                >
                  {f.source.label}
                </Link>
              </li>
            ))}
          </ol>

          {built.dataGaps.length ? (
            <div className="mt-5">
              <h3 className="font-extrabold">Data gaps</h3>
              <ul className="mt-1.5 list-disc pl-5 text-[0.95rem] text-ink-2">
                {built.dataGaps.map((g) => (
                  <li key={`${g.source.field}-${g.text}`}>
                    {g.text}{" "}
                    <Link href={recordHref(g.source.anchor)} className="font-bold text-act hover:underline">
                      {g.source.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-5">
            <h3 className="font-extrabold">Two questions to open with</h3>
            <ol className="mt-1.5 list-decimal pl-5 text-[0.95rem]">
              {built.questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ol>
          </div>

          <div className="mt-5">
            <h3 className="font-extrabold">Options</h3>
            <ul className="mt-1.5 grid gap-1.5 text-[0.95rem]">
              {built.pivot.options.map((o) => (
                <li key={o.key}>
                  <strong>{o.label}.</strong> <span className="text-ink-2">{o.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      <div className="mt-5 rounded-2xl bg-sand-2 p-4">
        <h3 className="font-extrabold">Proposed next step</h3>
        <p className="mt-1 text-[1.02rem]">{row.proposedMessage}</p>
        <p className="mt-2 text-sm text-ink-2">Nothing is sent until you approve it.</p>
      </div>

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

      <p className="mt-4 text-sm text-ink-2">{ev ? CONFIDENCE_NOTE[ev.confidence] : null}</p>
      <DecisionForm interventionId={row.id} proposed={row.proposedMessage} />
    </Card>
  );
}
