"use client";
/** A reviewer's decision on one item: a stated reason is required, and it is stored with the record (§6.2). */
import { useActionState } from "react";
import { reviewItem } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const CHOICES = {
  artifact: [
    { value: "attest", label: "Attest", variant: "primary" },
    { value: "reject", label: "Not accepted", variant: "danger" },
  ],
  internship: [
    { value: "attest", label: "Confirmed", variant: "primary" },
    { value: "reject", label: "Not confirmed", variant: "danger" },
  ],
  mock: [
    { value: "MATCH", label: "Matches", variant: "primary" },
    { value: "MISMATCH", label: "Does not match", variant: "danger" },
  ],
  flag: [{ value: "resolve", label: "Resolve", variant: "primary" }],
} as const;

export function ReviewForm({ kind, id }: { kind: keyof typeof CHOICES; id: string }) {
  const [state, action, pending] = useActionState(reviewItem, null);
  if (state?.ok) return <output className="text-sm font-semibold text-low">{state.message}</output>;
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <label className="grid gap-1.5 text-sm font-bold">
        Reason <span className="font-normal text-ink-2">(stored with the record)</span>
        <input
          name="reason"
          required
          maxLength={500}
          className="h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {CHOICES[kind].map((c) => (
          <Button key={c.value} type="submit" name="decision" value={c.value} variant={c.variant} disabled={pending}>
            {c.label}
          </Button>
        ))}
      </div>
      {state && !state.ok ? (
        <p role="alert" className={cn("text-sm font-semibold text-crit")}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
