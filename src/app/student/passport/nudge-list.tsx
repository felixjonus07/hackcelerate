"use client";
/** Wellbeing nudges (§14.2): the pattern in words, support one tap away, and a way to dismiss. */
import { HeartHandshake } from "lucide-react";
import { useTransition } from "react";
import { dismissNudgeAction } from "@/app/student/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NUDGE_TITLE } from "@/lib/labels";

export function NudgeList({
  nudges,
  support,
}: {
  nudges: { id: string; pattern: string; explanation: string }[];
  support: { name: string; phone: string; hours: string };
}) {
  const [pending, start] = useTransition();
  return (
    <Card aria-labelledby="nudge-h" className="lg:col-span-2">
      <h2 id="nudge-h" className="flex items-center gap-2 text-[1.05rem] font-extrabold">
        <HeartHandshake aria-hidden className="size-5 text-ink-2" /> A small check-in
      </h2>
      <ul className="mt-3 divide-y divide-line">
        {nudges.map((n) => (
          <li key={n.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{NUDGE_TITLE[n.pattern] ?? "Something we noticed"}</p>
              <p className="text-[0.95rem] text-ink-2">{n.explanation}</p>
            </div>
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(() => dismissNudgeAction(n.id))}>
              Dismiss
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-ink-2">
        If you'd like to talk to someone, {support.name} is on {support.phone} ({support.hours}). Nothing here is shared
        with employers.
      </p>
    </Card>
  );
}
