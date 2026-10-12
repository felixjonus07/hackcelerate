import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { PrintButton } from "@/components/staff/print-button";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { GapTag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { dateTime, shortDate } from "@/lib/format";
import { VERIFICATION_LABELS } from "@/lib/labels";
import { audit } from "@/server/audit/log";
import { requireUser } from "@/server/auth/session";
import { AUDIT_REASONS, auditReport, SampleError, sampleRecords } from "@/server/services/audit-report";

export const metadata: Metadata = { title: "Audit report" };

type Search = Promise<{ department?: string; reason?: string; note?: string }>;

const REASON_TEXT: Record<string, string> = {
  audit_request: "Audit request",
  approval_decision: "Approval decision",
  scheduled_mentoring: "Scheduled mentoring",
  other: "Other (add a note)",
};

async function Sample({
  user,
  reason,
  note,
}: {
  user: Awaited<ReturnType<typeof requireUser>>;
  reason?: string;
  note: string;
}) {
  let rows: Awaited<ReturnType<typeof sampleRecords>> = [];
  let problem: string | null = null;
  if (reason) {
    try {
      rows = await sampleRecords(user, reason, note);
    } catch (e) {
      if (e instanceof SampleError) problem = e.message;
      else throw e;
    }
  }
  return (
    <Card className="no-print">
      <CardHeader
        title="Sampled records"
        hint="Opening a sample needs a reason. Each record read is logged with it. A sample shows provenance and evidence status, never a narrative."
      />
      <form className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm font-bold">
          Reason
          <select
            name="reason"
            defaultValue={reason ?? "audit_request"}
            className="h-11 rounded-field border border-line bg-card px-3 text-base font-normal"
          >
            {AUDIT_REASONS.map((r) => (
              <option key={r} value={r}>
                {REASON_TEXT[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[220px] flex-1 gap-1.5 text-sm font-bold">
          Note <span className="font-normal text-ink-2">(required for “other”)</span>
          <input
            name="note"
            defaultValue={note}
            maxLength={300}
            className="h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
          />
        </label>
        <button type="submit" className={buttonClass()}>
          Draw a sample
        </button>
      </form>
      {problem ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-crit">
          {problem}
        </p>
      ) : null}
      {rows.length ? (
        <div className="mt-5 overflow-x-auto">
          <table className="tabular w-full min-w-[640px] text-left text-[0.92rem]">
            <caption className="sr-only">Sampled evaluation records</caption>
            <thead className="text-sm text-ink-2">
              <tr>
                <th className="pb-2 font-bold">Student</th>
                <th className="pb-2 font-bold">Evaluated</th>
                <th className="pb-2 font-bold">Policy / engine</th>
                <th className="pb-2 font-bold">Narrative by</th>
                <th className="pb-2 font-bold">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((x) => (
                <tr key={x.handle}>
                  <td className="py-2">
                    {x.handle} <span className="text-ink-2">· {x.department}</span>
                  </td>
                  <td className="py-2">{dateTime(x.evaluatedAt)}</td>
                  <td className="py-2">
                    {x.policyVersion} / {x.engineVersion}
                  </td>
                  <td className="py-2">{x.fallback ? "rules only" : x.model}</td>
                  <td className="py-2 text-ink-2">
                    {Object.entries(x.evidence)
                      .map(([k, n]) => `${n} ${(VERIFICATION_LABELS[k] ?? k).toLowerCase()}`)
                      .join(", ") || "none"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

async function Report({ searchParams }: { searchParams: Search }) {
  const user = await requireUser(["dean", "auditor", "hod"]);
  const q = await searchParams;
  const r = await auditReport({ department: q.department || undefined });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "audit_report.view",
    entityType: "report",
    entityId: r.policy.version,
    purpose: "audit_request",
    result: "allowed",
  });
  return (
    <div className="grid gap-5">
      {r.policy.status !== "ACTIVE" ? (
        <p role="note" className="flex items-start gap-3 rounded-card bg-mod-bg px-5 py-4 font-semibold text-mod">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
          Policy {r.policy.version} is still a {r.policy.status.toLowerCase()}. {r.policy.note}
        </p>
      ) : null}
      <nav aria-label="Department" className="no-print -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {[{ code: "", n: 0 }, ...r.departments].map((d) => {
          const on = (r.department ?? "") === d.code;
          return (
            <Link
              key={d.code || "all"}
              href={d.code ? `/admin/audit-report?department=${d.code}` : "/admin/audit-report"}
              aria-current={on ? "page" : undefined}
              className={cn(
                "press shrink-0 rounded-full px-4 py-2 text-sm font-bold",
                on ? "bg-ink text-sand" : "bg-sand-2 text-ink hover:bg-sand-3",
              )}
            >
              {d.code || "All departments"}
            </Link>
          );
        })}
      </nav>
      <div className="grid gap-5 md:grid-cols-3">
        {[
          ["Students evaluated", r.evalStats.students],
          ["Evaluations recorded", r.evalStats.total],
          ["Rules-only narratives", r.evalStats.fallback],
        ].map(([k, v]) => (
          <Card key={String(k)}>
            <p className="text-sm font-bold text-ink-2">{k}</p>
            <p className="tabular mt-1 text-4xl font-black">{v}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Gap index across all evaluations" />
          <ul className="tabular grid gap-2">
            {r.byIndex.map((b) => (
              <li key={b.level} className="flex items-center justify-between">
                <GapTag level={b.level} audience="staff" />
                <span className="text-lg font-black">{b.n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Interventions by status" hint="Every intervention starts in the approval queue" />
          <ul className="tabular grid gap-2">
            {r.byStatus.map((b) => (
              <li key={b.status} className="flex items-center justify-between">
                <span>{b.status.replaceAll("_", " ").toLowerCase()}</span>
                <span className="text-lg font-black">{b.n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Evidence by status" hint="Verified and attested items count in full" />
          <ul className="tabular grid gap-2">
            {r.evidenceByStatus.map((b) => (
              <li key={b.status} className="flex items-center justify-between">
                <span>{VERIFICATION_LABELS[b.status] ?? b.status}</span>
                <span className="text-lg font-black">{b.n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Policy history" hint="Each version, when it started and what it changed" />
          <ul className="divide-y divide-line text-[0.95rem]">
            {r.policyHistory.map((p) => (
              <li key={p.version} className="py-2.5">
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{p.version}</span>
                  <span className="text-sm text-ink-2">
                    {p.status.toLowerCase()} · from {shortDate(p.effectiveFrom)}
                  </span>
                </p>
                {p.changed.length ? <p className="text-sm text-ink-2">Changed: {p.changed.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Audit log activity" hint="Append-only; counts by action" />
          <table className="tabular w-full text-left text-[0.95rem]">
            <thead className="text-sm text-ink-2">
              <tr>
                <th className="pb-2 font-bold">Action</th>
                <th className="pb-2 text-right font-bold">Events</th>
                <th className="pb-2 text-right font-bold">Latest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {r.recent.map((a) => (
                <tr key={a.action}>
                  <td className="py-2">{a.action}</td>
                  <td className="py-2 text-right font-bold">{a.n}</td>
                  <td className="py-2 text-right text-ink-2">{dateTime(a.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Suspense fallback={null}>
        <Sample user={user} reason={q.reason} note={q.note ?? ""} />
      </Suspense>
      <p className="text-sm text-ink-2">
        Generated {dateTime(r.generatedAt)} · policy {r.policy.version}
        {r.department ? ` · department ${r.department}` : " · all departments"} · aggregates only; sampled records
        require a logged reason.
      </p>
    </div>
  );
}

export default function AuditReportPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <PageHeader
        title="Audit report"
        description="Print-ready summary for NAAC or external audit."
        actions={<PrintButton />}
      />
      <Suspense fallback={<PageSkeleton />}>
        <Report searchParams={searchParams} />
      </Suspense>
    </>
  );
}
