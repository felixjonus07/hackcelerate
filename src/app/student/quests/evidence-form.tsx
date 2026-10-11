"use client";
import { useActionState } from "react";
import { submitQuestEvidence } from "../actions";

export function EvidenceForm({ questId }: { questId: string }) {
  const [state, action, pending] = useActionState(submitQuestEvidence, null);
  return (
    <form action={action} className="mt-5 grid gap-3 rounded-2xl bg-sand p-4">
      <input type="hidden" name="questId" value={questId} />
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
        <button
          type="submit"
          disabled={pending}
          className="press inline-flex h-11 items-center rounded-full bg-act px-5 font-bold text-act-ink hover:bg-act-hover disabled:opacity-50"
        >
          {pending ? "Submitting…" : "Submit evidence"}
        </button>
        {state ? (
          <output className={state.ok ? "text-sm font-semibold text-low" : "text-sm font-semibold text-crit"}>
            {state.message}
          </output>
        ) : null}
      </div>
    </form>
  );
}
