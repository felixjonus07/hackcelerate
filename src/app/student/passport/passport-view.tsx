import { ChevronRight, LifeBuoy, Plus } from "lucide-react";
import Link from "next/link";
import { ReadinessBar } from "@/components/passport/readiness-bar";
import { PageHeader } from "@/components/shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { GapTag, Tag } from "@/components/ui/tag";
import { firstName, score1 } from "@/lib/format";
import { CONFIDENCE_NOTE, type GapLevel, stripRefs, TREND_STUDENT } from "@/lib/labels";
import type { PassportData } from "@/server/services/passport";
import { acceptQuest } from "../actions";

export function PassportView({ data }: { data: PassportData }) {
  const { evaluation: ev, quests, evidence } = data;
  const name = firstName(data.displayName);

  if (!ev) {
    return (
      <>
        <PageHeader title={`Hi ${name}, let's set up your passport`} />
        <Card>
          <EmptyState
            title="We need two more pieces of evidence to score you"
            action={<ButtonLink href="/student/onboarding">Continue setup</ButtonLink>}
          >
            Add your ambition and at least one piece of evidence. Your first score appears right after.
          </EmptyState>
        </Card>
      </>
    );
  }

  const result = ev.result;
  const next = quests.find((q) => q.status === "PROPOSED" || q.status === "ACCEPTED" || q.status === "ACTIVE");
  const gaps = result.trackScore.dataGaps;
  const summary = ev.narrative?.risk_summary ? stripRefs(ev.narrative.risk_summary) : null;

  return (
    <>
      <PageHeader
        title={`Hi ${name}, here's where you stand`}
        description={data.aspiration?.targetOutcome ? `Aiming for: ${data.aspiration.targetOutcome}` : undefined}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card aria-labelledby="score-h">
          <p id="score-h" className="text-sm font-bold text-ink-2">
            {data.trackName} · track score
          </p>
          {result?.trackScore?.gateFailed ? (
            <div className="mt-3">
              <p className="text-2xl font-black text-ink">{result.trackScore.gateFailed}</p>
              <p className="mt-2 text-sm text-ink-2">
                A track gate prerequisite is not met yet. Meet the requirement to reveal your score.
              </p>
            </div>
          ) : (
            <>
              <p className="tabular mt-1 text-[3.5rem] font-black leading-none tracking-tight">
                {score1(ev.trackScore)}
              </p>
              <ReadinessBar score={ev.trackScore} readiness={ev.readiness} />
            </>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-ink-2">
            <span>
              Your target readiness is <strong className="tabular text-ink">{ev.readiness}</strong>.
            </span>
            <GapTag level={ev.aegIndex as GapLevel} />
          </div>
          <p className="mt-3 text-sm text-ink-2">{TREND_STUDENT[ev.trend]}</p>
          {summary ? <p className="mt-4 border-t border-line pt-4 text-[0.95rem]">{summary}</p> : null}
        </Card>

        <Card aria-labelledby="next-h" className="flex flex-col">
          {next ? (
            <>
              <h2 id="next-h" className="text-[1.45rem] font-extrabold leading-snug">
                <span className="text-ink-2">Next: </span>
                {next.title}
              </h2>
              <p className="mt-1.5 max-w-[52ch] text-ink-2">
                {next.impact != null && next.impact > 0.05 ? (
                  <>
                    Worth about <strong className="tabular text-ink">{score1(next.impact)} points</strong> on your
                    track.{" "}
                  </>
                ) : null}
                {next.action}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
                {next.status === "PROPOSED" ? (
                  <form action={acceptQuest.bind(null, next.id)}>
                    <button
                      type="submit"
                      className="press inline-flex h-11 items-center rounded-full bg-act px-5 font-bold text-act-ink shadow-[0_6px_16px_-8px_var(--act)] hover:bg-act-hover"
                    >
                      Start quest
                    </button>
                  </form>
                ) : (
                  <ButtonLink href="/student/quests">Add evidence</ButtonLink>
                )}
                <Tag>{next.targetDays} days</Tag>
              </div>
            </>
          ) : (
            <EmptyState title="Your next step appears here">
              Your mentor proposes new steps after each evaluation.
            </EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Quests"
            action={
              <Link href="/student/quests" className="text-sm font-bold text-act hover:underline">
                See all
              </Link>
            }
          />
          {quests.length ? (
            <ul className="divide-y divide-line">
              {quests.slice(0, 4).map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 truncate">{q.title}</span>
                  <Tag kind={q.status === "DONE" ? "low" : "neutral"}>
                    {q.status === "DONE" ? "Done" : `${q.targetDays} days`}
                  </Tag>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Quests appear here">Each quest names the evidence that completes it.</EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Evidence"
            action={
              <ButtonLink href="/student/quests" variant="secondary" size="sm">
                <Plus aria-hidden className="size-4" />
                Add
              </ButtonLink>
            }
          />
          {evidence.length ? (
            <ul className="divide-y divide-line">
              {evidence.slice(0, 5).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 truncate">{e.label}</span>
                  <EvidenceChip status={e.status} className="shrink-0" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No evidence yet">
              Add a link, a certificate or an internship record. Verified items count at full weight.
            </EmptyState>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="How your score is built" hint={CONFIDENCE_NOTE[ev.confidence]} />
          {/* Phones: one stacked row per component so every figure stays visible (§12.4). */}
          <ul className="tabular divide-y divide-line md:hidden">
            {result.trackScore.components.map((c) => (
              <li key={c.key} className="py-3">
                <p className="font-semibold">{c.label}</p>
                <p className="mt-0.5 text-[0.95rem] text-ink-2">
                  weight {c.weight} · score {score1(c.score)} · adds{" "}
                  <strong className="text-ink">{score1(c.contribution)}</strong>
                </p>
                <p className="mt-0.5 text-sm text-ink-2">{c.calculation}</p>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <table className="w-full text-left">
              <caption className="sr-only">Score components, weights and contributions</caption>
              <thead className="text-sm text-ink-2">
                <tr>
                  <th className="pb-2 font-bold">Component</th>
                  <th className="pb-2 text-right font-bold">Weight</th>
                  <th className="pb-2 text-right font-bold">Score</th>
                  <th className="pb-2 text-right font-bold">Adds</th>
                  <th className="pb-2 pl-6 font-bold">How it's calculated</th>
                </tr>
              </thead>
              <tbody className="tabular divide-y divide-line">
                {result.trackScore.components.map((c) => (
                  <tr key={c.key}>
                    <td className="py-3 font-semibold">{c.label}</td>
                    <td className="py-3 text-right">{c.weight}</td>
                    <td className="py-3 text-right">{score1(c.score)}</td>
                    <td className="py-3 text-right font-bold">{score1(c.contribution)}</td>
                    <td className="max-w-[42ch] py-3 pl-6 text-sm text-ink-2">{c.calculation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {gaps.length ? (
            <div className="mt-5 rounded-2xl bg-sand p-4">
              <p className="font-extrabold">Not yet evidenced</p>
              <ul className="mt-2 grid gap-1.5">
                {gaps.map((g) => (
                  <li key={g}>
                    <Link
                      href="/student/what-if"
                      className="group inline-flex items-center gap-1 text-[0.95rem] hover:text-act"
                    >
                      {g}
                      <ChevronRight aria-hidden className="size-4 text-ink-2 group-hover:text-act" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <footer className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card bg-sand-2 px-5 py-4 text-sm text-ink-2">
        <span className="inline-flex items-center gap-2 font-bold text-ink">
          <LifeBuoy aria-hidden className="size-4" /> Need to talk to someone?
        </span>
        <span>Campus counseling centre: Block A, room 12 (synthetic contact)</span>
        <span>Emergency: 112</span>
        <span>Grievance officer: grievance@aspiredge.example</span>
      </footer>
    </>
  );
}
