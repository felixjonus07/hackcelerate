import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { score1 } from "@/lib/format";
import { TRACK_SHORT } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { placementReadiness } from "@/server/services/staff-views";

export const metadata: Metadata = { title: "Placement readiness" };

async function Readiness() {
  const user = await requireUser(["placement_officer"]);
  const rows = await placementReadiness(user);
  if (!rows.length)
    return (
      <Card>
        <EmptyState title="No one has shared with the placement cell yet">
          Students appear here only after they switch sharing on. Each field you see is one they agreed to share.
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
              {r.department}, year {r.year}
            </p>
            <dl className="tabular mt-3 grid grid-cols-3 gap-2">
              {r.academic ? (
                <>
                  <div className="rounded-2xl bg-sand p-3">
                    <dt className="text-sm text-ink-2">CGPA</dt>
                    <dd className="font-extrabold">{r.academic.cgpa?.toFixed(2) ?? "—"}</dd>
                  </div>
                  <div className="rounded-2xl bg-sand p-3">
                    <dt className="text-sm text-ink-2">Attendance</dt>
                    <dd className="font-extrabold">
                      {r.academic.attendancePct != null ? `${r.academic.attendancePct}%` : "—"}
                    </dd>
                  </div>
                </>
              ) : null}
              {r.tests ? (
                <div className="rounded-2xl bg-sand p-3">
                  <dt className="text-sm text-ink-2">Aptitude</dt>
                  <dd className="font-extrabold">{r.tests.aptitude != null ? score1(r.tests.aptitude) : "—"}</dd>
                </div>
              ) : null}
            </dl>
            {r.readiness ? (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-[0.95rem]">
                <Tag>{TRACK_SHORT[r.readiness.track] ?? r.readiness.track}</Tag>
                <span>
                  Score <strong className="tabular">{score1(r.readiness.score)}</strong> · gap{" "}
                  {r.readiness.gap.toLowerCase()}
                </span>
              </p>
            ) : null}
            {r.projects?.length ? (
              <ul className="mt-3 divide-y divide-line border-t border-line">
                {r.projects.map((p) => (
                  <li key={p.label} className="flex items-center justify-between gap-3 py-2 text-[0.95rem]">
                    <span className="min-w-0 truncate">{p.label}</span>
                    <EvidenceChip status={p.status} className="shrink-0" />
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-sm text-ink-2">Shared: {r.fieldsShared.join(", ").replaceAll("_", " ")}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function PlacementPage() {
  return (
    <>
      <PageHeader
        title="Placement readiness"
        description="Students who chose to share with the placement cell, and only the fields they chose."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Readiness />
      </Suspense>
    </>
  );
}
