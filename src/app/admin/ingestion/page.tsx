import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { dateTime } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { ingestionRuns } from "@/server/db/schema";

export const metadata: Metadata = { title: "Data imports" };

const STATUS_KIND: Record<string, "low" | "mod" | "crit"> = {
  OK: "low",
  UNCHANGED: "low",
  PARTIAL: "mod",
  FAILED: "crit",
  FILE_MISSING: "crit",
  SCHEMA_ERROR: "crit",
};
const STATUS_LABEL: Record<string, string> = {
  OK: "Imported",
  UNCHANGED: "No changes",
  PARTIAL: "Imported with rejected rows",
  FAILED: "Failed",
  FILE_MISSING: "File missing",
  SCHEMA_ERROR: "Columns did not match",
  RUNNING: "Running",
};

async function Runs() {
  await requireUser(["registrar"]);
  const runs = await db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(20);
  if (!runs.length)
    return (
      <Card>
        <EmptyState title="No imports yet">
          Run <code>npm run erp:import</code> with the university export. Each run is listed here with its checksum and
          any rows it turned away.
        </EmptyState>
      </Card>
    );
  return (
    <ul className="grid gap-4">
      {runs.map((r) => (
        <li key={r.id}>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-extrabold">{r.fileName ?? r.source}</h2>
                <p className="text-sm text-ink-2">
                  {dateTime(r.startedAt)} · {r.source}
                  {r.fileChecksum ? ` · checksum ${r.fileChecksum.slice(0, 12)}` : ""}
                </p>
              </div>
              <Tag kind={STATUS_KIND[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status.toLowerCase()}</Tag>
            </div>
            <p className="tabular mt-3 text-[0.95rem]">
              {r.rowsTotal} rows · <strong>{r.rowsAccepted}</strong> accepted · <strong>{r.rowsRejected}</strong> turned
              away
            </p>
            {r.errors.length ? (
              <ul className="mt-3 list-disc pl-5 text-sm text-ink-2">
                {r.errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {r.errors.length > 8 ? <li>and {r.errors.length - 8} more</li> : null}
              </ul>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function IngestionPage() {
  return (
    <>
      <PageHeader
        title="Data imports"
        description="Each university export that was read: what was accepted, and what was turned away and why."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Runs />
      </Suspense>
    </>
  );
}
