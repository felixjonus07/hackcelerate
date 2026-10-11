import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { MentorBrief } from "@/components/staff/mentor-brief";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CardSkeleton, Skeleton } from "@/components/ui/skeleton";
import { GapTag, TrendTag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { dateTime, score1 } from "@/lib/format";
import { ROUTE_LABELS, TRACK_SHORT } from "@/lib/labels";
import { APPROVER_ROLES } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { pendingApprovals } from "@/server/services/approvals";
import { studentBrief } from "@/server/services/students";
import { workingDaysUntil } from "@/server/services/time";

export const metadata: Metadata = { title: "Approvals" };

async function Queue({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const user = await requireUser(APPROVER_ROLES);
  const { id } = await searchParams;
  const rows = await pendingApprovals(user);
  const selected = rows.find((r) => r.id === id) ?? rows[0];

  if (!rows.length)
    return (
      <Card>
        <EmptyState title="Nothing waiting for you">
          New proposals arrive after each evaluation. The nightly refresh runs at 02:00; you can also run an evaluation
          from a student's record.
        </EmptyState>
      </Card>
    );

  const brief = selected
    ? await studentBrief(selected.studentId, user, {
        purpose: "approval_decision",
      })
    : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <Card className="self-start p-3 sm:p-3">
        <h2 className="sr-only">Pending proposals</h2>
        <ul className="grid gap-1.5">
          {rows.map((r) => {
            const due = workingDaysUntil(r.slaDueAt);
            const active = r.id === selected?.id;
            return (
              <li key={r.id}>
                <Link
                  href={`/admin/approvals?id=${r.id}`}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "press block rounded-2xl px-4 py-3.5",
                    active ? "bg-card ring-2 ring-inset ring-ink shadow-card" : "hover:bg-sand",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-extrabold">
                        {r.pseudonymousId}{" "}
                        <span className="font-semibold text-ink-2">
                          · {r.departmentCode}, Y{r.year}
                        </span>
                      </p>
                      <p className="text-sm text-ink-2">
                        {ROUTE_LABELS[r.routeKey] ?? r.routeKey} · {TRACK_SHORT[r.track]} {score1(r.trackScore)}
                        {r.queued ? " · queued behind a higher-priority route" : ""}
                      </p>
                    </div>
                    <span className={cn("tabular shrink-0 text-sm font-bold", due <= 1 ? "text-crit" : "text-ink-2")}>
                      {due <= 0 ? "Due today" : `${due} working day${due === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <GapTag level={r.aegIndex} audience="staff" />
                    <TrendTag trend={r.trend} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
      {selected && brief ? <MentorBrief row={selected} brief={brief} /> : null}
      <p className="text-sm text-ink-2 lg:col-span-2">
        <RefreshCw aria-hidden className="mr-1 inline size-3.5" />
        Latest evaluation {rows[0] ? dateTime(rows[0].createdAt) : "—"}. Check the import date before approving: a stale
        import can mislead.
      </p>
    </div>
  );
}

export default function ApprovalsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  return (
    <>
      <PageHeader
        title="Approval queue"
        description="Nothing reaches a student until you approve it. Each fact links to its evidence."
      />
      <Suspense
        fallback={
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="grid gap-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <CardSkeleton lines={6} />
          </div>
        }
      >
        <Queue searchParams={searchParams} />
      </Suspense>
    </>
  );
}
