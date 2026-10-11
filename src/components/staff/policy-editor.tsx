"use client";
/** Draft a new policy version from the one in force (§3.3). The server validates it against the schema. */
import { useActionState, useState, useTransition } from "react";
import { approvePolicy, createPolicyDraft } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function PolicyEditor({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(createPolicyDraft, null);
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5 text-sm font-bold">
        Policy document (JSON)
        <span className="font-normal text-ink-2">
          Start from the version in force. Change <code>policy_version</code> and <code>effective_from</code>, then edit
          the values you need. Nothing takes effect until it is approved.
        </span>
        <textarea
          name="document"
          defaultValue={initial}
          spellCheck={false}
          rows={16}
          className="rounded-field border border-line bg-card px-3.5 py-2.5 font-mono text-[0.82rem] font-normal leading-relaxed"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Save as draft"}
        </Button>
        {state ? (
          <output className={cn("text-sm font-semibold", state.ok ? "text-low" : "text-crit")}>{state.message}</output>
        ) : null}
      </div>
      {state?.issues?.length ? (
        <ul role="alert" className="list-disc pl-5 text-sm text-crit">
          {state.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function ApproveButton({ version }: { version: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="grid gap-1.5">
      <Button size="sm" disabled={pending} onClick={() => start(async () => setMsg(await approvePolicy(version)))}>
        {pending ? "Approving…" : "Approve"}
      </Button>
      {msg ? (
        <output className={cn("text-sm font-semibold", msg.ok ? "text-low" : "text-crit")}>{msg.message}</output>
      ) : null}
    </div>
  );
}
