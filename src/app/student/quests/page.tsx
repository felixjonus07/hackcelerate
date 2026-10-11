import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/shell/app-shell";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { score1, shortDate } from "@/lib/format";
import { requireStudent } from "@/server/auth/session";
import { getPassport, type PassportData } from "@/server/services/passport";
import { EvidenceForm } from "./evidence-form";
import { QuestActions } from "./quest-actions";

export const metadata: Metadata = { title: "Quests" };

const STATUS: Record<string, string> = {
  PROPOSED: "Proposed",
  ACCEPTED: "Accepted",
  ACTIVE: "Active",
  EVIDENCE_SUBMITTED: "Evidence submitted",
  DONE: "Done",
  EXPIRED: "Passed its date",
};

type Quest = PassportData["quests"][number] | PassportData["expiredQuests"][number];

function QuestCard({ q, data }: { q: Quest; data: PassportData }) {
  const spec = data.evidenceTypes[q.requiredEvidenceType];
  const deferred = q.status === "PROPOSED" && q.deferredUntil != null && q.deferredUntil > new Date();
  const impact = "impact" in q ? q.impact : null;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold">{q.title}</h2>
          <p className="mt-1 max-w-[60ch] text-ink-2">{q.action}</p>
        </div>
        <Tag kind={q.status === "DONE" ? "low" : q.status === "EXPIRED" ? "mod" : "neutral"}>
          {STATUS[q.status] ?? q.status}
        </Tag>
      </div>
      <p className="mt-3 text-sm text-ink-2">
        {q.targetDays} days
        {q.dueAt && q.status !== "DONE" ? <> · due {shortDate(q.dueAt)}</> : null}
        {impact != null && impact > 0.05 ? (
          <>
            {" "}
            · worth about <strong className="tabular text-ink">{score1(impact)} points</strong>
          </>
        ) : null}
        {" · "}completes with: {spec?.label ?? q.requiredEvidenceType.replaceAll("_", " ")}
      </p>
      {deferred ? (
        <p className="mt-2 text-sm font-semibold text-ink-2">
          Put off until {q.deferredUntil ? shortDate(q.deferredUntil) : ""}. You can still accept it now.
        </p>
      ) : null}
      {q.statusNote ? <p className="mt-2 text-sm font-semibold text-mod">{q.statusNote}</p> : null}
      {q.status === "EVIDENCE_SUBMITTED" ? (
        <p className="mt-3 text-sm text-ink-2">Your evidence is being checked. The quest completes when it counts.</p>
      ) : null}
      {q.status === "EXPIRED" ? (
        <p className="mt-3 text-sm text-ink-2">
          The date passed without the evidence. That is not held against you; your mentor has been asked to follow up.
        </p>
      ) : null}
      {q.status !== "DONE" && q.status !== "EVIDENCE_SUBMITTED" ? (
        <QuestActions
          questId={q.id}
          status={q.status}
          targetDays={q.targetDays}
          daysRange={data.targetDaysRange as [number, number]}
          deferred={deferred}
        />
      ) : null}
      {q.status === "ACCEPTED" || q.status === "ACTIVE" ? (
        <EvidenceForm
          questId={q.id}
          mode={spec?.mode}
          typeLabel={spec?.label ?? q.requiredEvidenceType.replaceAll("_", " ")}
        />
      ) : null}
    </Card>
  );
}

async function Quests() {
  const { student, user } = await requireStudent();
  const data = await getPassport(student.id, user);
  const { quests, expiredQuests, evidence } = data;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="grid content-start gap-4">
        {quests.length === 0 && expiredQuests.length === 0 ? (
          <Card>
            <EmptyState title="No quests yet">
              After your next evaluation, your mentor approves up to three concrete steps. They'll appear here.
            </EmptyState>
          </Card>
        ) : (
          [...quests, ...expiredQuests].map((q) => <QuestCard key={q.id} q={q} data={data} />)
        )}
      </div>
      <Card className="self-start">
        <h2 className="font-extrabold">Your evidence</h2>
        <p className="text-sm text-ink-2">Verified items count at full weight; self-reported items at half.</p>
        {evidence.length ? (
          <ul className="mt-3 divide-y divide-line">
            {evidence.map((e) => (
              <li key={e.id} className="grid gap-1 py-3">
                <span className="font-semibold">{e.label}</span>
                <EvidenceChip status={e.status} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-2">Nothing added yet. Each quest tells you what to add.</p>
        )}
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
