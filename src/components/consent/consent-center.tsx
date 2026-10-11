"use client";
import { useOptimistic, useTransition } from "react";
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

export function ConsentCenter({
  state,
  categories,
  recipients,
  leaderboard,
}: {
  state: State;
  categories: Record<string, string>;
  recipients: string[];
  leaderboard: boolean;
}) {
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
          <CardHeader title="Your data rights" hint="Requests go to the compliance officer with a response deadline." />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => start(() => requestRight("access"))}
            >
              Download my data
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => start(() => requestRight("correction"))}
            >
              Request a correction
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => start(() => requestRight("erasure"))}>
              Request erasure
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
