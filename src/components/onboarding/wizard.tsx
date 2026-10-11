"use client";
/**
 * Six-card onboarding (§12.1): notice → consent choices → baseline check → ambition → evidence → passport.
 * The server keeps the notice acknowledgement and the card the student is on, so a refresh resumes here.
 */
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import {
  acknowledgeNoticeAction,
  completeOnboardingAction,
  moveToCardAction,
  requestRight,
  saveAspiration,
  updateConsent,
} from "@/app/student/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import type { ConsentCategory } from "@/server/db/schema/enums";

const STEPS = ["What we collect", "Who sees it", "Your records", "Your ambition", "Your evidence", "Your passport"];

const RECIPIENT_LABELS: Record<string, string> = {
  placement_officer: "Placement cell",
  ecell_coordinator: "E-Cell",
  sports_officer: "Sports & NCC office",
};

type ConsentState = Record<string, Record<string, boolean>>;

interface Props {
  startStep: number;
  noticeAcknowledged: boolean;
  noticeVersion: string;
  baseline: {
    cgpa: number | null;
    attendance: number | null;
    year: number;
    department: string;
    importedOn: string | null;
  } | null;
  aspiration: {
    track: string | null;
    targetOutcome: string;
    targetDate: string | null;
    readiness: number;
  } | null;
  tracks: { id: string; name: string }[];
  readinessDefault: number;
  consent: ConsentState;
  categories: Record<string, string>;
  recipients: string[];
  evidenceCount: number;
  hasEvaluation: boolean;
}

export function OnboardingWizard(p: Props) {
  const router = useRouter();
  const [step, setStep] = useState(Math.min(p.startStep, STEPS.length - 1));
  const [saved, action, savingAspiration] = useActionState(saveAspiration, null);
  const [correction, setCorrection] = useState<string | null>(null);
  const [acked, setAcked] = useState(p.noticeAcknowledged);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [consent, setConsent] = useOptimistic(
    p.consent,
    (s: ConsentState, u: { c: string; r: string; v: boolean }) => ({
      ...s,
      [u.c]: { ...s[u.c], [u.r]: u.v },
    }),
  );
  const today = new Date().toISOString().slice(0, 10);
  const ambitionSaved = saved?.ok ?? Boolean(p.aspiration);

  const go = (to: number) => {
    setStep(to);
    setProblem(null);
    start(() => moveToCardAction(to));
  };
  const next = () => {
    if (step === 0 && !acked) {
      start(async () => {
        await acknowledgeNoticeAction();
        setAcked(true);
        go(1);
      });
      return;
    }
    if (step === 3 && !ambitionSaved) {
      setProblem("Save your ambition first, so we can score your first passport.");
      return;
    }
    go(Math.min(STEPS.length - 1, step + 1));
  };
  const finish = () =>
    start(async () => {
      const r = await completeOnboardingAction();
      if (!r.ok) return setProblem(r.message);
      router.push("/student/passport");
    });

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
            <span className={cn("hidden text-xs font-bold sm:block", i === step ? "text-ink" : "text-ink-2")}>
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
              suggestion before it reaches you. You can ask to see, correct or erase your data at any time from Sharing.
              (Notice {p.noticeVersion}.)
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="mt-4 grid gap-4">
            <p>
              Your assigned mentor always sees your record. The offices below see nothing until you switch it on, and
              you can change it any time in Sharing.
            </p>
            <ul className="divide-y divide-line">
              {Object.entries(p.categories).map(([c, label]) => (
                <li key={c} className="py-3">
                  <p className="font-semibold">{label}</p>
                  <ul className="mt-1.5 grid gap-1">
                    {p.recipients.map((r) => (
                      <li key={r} className="flex items-center justify-between gap-3">
                        <span className="text-ink-2">{RECIPIENT_LABELS[r] ?? r}</span>
                        <Switch
                          label={`Share ${label} with ${RECIPIENT_LABELS[r] ?? r}`}
                          checked={consent[c]?.[r] ?? false}
                          onChange={(v) =>
                            start(async () => {
                              setConsent({ c, r, v });
                              await updateConsent({
                                category: c as ConsentCategory,
                                recipient: r as "placement_officer",
                                granted: v,
                              });
                            })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4">
            {p.baseline ? (
              <>
                <dl className="tabular grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ["Department", p.baseline.department],
                    ["Year", String(p.baseline.year)],
                    ["CGPA", p.baseline.cgpa?.toFixed(2) ?? "Missing"],
                    ["Attendance", p.baseline.attendance != null ? `${p.baseline.attendance}%` : "Missing"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-2xl bg-sand p-3">
                      <dt className="text-sm text-ink-2">{k}</dt>
                      <dd className="text-lg font-extrabold">{v}</dd>
                    </div>
                  ))}
                </dl>
                {p.baseline.importedOn ? (
                  <p className="mt-3 text-sm text-ink-2">
                    From the university records imported on {p.baseline.importedOn}.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="rounded-2xl bg-mod-bg p-4 font-semibold text-mod">
                We couldn't find your university record yet. Request a correction and the registrar will check it.
              </p>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              disabled={pending || correction !== null}
              onClick={() =>
                start(async () => {
                  const r = await requestRight("correction", "Baseline check during onboarding");
                  setCorrection(r.message);
                })
              }
            >
              {correction ? "Correction requested" : "Something looks wrong? Request a correction"}
            </Button>
            {correction ? <output className="mt-2 block text-sm font-semibold text-low">{correction}</output> : null}
          </div>
        )}

        {step === 3 && (
          <form action={action} className="mt-4 grid gap-4">
            <label className="grid gap-1.5 text-sm font-bold">
              Track
              <select
                name="track"
                defaultValue={p.aspiration?.track ?? ""}
                required
                className="h-11 rounded-field border border-line bg-card px-3 text-base font-normal"
              >
                <option value="" disabled>
                  Choose a track
                </option>
                {p.tracks.map((t) => (
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
                defaultValue={p.aspiration?.targetOutcome ?? ""}
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
                  defaultValue={p.aspiration?.targetDate ?? ""}
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
                  defaultValue={p.aspiration?.readiness ?? p.readinessDefault}
                  className="tabular h-11 rounded-field border border-line bg-card px-3.5 text-base font-normal"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={savingAspiration}>
                {savingAspiration ? "Saving…" : ambitionSaved ? "Save changes" : "Save ambition"}
              </Button>
              {saved ? (
                <output className={cn("text-sm font-semibold", saved.ok ? "text-low" : "text-crit")}>
                  {saved.message}
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
            <p className="text-ink-2">
              {p.evidenceCount > 0
                ? `You've added ${p.evidenceCount} ${p.evidenceCount === 1 ? "item" : "items"} so far.`
                : "You can skip this now. Your first passport shows what to add."}
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
            {problem ? (
              <p role="alert" className="text-sm font-semibold text-crit">
                {problem}
              </p>
            ) : null}
            <Button className="w-fit" disabled={pending} onClick={finish}>
              {pending ? "Opening…" : "Open my passport"}
            </Button>
          </div>
        )}

        {step !== 5 && problem ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-crit">
            {problem}
          </p>
        ) : null}

        <div className="mt-8 flex justify-between border-t border-line pt-5">
          <Button variant="ghost" onClick={() => go(Math.max(0, step - 1))} disabled={step === 0 || pending}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={pending}>
              {step === 0 && !acked ? "I understand" : "Continue"}
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
