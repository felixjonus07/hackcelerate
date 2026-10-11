import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth/session";
import { tractionView } from "@/server/services/staff-views";

export const metadata: Metadata = { title: "Venture traction" };

async function Traction() {
  const user = await requireUser(["ecell_coordinator"]);
  const rows = await tractionView(user);
  if (!rows.length)
    return (
      <Card>
        <EmptyState title="No one has shared with the E-Cell yet">
          Venture evidence appears here after a student shares it. Grades and attendance are never part of this view.
        </EmptyState>
      </Card>
    );
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {rows.map((r) => (
        <li key={r.studentId}>
          <Card className="h-full">
            <h2 className="text-lg font-extrabold">{r.name ?? r.handle}</h2>
            <p className="text-sm text-ink-2">
              {r.name ? `${r.handle} · ` : ""}
              {r.department} · {r.interviews} customer {r.interviews === 1 ? "interview" : "interviews"}
            </p>
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {r.items.map((i) => (
                <li key={`${i.component}-${i.label}`} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate">{i.label}</span>
                  <EvidenceChip status={i.status} className="shrink-0" />
                </li>
              ))}
            </ul>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function TractionPage() {
  return (
    <>
      <PageHeader
        title="Venture traction"
        description="Evidence students chose to share with the E-Cell: prototypes, interviews, validation."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Traction />
      </Suspense>
    </>
  );
}
