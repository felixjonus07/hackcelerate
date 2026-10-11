import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { RequestForm } from "@/components/staff/request-form";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { openRequestsFor } from "@/server/services/rights";

export const metadata: Metadata = { title: "Data requests" };

const KIND: Record<string, string> = { access: "Data download", correction: "Correction", erasure: "Erasure" };

type Plan = { key: string; label: string; action: string; reason: string }[];

async function Requests() {
  const user = await requireUser(["registrar", "faculty_mentor"]);
  const rows = await openRequestsFor(user);
  if (!rows.length)
    return (
      <Card>
        <EmptyState title="No open requests">
          Corrections and erasure requests from students appear here with their reply deadline.
        </EmptyState>
      </Card>
    );
  return (
    <ul className="grid gap-4">
      {rows.map(({ r, pseudo, dept }) => {
        const overdue = r.dueAt != null && r.dueAt < new Date();
        return (
          <li key={r.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold">
                    {KIND[r.kind] ?? r.kind} · {pseudo}
                  </h2>
                  <p className="text-sm text-ink-2">
                    {dept} · asked {shortDate(r.createdAt)}
                  </p>
                </div>
                {r.dueAt ? (
                  <Tag kind={overdue ? "crit" : "neutral"}>
                    {overdue ? "Past the deadline" : `Reply by ${shortDate(r.dueAt)}`}
                  </Tag>
                ) : null}
              </div>
              {r.detail ? <p className="mt-3 max-w-[70ch] text-[0.95rem]">{r.detail}</p> : null}
              {r.kind === "erasure" && Array.isArray(r.plan) ? (
                <ul className="mt-4 divide-y divide-line border-t border-line text-[0.95rem]">
                  {(r.plan as Plan).map((l) => (
                    <li key={l.key} className="grid gap-0.5 py-2.5">
                      <span className="font-semibold">
                        {l.label}{" "}
                        <span className="font-normal text-ink-2">· {l.action === "keep" ? "kept" : "erased now"}</span>
                      </span>
                      <span className="text-sm text-ink-2">{l.reason}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-5 border-t border-line pt-5">
                <RequestForm id={r.id} canErase={r.kind === "erasure" && user.role === "registrar"} />
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

export default function RequestsPage() {
  return (
    <>
      <PageHeader
        title="Data requests"
        description="Students can ask to correct or erase their data. Each request has a deadline set by the policy."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Requests />
      </Suspense>
    </>
  );
}
