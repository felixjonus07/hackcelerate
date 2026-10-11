"use client";
import { useActionState, useState } from "react";
import { decideIntervention } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function DecisionForm({ interventionId, proposed }: { interventionId: string; proposed: string }) {
  const [state, action, pending] = useActionState(decideIntervention, null);
  const [mode, setMode] = useState<"idle" | "edit" | "reject">("idle");

  if (state?.ok)
    return <output className="mt-5 rounded-2xl bg-low-bg px-4 py-3 font-semibold text-low">{state.message}</output>;

  return (
    <form action={action} className="mt-5 grid gap-3 border-t border-line pt-5">
      <input type="hidden" name="interventionId" value={interventionId} />
      {mode === "edit" ? (
        <label className="grid gap-1.5 text-sm font-bold">
          Edit the message before approving
          <textarea
            name="message"
            defaultValue={proposed}
            rows={3}
            maxLength={1000}
            className="rounded-field border border-line bg-card px-3.5 py-2.5 text-base font-normal"
          />
        </label>
      ) : null}
      {mode === "reject" ? (
        <label className="grid gap-1.5 text-sm font-bold">
          Why are you rejecting this?{" "}
          <span className="font-normal text-ink-2">The reason is stored with the record.</span>
          <textarea
            name="note"
            required
            rows={2}
            maxLength={500}
            className="rounded-field border border-line bg-card px-3.5 py-2.5 text-base font-normal"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {mode === "idle" ? (
          <>
            <Button type="submit" name="decision" value="approve" disabled={pending}>
              {pending ? "Saving…" : "Approve"}
            </Button>
            <Button variant="secondary" onClick={() => setMode("edit")}>
              Edit
            </Button>
            <Button variant="danger" onClick={() => setMode("reject")}>
              Reject
            </Button>
          </>
        ) : (
          <>
            <Button
              type="submit"
              name="decision"
              value={mode === "edit" ? "edit_approve" : "reject"}
              variant={mode === "reject" ? "danger" : "primary"}
              disabled={pending}
            >
              {pending ? "Saving…" : mode === "edit" ? "Approve edited message" : "Reject proposal"}
            </Button>
            <Button variant="ghost" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {state && !state.ok ? (
        <p role="alert" className={cn("text-sm font-semibold text-crit")}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
