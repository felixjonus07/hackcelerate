import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { ShadowHold } from "@/components/shell/shadow-hold";
import { TrackDonut } from "@/components/staff/track-donut";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { GapTag } from "@/components/ui/tag";
import { dateTime } from "@/lib/format";
import { TRACK_LABELS, TREND_SHORT } from "@/lib/labels";
import { COMMAND_CENTER_ROLES } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { cohortSummary } from "@/server/services/cohort";
import { mayViewOutputs } from "@/server/shadow";

export const metadata: Metadata = { title: "Command Center" };

async function CommandCenter() {
  const user = await requireUser(COMMAND_CENTER_ROLES);
  if (!mayViewOutputs(user)) return <ShadowHold />;
  const s = await cohortSummary(user);
  if (!s.total)
    return (
      <Card>
        <EmptyState title="No students in scope yet">
          Once the ERP import runs, your students and their gap index appear here.
        </EmptyState>
      </Card>
    );
  const donut = s.byTrack.map((t) => ({
    name: t.track ? TRACK_LABELS[t.track] : "No track declared yet",
    value: t.count,
  }));
  const trendTotal = Object.values(s.trend).reduce((a, b) => a + b, 0) || 1;
  const TREND_TONE: Record<string, string> = {
    IMPROVING: "bg-low",
    STABLE: "bg-ink-2",
    WORSENING: "bg-crit",
    INSUFFICIENT_DATA: "bg-mark",
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card className="self-start">
        <CardHeader title="Aspiration pipeline" hint={`${s.total} students · declared tracks`} />
        <TrackDonut data={donut} />
      </Card>
      <div className="grid content-start gap-5">
        <Card>
          <CardHeader
            title="Gap index by track"
            hint={`${s.evaluated} evaluated · counts only, no individual records`}
          />
          <table className="tabular w-full text-left">
            <caption className="sr-only">Students by track and gap index</caption>
            <thead>
              <tr className="text-sm text-ink-2">
                <th className="pb-3 font-bold">Track</th>
                {(["CRITICAL", "MODERATE", "LOW"] as const).map((lvl) => (
                  <th key={lvl} className="pb-3 text-right font-bold">
                    <GapTag level={lvl} audience="staff" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.matrix.map((m) => (
                <tr key={m.track}>
                  <td className="py-3 pr-3 font-semibold">{TRACK_LABELS[m.track]}</td>
                  <td className="py-3 text-right text-lg font-black">{m.CRITICAL}</td>
                  <td className="py-3 text-right text-lg font-black">{m.MODERATE}</td>
                  <td className="py-3 text-right text-lg font-black">{m.LOW}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <CardHeader title="Four-week trend" hint="Share of evaluated students by direction of their key signals" />
          <div aria-hidden className="flex h-3 overflow-hidden rounded-full bg-sand-2">
            {Object.entries(s.trend).map(([k, v]) =>
              v ? <span key={k} className={TREND_TONE[k]} style={{ width: `${(v / trendTotal) * 100}%` }} /> : null,
            )}
          </div>
          <ul className="tabular mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[0.95rem]">
            {Object.entries(s.trend).map(([k, v]) => (
              <li key={k} className="inline-flex items-center gap-2">
                <span aria-hidden className={`size-2.5 rounded-full ${TREND_TONE[k]}`} />
                {TREND_SHORT[k]} <strong>{v}</strong>
              </li>
            ))}
          </ul>
        </Card>
        <p className="px-1 text-sm text-ink-2">
          Cohort summary from the nightly refresh · last evaluation{" "}
          {s.lastEvaluatedAt ? dateTime(s.lastEvaluatedAt) : "—"}
        </p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Command Center"
        description="Aggregates for planning. Individual records open only from the approval queue or the counseling board, with a logged reason."
      />
      <Suspense fallback={<PageSkeleton />}>
        <CommandCenter />
      </Suspense>
    </>
  );
}
