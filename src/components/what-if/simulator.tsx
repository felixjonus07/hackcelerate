"use client";
/**
 * What-if simulator (§12.1, §20.2). Runs the *same* pure rules engine as the
 * official score, in the browser, so every lever updates instantly. It never
 * writes data. Disabled for tracks without a complete rubric (§12.3).
 */
import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ReadinessBar } from "@/components/passport/readiness-bar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/ui/switch";
import { GapTag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { score1 } from "@/lib/format";
import { TRACK_LABELS } from "@/lib/labels";
import type { Policy } from "@/server/policy/schema";
import { evaluate } from "@/server/rules/evaluate";
import type { StudentFacts } from "@/server/rules/types";

const FULL_RUBRIC = new Set(["corporate_placement"]);

export function WhatIfSimulator({ facts, policy }: { facts: StudentFacts; policy: Policy }) {
  const track = facts.aspiration.track ?? "corporate_placement";
  const dept = policy.department_standards[facts.department];
  const baseline = useMemo(() => evaluate(facts, policy), [facts, policy]);

  const initialApt = facts.campusAptitudePercentile ?? 0;
  const lastRatings = facts.ratings.filter((r) => r.kind === "mock_interview").slice(-3);
  const initialRating = lastRatings.length ? lastRatings.reduce((s, r) => s + r.rating, 0) / lastRatings.length : 1;
  const initialHours = facts.verifiedInternshipHours ?? 0;

  const [aptitude, setAptitude] = useState(initialApt);
  const [rating, setRating] = useState(Math.round(initialRating * 2) / 2);
  const [hours, setHours] = useState(initialHours);
  const [verified, setVerified] = useState<Record<string, boolean>>({});

  const sim = useMemo(() => {
    const patched: StudentFacts = {
      ...facts,
      campusAptitudePercentile: aptitude,
      verifiedInternshipHours: hours,
      ratings: [
        ...facts.ratings.filter((r) => r.kind !== "mock_interview"),
        {
          id: "sim-rating",
          kind: "mock_interview",
          date: "9999-12-31",
          rating,
          status: "ATTESTED",
        },
      ],
      evidence: [
        ...facts.evidence,
        ...Object.entries(verified)
          .filter(([, on]) => on)
          .map(([item]) => ({
            id: `sim-${item}`,
            component: "domain_practical_evidence",
            standardItem: item,
            label: item,
            status: "VERIFIED" as const,
          })),
      ],
    };
    return evaluate(patched, policy);
  }, [facts, policy, aptitude, rating, hours, verified]);

  if (!FULL_RUBRIC.has(track)) {
    return (
      <Card>
        <EmptyState title="What-if isn't available for this track yet">
          The {TRACK_LABELS[track]} rubric is still being finalised. Your passport shows your current score and gaps.
        </EmptyState>
      </Card>
    );
  }

  const delta = sim.trackScore.score - baseline.trackScore.score;
  const reset = () => {
    setAptitude(initialApt);
    setRating(Math.round(initialRating * 2) / 2);
    setHours(initialHours);
    setVerified({});
  };
  const missingItems = dept
    ? Object.entries(dept.items).filter(([key]) => {
        const has = facts.evidence.find((e) => e.standardItem === key);
        return !has || has.status !== "VERIFIED";
      })
    : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <Card className="relative">
        {/* Phones: the score stays pinned above the levers so the bar's glide is visible while a slider moves. */}
        <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-5 rounded-t-card border-b border-line bg-card/95 px-5 pb-4 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6 lg:hidden">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-bold text-ink-2">Score with these levers</span>
            <span className="tabular">
              <span className="text-2xl font-black">{score1(sim.trackScore.score)}</span>{" "}
              <span
                className={cn("font-extrabold", delta > 0.05 ? "text-low" : delta < -0.05 ? "text-crit" : "text-ink-2")}
              >
                {delta > 0.05 ? "+" : ""}
                {Math.abs(delta) > 0.05 ? score1(delta) : "±0"}
              </span>
            </span>
          </div>
          <ReadinessBar score={sim.trackScore.score} readiness={sim.readiness} className="mt-5" />
        </div>
        <CardHeader
          title="Levers"
          hint="Each lever uses the official formula for that component."
          action={
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw aria-hidden className="size-4" /> Reset
            </Button>
          }
        />
        <div className="grid gap-6">
          {missingItems.length ? (
            <fieldset>
              <legend className="font-extrabold">Department evidence</legend>
              <p className="text-sm text-ink-2">Switch an item on to see its value once verified.</p>
              <ul className="mt-3 grid gap-2">
                {missingItems.map(([key, item]) => (
                  <li key={key} className="flex items-center justify-between gap-4 rounded-2xl bg-sand px-4 py-3">
                    <span>
                      <span className="font-semibold">{item.label}</span>
                      <span className="ml-2 text-sm text-ink-2">weight {item.weight}</span>
                    </span>
                    <Switch
                      label={`${item.label} verified`}
                      checked={Boolean(verified[key])}
                      onChange={(v) => setVerified((s) => ({ ...s, [key]: v }))}
                    />
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}
          <Slider
            label="Campus aptitude percentile"
            value={aptitude}
            min={0}
            max={100}
            step={1}
            onChange={setAptitude}
            format={(v) => `${v}`}
          />
          <Slider
            label="Average faculty mock interview rating"
            value={rating}
            min={1}
            max={5}
            step={0.5}
            onChange={setRating}
            format={(v) => `${v.toFixed(1)} / 5`}
          />
          <Slider
            label="Verified internship hours"
            value={hours}
            min={0}
            max={200}
            step={10}
            onChange={setHours}
            format={(v) => `${v} h`}
          />
        </div>
      </Card>

      <div className="lg:sticky lg:top-8 lg:self-start">
        <Card aria-live="polite">
          <p className="text-sm font-bold text-ink-2">Score with these levers</p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="tabular text-[3.25rem] font-black leading-none tracking-tight">
              {score1(sim.trackScore.score)}
            </span>
            <span
              className={cn(
                "tabular text-lg font-extrabold",
                delta > 0.05 ? "text-low" : delta < -0.05 ? "text-crit" : "text-ink-2",
              )}
            >
              {delta > 0.05 ? "+" : ""}
              {Math.abs(delta) > 0.05 ? score1(delta) : "±0"}
            </span>
          </div>
          <ReadinessBar score={sim.trackScore.score} readiness={sim.readiness} />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
            <span>
              Target <strong className="tabular text-ink">{sim.readiness}</strong> · now{" "}
              {score1(baseline.trackScore.score)}
            </span>
            <GapTag level={sim.gapIndex} />
          </div>
          <ul className="tabular mt-5 grid gap-2 border-t border-line pt-4 text-sm">
            {sim.trackScore.components.map((c) => (
              <li key={c.key} className="flex justify-between gap-3">
                <span className="text-ink-2">{c.label}</span>
                <span className="font-bold">{score1(c.contribution)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <p className="mt-3 px-2 text-sm text-ink-2">Scenarios are not saved and are never seen by staff.</p>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="grid gap-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-extrabold">{label}</span>
        <output className="tabular whitespace-nowrap rounded-full bg-sand-2 px-2.5 py-0.5 text-sm font-bold">
          {format(value)}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer"
      />
    </label>
  );
}
