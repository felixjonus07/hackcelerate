import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { ReviewForm } from "@/components/staff/review-form";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { dateTime } from "@/lib/format";
import { APPROVER_ROLES } from "@/server/auth/roles";
import { requireUser } from "@/server/auth/session";
import { reviewQueue } from "@/server/services/review-queue";

export const metadata: Metadata = { title: "Evidence review" };

const KIND_LABEL = {
  artifact: "Certificate or letter",
  internship: "Internship",
  mock: "Score report check",
  flag: "Second look",
} as const;

async function Queue() {
  const user = await requireUser(APPROVER_ROLES);
  const items = await reviewQueue(user);
  if (!items.length)
    return (
      <Card>
        <EmptyState title="Nothing waiting for review">
          Uploaded certificates, internship letters and sampled score reports for your students appear here.
        </EmptyState>
      </Card>
    );
  return (
    <ul className="grid gap-4">
      {items.map((i) => (
        <li key={`${i.kind}-${i.id}`}>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold">{i.title}</h2>
                <p className="text-sm text-ink-2">
                  {i.handle} · sent {dateTime(i.at)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tag>{KIND_LABEL[i.kind]}</Tag>
                <EvidenceChip status={i.status} />
              </div>
            </div>
            <p className="mt-3 max-w-[70ch] text-[0.95rem]">{i.detail}</p>
            {i.hasFile ? (
              <a
                href={`/api/v1/evidence/${i.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-act hover:underline"
              >
                <FileText aria-hidden className="size-4" /> Open the file (link expires shortly; the view is logged)
              </a>
            ) : null}
            <div className="mt-5 border-t border-line pt-5">
              <ReviewForm kind={i.kind} id={i.id} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function EvidencePage() {
  return (
    <>
      <PageHeader
        title="Evidence review"
        description="Attesting or rejecting names you as the reviewer. Nothing counts in full until a named person has checked it."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Queue />
      </Suspense>
    </>
  );
}
