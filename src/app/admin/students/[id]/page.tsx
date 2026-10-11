import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { runEval } from "@/app/admin/actions";
import { PageHeader } from "@/components/shell/app-shell";
import { ComponentRadar } from "@/components/staff/component-radar";
import { NarrativeText } from "@/components/staff/narrative-text";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { GapTag, TrendTag } from "@/components/ui/tag";
import { dateTime, score1 } from "@/lib/format";
import { REASON_CODES, TRACK_LABELS } from "@/lib/labels";
import { STAFF_ROLES } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { AccessDenied, studentBrief } from "@/server/services/students";

export const metadata: Metadata = { title: "Student record" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reason?: string }>;
};

/** §13.2: opening a deep-dive requires a reason code from a fixed list; the reason is logged. */
function ReasonPrompt() {
  return (
    <Card className="max-w-[560px]">
      <CardHeader
        title="Why are you opening this record?"
        hint="Your reason is recorded in the audit log with this view."
      />
      <form className="grid gap-3">
        {REASON_CODES.map((r) => (
          <label key={r.value} className="flex items-center gap-3 rounded-2xl bg-sand px-4 py-3 font-semibold">
            <input type="radio" name="reason" value={r.value} required className="size-4" />
            {r.label}
          </label>
        ))}
        <button
          type="submit"
          className="press mt-2 inline-flex h-11 w-fit items-center rounded-full bg-act px-5 font-bold text-act-ink hover:bg-act-hover"
        >
          Open record
        </button>
      </form>
    </Card>
  );
}

async function Record({ params, searchParams }: Props) {
  const user = await requireUser(STAFF_ROLES);
  const [{ id }, { reason }] = await Promise.all([params, searchParams]);
  if (!reason || !REASON_CODES.some((r) => r.value === reason)) return <ReasonPrompt />;
  let brief: Awaited<ReturnType<typeof studentBrief>>;
  try {
    brief = await studentBrief(id, user, {
      reasonCode: reason,
      purpose: reason,
      sourceIp: (await headers()).get("x-forwarded-for"),
    });
  } catch (e) {
    if (e instanceof AccessDenied)
      return (
        <Card>
          <EmptyState title="You can't open this record">{e.message}. The attempt has been logged.</EmptyState>
        </Card>
      );
    throw e;
  }
  const ev = brief.evaluation;
  const labels = new Map(brief.evidence.map((x) => [x.id, x.label]));
  return (
    <>
      <PageHeader
        title={`${brief.student.pseudonymousId} · ${ev ? TRACK_LABELS[ev.track] : "No evaluation yet"}`}
        description={`${brief.departmentName}, year ${brief.student.year} · synthetic record · reason: ${REASON_CODES.find((r) => r.value === reason)?.label}`}
        actions={
          ["faculty_mentor", "registrar"].includes(user.role) ? (
            <form action={runEval.bind(null, brief.student.id)}>
              <button
                type="submit"
                className="press inline-flex h-11 items-center rounded-full bg-sand-2 px-5 font-bold hover:bg-sand-3"
              >
                Run evaluation
              </button>
            </form>
          ) : null
        }
      />
      {ev ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Summary"
              hint={`Policy ${ev.policyVersion} · engine ${ev.engineVersion} · ${dateTime(ev.createdAt)}`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <span className="tabular text-5xl font-black">{score1(ev.trackScore)}</span>
              <span className="text-ink-2">of readiness {ev.readiness}</span>
              <GapTag level={ev.aegIndex} audience="staff" />
              <TrendTag trend={ev.trend} />
            </div>
            {ev.narrative ? (
              <div className="mt-5 grid gap-2 text-[0.95rem]">
                {ev.fallback ? (
                  <p className="text-sm font-bold text-mod">
                    Narrative generated from rules; AI narrative unavailable.
                  </p>
                ) : null}
                <NarrativeText text={ev.narrative.risk_summary} labels={labels} />
              </div>
            ) : null}
          </Card>
          <Card>
            <CardHeader title="Components" hint="Score per component, 0–100" />
            <ComponentRadar
              data={ev.result.trackScore.components.map((c) => ({
                label: c.label,
                score: Math.round(c.score * 10) / 10,
              }))}
            />
          </Card>
          <Card>
            <CardHeader title="Evidence" />
            {brief.evidence.length ? (
              <ul className="divide-y divide-line">
                {brief.evidence.map((x) => (
                  <li key={x.id} id={`ev-${x.id}`} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate">{x.label}</span>
                    <EvidenceChip status={x.status} className="shrink-0" />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No evidence visible">
                Either none has been added, or your role can't see evidence for this student.
              </EmptyState>
            )}
          </Card>
          <Card>
            <CardHeader title="Evaluation history" hint="Evaluations are never overwritten" />
            <ul className="tabular divide-y divide-line">
              {brief.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2.5 text-[0.95rem]">
                  <span className="text-ink-2">{dateTime(h.createdAt)}</span>
                  <span className="font-bold">{score1(h.trackScore)}</span>
                  <GapTag level={h.aegIndex} audience="staff" />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <Card>
          <EmptyState title="No evaluation yet">
            Run an evaluation once the student has declared an ambition and added evidence.
          </EmptyState>
        </Card>
      )}
    </>
  );
}

export default function StudentRecordPage(props: Props) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Record {...props} />
    </Suspense>
  );
}
