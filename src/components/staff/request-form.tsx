"use client";
/** Close a rights request with a written outcome the student will read (§13.7). */
import { useActionState } from "react";
import { resolveRightsRequest } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function RequestForm({ id, canErase }: { id: string; canErase: boolean }) {
  const [state, action, pending] = useActionState(resolveRightsRequest, null);
  if (state?.ok) return <output className="text-sm font-semibold text-low">{state.message}</output>;
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="grid gap-1.5 text-sm font-bold">
        {canErase ? "Note to the student (the erasure outcome is written for you)" : "Outcome the student will read"}
        <textarea
          name="outcome"
          rows={2}
          maxLength={1000}
          required={!canErase}
          className="rounded-field border border-line bg-card px-3.5 py-2.5 text-base font-normal"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {canErase ? (
          <Button type="submit" name="erase" value="yes" variant="danger" disabled={pending}>
            Carry out the erasure plan
          </Button>
        ) : (
          <Button type="submit" disabled={pending}>
            Close request
          </Button>
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
