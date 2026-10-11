import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { PrintButton } from "@/components/staff/print-button";
import { Card, CardHeader } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import { GapTag } from "@/components/ui/tag";
import { dateTime } from "@/lib/format";
import { audit } from "@/server/audit/log";
import { requireUser } from "@/server/auth/session";
import { auditReport } from "@/server/services/audit-report";

export const metadata: Metadata = { title: "Audit report" };

async function Report() {
  const user = await requireUser(["dean", "auditor", "hod"]);
  const r = await auditReport();
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
      <p className="text-sm text-ink-2">
        Generated {dateTime(r.generatedAt)} · policy {r.policy.version} · aggregates only; sampled records require a
        logged reason.
      </p>
    </div>
  );
}

export default function AuditReportPage() {
  return (
    <>
      <PageHeader
        title="Audit report"
        description="Print-ready summary for NAAC or external audit."
        actions={<PrintButton />}
      />
      <Suspense fallback={<PageSkeleton />}>
        <Report />
      </Suspense>
    </>
  );
}
