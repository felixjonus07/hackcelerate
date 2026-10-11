"use client";
/** The buttons a quest offers at its current stage (§8.3, §12.1). Each one reports what happened in words. */
import { useState, useTransition } from "react";
import { acceptQuest, deferQuest, editQuestDays, reopenQuest, startQuest } from "@/app/student/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Result = { ok: boolean; message: string };

export function QuestActions({
  questId,
  status,
  targetDays,
  daysRange,
  deferred,
}: {
  questId: string;
  status: string;
  targetDays: number;
  daysRange: [number, number];
  deferred: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState(targetDays);
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      setResult(await fn());
      setEditing(false);
    });

  const canEdit = status === "PROPOSED" || status === "ACCEPTED" || status === "ACTIVE";
  return (
    <div className="mt-5 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {status === "PROPOSED" ? (
          <>
            <Button disabled={pending} onClick={() => run(() => acceptQuest(questId))}>
              Accept
            </Button>
            {deferred ? null : (
              <Button variant="secondary" disabled={pending} onClick={() => run(() => deferQuest(questId))}>
                Not now
              </Button>
            )}
          </>
        ) : null}
        {status === "ACCEPTED" ? (
          <Button variant="secondary" disabled={pending} onClick={() => run(() => startQuest(questId))}>
            Mark as started
          </Button>
        ) : null}
        {status === "EXPIRED" ? (
          <Button disabled={pending} onClick={() => run(() => reopenQuest(questId))}>
            Pick it up again
          </Button>
        ) : null}
        {canEdit && !editing ? (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(true)}>
            Change the days
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-sm font-bold">
            Days to finish
            <input
              type="number"
              min={daysRange[0]}
              max={daysRange[1]}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="tabular h-11 w-28 rounded-field border border-line bg-card px-3.5 text-base font-normal"
            />
          </label>
          <Button size="sm" disabled={pending} onClick={() => run(() => editQuestDays(questId, days))}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <p className="basis-full text-sm text-ink-2">
            Between {daysRange[0]} and {daysRange[1]} days.
          </p>
        </div>
      ) : null}
      {result ? (
        <output className={cn("text-sm font-semibold", result.ok ? "text-low" : "text-crit")}>{result.message}</output>
      ) : null}
    </div>
  );
}
