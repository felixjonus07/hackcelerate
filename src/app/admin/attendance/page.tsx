import { AlertTriangle, CircleCheck, CircleDot } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag, TrendTag } from "@/components/ui/tag";
import { pct, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { attendanceView } from "@/server/services/staff-views";

export const metadata: Metadata = { title: "Attendance" };

const BAND = {
  ok: { kind: "low", label: "On track", icon: <CircleCheck aria-hidden className="size-3.5" /> },
  watch: { kind: "mod", label: "Watch band", icon: <CircleDot aria-hidden className="size-3.5" /> },
  critical: { kind: "crit", label: "Below the floor", icon: <AlertTriangle aria-hidden className="size-3.5" /> },
} as const;

async function Attendance() {
  const user = await requireUser(["class_advisor"]);
  const rows = await attendanceView(user);
  if (!rows.length)
    return (
      <Card>
        <EmptyState title="No students assigned">Your assigned students and their attendance appear here.</EmptyState>
      </Card>
    );
  const stale = rows.some((r) => r.stale);
  return (
    <div className="grid gap-4">
      {stale ? (
        <p role="note" className="rounded-card bg-mod-bg px-5 py-4 font-semibold text-mod">
          Some figures come from an old import. Check the date in the last column before acting on them.
        </p>
      ) : null}
      {/* Phones: one stacked row per student so every figure stays visible. */}
      <Card className="md:hidden">
        <ul className="tabular divide-y divide-line">
          {rows.map((r) => {
            const b = BAND[r.band];
            return (
              <li key={r.studentId} className="grid gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0">
                    <span className="block font-extrabold">{r.name}</span>
                    <span className="text-sm text-ink-2">
                      {r.rollNumber} · year {r.year}
                    </span>
                  </p>
                  <span className="text-lg font-black">{pct(r.attendancePct)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tag kind={b.kind} icon={b.icon}>
                    {b.label}
                  </Tag>
                  <TrendTag trend={r.trend} />
                </div>
                <p className={r.stale ? "text-sm font-bold text-mod" : "text-sm text-ink-2"}>
                  Imported {r.importedAt ? shortDate(r.importedAt) : "never"}
                  {r.stale ? " · out of date" : ""}
                </p>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card className="hidden p-0 sm:p-0 md:block">
        <table className="tabular w-full text-left">
          <caption className="sr-only">Attendance of your assigned students</caption>
          <thead className="text-sm text-ink-2">
            <tr>
              <th className="px-5 py-3 font-bold">Student</th>
              <th className="px-3 py-3 text-right font-bold">Attendance</th>
              <th className="px-3 py-3 font-bold">Band</th>
              <th className="px-3 py-3 font-bold">Trend</th>
              <th className="px-5 py-3 font-bold">Imported</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const b = BAND[r.band];
              return (
                <tr key={r.studentId}>
                  <td className="px-5 py-3">
                    <p className="font-extrabold">{r.name}</p>
                    <p className="text-sm text-ink-2">
                      {r.rollNumber} · year {r.year}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right text-lg font-black">{pct(r.attendancePct)}</td>
                  <td className="px-3 py-3">
                    <Tag kind={b.kind} icon={b.icon}>
                      {b.label}
                    </Tag>
                  </td>
                  <td className="px-3 py-3">
                    <TrendTag trend={r.trend} />
                  </td>
                  <td className={r.stale ? "px-5 py-3 font-bold text-mod" : "px-5 py-3 text-ink-2"}>
                    {r.importedAt ? shortDate(r.importedAt) : "No import"}
                    {r.stale ? " · out of date" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function AttendancePage() {
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Attendance and attendance flags for your assigned students. Nothing else about them is shown here."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Attendance />
      </Suspense>
    </>
  );
}
