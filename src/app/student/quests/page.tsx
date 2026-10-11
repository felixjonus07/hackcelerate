import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { score1 } from "@/lib/format";
import { requireStudent } from "@/server/auth/session";
import { getPassport } from "@/server/services/passport";
import { acceptQuest, deferQuest } from "../actions";
import { EvidenceForm } from "./evidence-form";

export const metadata: Metadata = { title: "Quests" };

const STATUS: Record<string, string> = {
  PROPOSED: "Proposed",
  ACCEPTED: "Accepted",
  ACTIVE: "Active",
  EVIDENCE_SUBMITTED: "Evidence submitted",
  DONE: "Done",
};

async function Quests() {
  const { student } = await requireStudent();
  const { quests, evidence } = await getPassport(student.id);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="grid content-start gap-4">
        {quests.length === 0 ? (
          <Card>
            <EmptyState title="No quests yet">
              After your next evaluation, your mentor approves up to three concrete steps. They'll appear here.
            </EmptyState>
          </Card>
        ) : (
          quests.map((q) => (
            <Card key={q.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-extrabold">{q.title}</h2>
                  <p className="mt-1 max-w-[60ch] text-ink-2">{q.action}</p>
                </div>
                <Tag kind={q.status === "DONE" ? "low" : "neutral"}>{STATUS[q.status] ?? q.status}</Tag>
              </div>
              <p className="mt-3 text-sm text-ink-2">
                {q.targetDays} days
                {q.impact != null && q.impact > 0.05 ? (
                  <>
                    {" "}
                    · worth about <strong className="tabular text-ink">{score1(q.impact)} points</strong>
                  </>
                ) : null}
                {" · "}completes with: {q.requiredEvidenceType.replaceAll("_", " ")}
              </p>
              {q.status === "PROPOSED" ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <form action={acceptQuest.bind(null, q.id)}>
                    <button
                      type="submit"
                      className="press inline-flex h-11 items-center rounded-full bg-act px-5 font-bold text-act-ink hover:bg-act-hover"
                    >
                      Accept
                    </button>
                  </form>
                  <form action={deferQuest.bind(null, q.id)}>
                    <button
                      type="submit"
                      className="press inline-flex h-11 items-center rounded-full bg-sand-2 px-5 font-bold hover:bg-sand-3"
                    >
                      Not now
                    </button>
                  </form>
                </div>
              ) : q.status === "ACCEPTED" || q.status === "ACTIVE" ? (
                <EvidenceForm questId={q.id} />
              ) : null}
            </Card>
          ))
        )}
      </div>
      <Card className="self-start">
        <h2 className="font-extrabold">Your evidence</h2>
        <p className="text-sm text-ink-2">Verified items count at full weight; self-reported items at half.</p>
        <ul className="mt-3 divide-y divide-line">
          {evidence.map((e) => (
            <li key={e.id} className="grid gap-1 py-3">
              <span className="font-semibold">{e.label}</span>
              <EvidenceChip status={e.status} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function QuestsPage() {
  return (
    <>
      <PageHeader
        title="Quests"
        description="Each quest is one step of your plan. It completes when the evidence it names is in."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Quests />
      </Suspense>
    </>
  );
}
