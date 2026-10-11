"use client";
/** Adds the evidence a quest names: a link the system checks, or a file a named reviewer attests (§6, §8.3). */
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { submitQuestEvidence } from "../actions";

export function EvidenceForm({
  questId,
  mode,
  typeLabel,
}: {
  questId: string;
  mode: "link" | "upload" | "platform" | "reviewer" | undefined;
  typeLabel: string;
}) {
  const [state, action, pending] = useActionState(submitQuestEvidence, null);

  if (mode === "platform" || mode === "reviewer")
    return (
      <p className="mt-5 rounded-2xl bg-sand p-4 text-[0.95rem] text-ink-2">
        {mode === "platform"
          ? `${typeLabel} is recorded by the campus platform when you take the assessment, so there is nothing to upload.`
          : `${typeLabel} is entered by your faculty reviewer once it has been confirmed.`}
      </p>
    );

  return (
    <form action={action} className="mt-5 grid gap-3 rounded-2xl bg-sand p-4">
      <input type="hidden" name="questId" value={questId} />
      {mode === "upload" ? (
        <label className="grid gap-1.5 text-sm font-bold">
          {typeLabel}: attach the file
          <input
            name="file"
            type="file"
            required
            accept="application/pdf,image/png,image/jpeg"
            className="rounded-field border border-line bg-card px-3.5 py-2.5 text-base font-normal file:mr-3 file:rounded-full file:border-0 file:bg-sand-2 file:px-3 file:py-1.5 file:font-bold"
          />
          <span className="font-normal text-ink-2">PDF, PNG or JPG. A named reviewer checks it before it counts.</span>
        </label>
      ) : (
        <label className="grid gap-1.5 text-sm font-bold">
          Link to your evidence
          <input
            name="sourceUrl"
            type="url"
            required
            placeholder="https://"
            className="h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
          />
        </label>
      )}
      <label className="grid gap-1.5 text-sm font-bold">
        A short note for your mentor <span className="font-normal text-ink-2">(optional, up to 1,000 characters)</span>
        <textarea
          name="description"
          maxLength={1000}
          rows={2}
          className="rounded-field border border-line bg-card px-3.5 py-2.5 text-base font-normal"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit evidence"}
        </Button>
        {state ? (
          <output className={cn("text-sm font-semibold", state.ok ? "text-low" : "text-crit")}>{state.message}</output>
        ) : null}
      </div>
    </form>
  );
}
