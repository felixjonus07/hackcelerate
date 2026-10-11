"use client";
import { useOptimistic, useState, useTransition } from "react";
import { requestRight, setLeaderboardVisibility, updateConsent } from "@/app/student/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ConsentCategory } from "@/server/db/schema/enums";

const RECIPIENT_LABELS: Record<string, string> = {
  placement_officer: "Placement cell",
  ecell_coordinator: "E-Cell",
  sports_officer: "Sports & NCC office",
};

type State = Record<string, Record<string, boolean>>;

export interface RequestRow {
  id: string;
  kind: string;
  status: string;
  createdOn: string;
  dueOn: string | null;
  resolution: string | null;
}

const KIND_LABEL: Record<string, string> = { access: "Data download", correction: "Correction", erasure: "Erasure" };
const STATUS_LABEL: Record<string, string> = {
  OPEN: "Waiting",
  IN_PROGRESS: "Being handled",
  RESOLVED: "Done",
  REJECTED: "Not possible",
};

export function ConsentCenter({
  state,
  categories,
  recipients,
  leaderboard,
  requests,
}: {
  state: State;
  categories: Record<string, string>;
  recipients: string[];
  leaderboard: boolean;
  requests: RequestRow[];
}) {
  const [rights, setRights] = useState<{ ok: boolean; message: string; letter?: string | null; kind: string } | null>(
    null,
  );
  const [confirmErase, setConfirmErase] = useState(false);
  const raise = (kind: "access" | "correction" | "erasure") =>
    start(async () => {
      setRights({ ...(await requestRight(kind)), kind });
      setConfirmErase(false);
    });
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(state, (s: State, u: { c: string; r: string; v: boolean }) => ({
    ...s,
    [u.c]: { ...s[u.c], [u.r]: u.v },
  }));
  const [lb, setLb] = useOptimistic(leaderboard);

  const toggle = (c: string, r: string, v: boolean) =>
    start(async () => {
      setOptimistic({ c, r, v });
      await updateConsent({
        category: c as ConsentCategory,
        recipient: r as (typeof recipients)[number] as "placement_officer",
        granted: v,
      });
    });

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader
          title="Sharing with offices"
          hint="Changes take effect immediately and are recorded in your access history."
        />
        {/* Phones: one block per data category with full-width labelled switches. */}
        <ul className="grid gap-3 sm:hidden">
          {Object.entries(categories).map(([c, label]) => (
            <li key={c} className="rounded-2xl bg-sand p-4">
              <p className="font-extrabold">{label}</p>
              <p className="text-sm text-ink-2">Mentor: always</p>
              <ul className="mt-2 grid gap-1">
                {recipients.map((r) => (
                  <li key={r} className="flex items-center justify-between gap-3 py-1.5">
                    <span>{RECIPIENT_LABELS[r] ?? r}</span>
                    <Switch
                      label={`Share ${label} with ${RECIPIENT_LABELS[r]}`}
                      checked={optimistic[c]?.[r] ?? false}
                      pending={pending}
                      onChange={(v) => toggle(c, r, v)}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block">
          <table className="w-full text-left">
            <caption className="sr-only">Consent by data category and recipient</caption>
            <thead>
              <tr className="text-sm text-ink-2">
                <th className="pb-3 font-bold">What</th>
                <th className="pb-3 text-center font-bold">Mentor</th>
                {recipients.map((r) => (
                  <th key={r} className="pb-3 text-center font-bold">
                    {RECIPIENT_LABELS[r] ?? r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {Object.entries(categories).map(([c, label]) => (
                <tr key={c}>
                  <td className="py-3.5 pr-4 font-semibold">{label}</td>
                  <td className="py-3.5 text-center text-sm font-bold text-ink-2">Always</td>
                  {recipients.map((r) => (
                    <td key={r} className="py-3.5 text-center">
                      <span className="inline-flex">
                        <Switch
                          label={`Share ${label} with ${RECIPIENT_LABELS[r]}`}
                          checked={optimistic[c]?.[r] ?? false}
                          pending={pending}
                          onChange={(v) => toggle(c, r, v)}
                        />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-ink-2">
          Support flags are never shared with employers or recruiters, whatever you choose here.
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Leaderboards" hint="Off unless you switch it on. You can leave at any time." />
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-sand px-4 py-3">
            <span className="font-semibold">Show me on my track's leaderboard</span>
            <Switch
              label="Show me on leaderboards"
              checked={lb}
              onChange={(v) =>
                start(async () => {
                  setLb(v);
                  await setLeaderboardVisibility(v);
                })
              }
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Your data rights" hint="Requests go to the person who can act on them, with a deadline." />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => raise("access")}>
              Download my data
            </Button>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => raise("correction")}>
              Request a correction
            </Button>
            {confirmErase ? (
              <>
                <Button variant="danger" size="sm" disabled={pending} onClick={() => raise("erasure")}>
                  Yes, request erasure
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmErase(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="danger" size="sm" disabled={pending} onClick={() => setConfirmErase(true)}>
                Request erasure
              </Button>
            )}
          </div>
          {rights ? (
            <div className="mt-4 grid gap-2">
              <output className={rights.ok ? "text-sm font-semibold text-low" : "text-sm font-semibold text-crit"}>
                {rights.message}
              </output>
              {rights.ok && rights.kind === "access" ? (
                <a href="/api/v1/students/me/export" download className="w-fit text-sm font-bold text-act underline">
                  Download the export (JSON)
                </a>
              ) : null}
              {rights.letter ? (
                <pre className="whitespace-pre-wrap rounded-2xl bg-sand p-4 font-[inherit] text-[0.9rem]">
                  {rights.letter}
                </pre>
              ) : null}
            </div>
          ) : null}
          {requests.length ? (
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {requests.map((r) => (
                <li key={r.id} className="py-3 text-[0.95rem]">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{KIND_LABEL[r.kind] ?? r.kind}</span>
                    <span className="text-sm text-ink-2">
                      {STATUS_LABEL[r.status] ?? r.status} · asked {r.createdOn}
                      {r.status !== "RESOLVED" && r.dueOn ? ` · reply due ${r.dueOn}` : ""}
                    </span>
                  </p>
                  {r.resolution ? <p className="mt-1 text-sm text-ink-2">{r.resolution}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
