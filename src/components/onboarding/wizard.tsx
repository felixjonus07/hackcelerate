"use client";
/** Six-card onboarding (§12.1): notice → consent → baseline → ambition → evidence → passport. */
import { Check } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { requestRight, saveAspiration } from "@/app/student/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

const STEPS = ["What we collect", "Who sees it", "Your records", "Your ambition", "Your evidence", "Your passport"];

interface Props {
  baseline: {
    cgpa: number | null;
    attendance: number | null;
    year: number;
    department: string;
  } | null;
  aspiration: {
    track: string | null;
    targetOutcome: string;
    targetDate: string | null;
    readiness: number;
  } | null;
  tracks: { id: string; name: string }[];
  readinessDefault: number;
}

export function OnboardingWizard({ baseline, aspiration, tracks, readinessDefault }: Props) {
  const [step, setStep] = useState(0);
  const [state, action, pending] = useActionState(saveAspiration, null);
  const [correction, setCorrection] = useState(false);
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-[720px]">
      <ol aria-label="Setup progress" className="mb-6 grid grid-cols-6 gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label} className="grid gap-2" aria-current={i === step ? "step" : undefined}>
            <span className="sr-only">{`Step ${i + 1} of ${STEPS.length}: `}</span>
            <span
              aria-hidden
              className={cn("h-1.5 rounded-full transition-colors", i <= step ? "bg-act" : "bg-sand-3")}
            />
            <span
              className={cn("hidden text-xs font-bold sm:block", i === step ? "text-ink" : "text-ink-2")}
              aria-current={i === step ? "step" : undefined}
            >
              {label}
            </span>
          </li>
        ))}
      </ol>

      <Card>
        <h1 className="text-[1.6rem] font-black leading-tight">{STEPS[step]}</h1>

        {step === 0 && (
          <div className="mt-4 grid gap-3 text-[0.98rem]">
            <p>
              AspirEdge helps you see how close you are to your goal and what the next step is. To do that it reads:
            </p>
            <ul className="grid gap-2">
              {[
                "Your CGPA and attendance from the university records",
                "Your results on the campus test platform",
                "Links, certificates and internship records you add yourself",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <Check aria-hidden className="mt-1 size-4 shrink-0 text-low" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="text-ink-2">
              Nothing is collected on this screen. Your score is calculated by fixed rules, and a mentor approves every
              suggestion before it reaches you.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="mt-4 grid gap-3">
            <p>
              By default only your assigned mentor sees your record. The placement cell, E-Cell and sports office see
              nothing until you switch it on.
            </p>
            <p className="text-ink-2">
              You can change this any time in{" "}
              <Link href="/student/consent" className="font-bold text-act underline">
                Sharing
              </Link>
              .
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4">
            {baseline ? (
              <dl className="tabular grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Department", baseline.department],
                  ["Year", String(baseline.year)],
                  ["CGPA", baseline.cgpa?.toFixed(2) ?? "Missing"],
                  ["Attendance", baseline.attendance != null ? `${baseline.attendance}%` : "Missing"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-sand p-3">
                    <dt className="text-sm text-ink-2">{k}</dt>
                    <dd className="text-lg font-extrabold">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="rounded-2xl bg-mod-bg p-4 font-semibold text-mod">
                We couldn't find your university record yet. Request a correction and the registrar will check it.
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-4"
              disabled={correction}
              onClick={() =>
                requestRight("correction", "Baseline check during onboarding").then(() => setCorrection(true))
              }
            >
              {correction ? "Correction requested" : "Something looks wrong? Request a correction"}
            </Button>
          </div>
        )}

        {step === 3 && (
          <form action={action} className="mt-4 grid gap-4">
            <label className="grid gap-1.5 text-sm font-bold">
              Track
              <select
                name="track"
                defaultValue={aspiration?.track ?? ""}
                required
                className="h-11 rounded-field border border-line bg-card px-3 text-base font-normal"
              >
                <option value="" disabled>
                  Choose a track
                </option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-bold">
              Target outcome
              <input
                name="targetOutcome"
                required
                minLength={3}
                maxLength={200}
                defaultValue={aspiration?.targetOutcome ?? ""}
                placeholder="For example: an offer from a core mechanical employer"
                className="h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-bold">
                Target date
                <input
                  name="targetDate"
                  type="date"
                  min={today}
                  required
                  defaultValue={aspiration?.targetDate ?? ""}
                  className="h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-bold">
                Readiness level <span className="font-normal text-ink-2">(score you're aiming for)</span>
                <input
                  name="readiness"
                  type="number"
                  min={40}
                  max={100}
                  defaultValue={aspiration?.readiness ?? readinessDefault}
                  className="tabular h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save ambition"}
              </Button>
              {state ? (
                <output className={cn("text-sm font-semibold", state.ok ? "text-low" : "text-crit")}>
                  {state.message}
                </output>
              ) : null}
            </div>
          </form>
        )}

        {step === 4 && (
          <div className="mt-4 grid gap-3">
            <p>
              Add links to your work, certificates and internship letters. Each item shows its status as it's checked:
              verified items count at full weight.
            </p>
            <ButtonLink href="/student/quests" variant="secondary" className="w-fit">
              Add evidence
            </ButtonLink>
          </div>
        )}

        {step === 5 && (
          <div className="mt-4 grid gap-3">
            <p>
              Your passport shows your score, the gap to your target and up to three suggested quests. Accept, edit or
              put off each one.
            </p>
            <ButtonLink href="/student/passport" className="w-fit">
              Open my passport
            </ButtonLink>
          </div>
        )}

        <div className="mt-8 flex justify-between border-t border-line pt-5">
          <Button variant="ghost" onClick={back} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 ? <Button onClick={next}>{step === 0 ? "I understand" : "Continue"}</Button> : null}
        </div>
      </Card>
    </div>
  );
}
