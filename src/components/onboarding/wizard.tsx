"use client";
/** Six-card onboarding (§12.1): notice → consent → baseline → ambition → evidence → passport. */
import { Check, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import {
  acknowledgeNotice,
  requestRight,
  saveAspiration,
  submitGeneralEvidence,
  updateConsent,
} from "@/app/student/actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import type { ConsentCategory } from "@/server/db/schema/enums";

const STEPS = ["What we collect", "Who sees it", "Your records", "Your ambition", "Your evidence", "Your passport"];

const RECIPIENT_LABELS: Record<string, { title: string; desc: string }> = {
  placement_officer: {
    title: "Placement cell",
    desc: "Share verified projects and academic baseline for campus placement drives.",
  },
  ecell_coordinator: {
    title: "E-Cell coordinator",
    desc: "Share startup ideas, pitch decks and incubation milestones.",
  },
  sports_officer: {
    title: "Sports & NCC office",
    desc: "Share competition records, attendance attestations and athletic medals.",
  },
};

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
  initialConsents?: Record<string, Record<string, boolean>>;
  categories?: Record<string, string>;
  recipients?: string[];
}

export function OnboardingWizard({
  baseline,
  aspiration,
  tracks,
  readinessDefault,
  initialConsents = {},
  recipients = ["placement_officer", "ecell_coordinator", "sports_officer"],
}: Props) {
  const [step, setStep] = useState(0);
  const [state, action, pending] = useActionState(saveAspiration, null);
  const [evidenceState, evidenceAction, evidencePending] = useActionState(submitGeneralEvidence, null);
  const [correction, setCorrection] = useState(false);
  const [consentPending, startConsent] = useTransition();

  const [consents, setConsents] = useOptimistic(
    initialConsents,
    (curr: Record<string, Record<string, boolean>>, update: { c: string; r: string; v: boolean }) => ({
      ...curr,
      [update.c]: { ...curr[update.c], [update.r]: update.v },
    }),
  );

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));
  const today = new Date().toISOString().slice(0, 10);

  const handleNoticeAck = async () => {
    try {
      await acknowledgeNotice();
    } catch {
      // optimistic advance
    }
    next();
  };

  const toggleRecipientConsent = (recipientRole: string, granted: boolean) => {
    startConsent(async () => {
      // Toggle key academic categories for this recipient
      const categoriesToToggle: ConsentCategory[] = ["academic_baseline", "artifacts_evidence"];
      for (const cat of categoriesToToggle) {
        setConsents({ c: cat, r: recipientRole, v: granted });
        await updateConsent({
          category: cat,
          recipient: recipientRole as "placement_officer",
          granted,
        });
      }
    });
  };

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
          <div className="mt-4 grid gap-4">
            <p className="text-[0.98rem]">
              By default only your assigned mentor sees your record. You can grant access to specific offices below, and
              change your choices at any time in{" "}
              <Link href="/student/consent" className="font-bold text-act underline">
                Sharing
              </Link>
              .
            </p>

            <div className="grid gap-3">
              {recipients.map((r) => {
                const info = RECIPIENT_LABELS[r] ?? { title: r, desc: `Share records with ${r}` };
                const isShared = Boolean(consents.academic_baseline?.[r] || consents.artifacts_evidence?.[r]);
                return (
                  <div
                    key={r}
                    className="flex items-center justify-between gap-4 rounded-2xl bg-sand p-4 transition-colors"
                  >
                    <div>
                      <p className="font-extrabold">{info.title}</p>
                      <p className="text-sm text-ink-2">{info.desc}</p>
                    </div>
                    <Switch
                      label={`Share with ${info.title}`}
                      checked={isShared}
                      pending={consentPending}
                      onChange={(v) => toggleRecipientConsent(r, v)}
                    />
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-ink-2">
              <ShieldCheck aria-hidden className="inline mr-1 size-4 text-low align-text-bottom" />
              Mentor access is always active as part of academic guidance. Support flags are never shared with employers
              or external offices.
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
              {state?.ok ? (
                <div className="flex items-center gap-3">
                  <output className="text-sm font-semibold text-low">{state.message}</output>
                  <Button type="button" size="sm" onClick={next}>
                    Continue to evidence
                  </Button>
                </div>
              ) : state ? (
                <output className="text-sm font-semibold text-crit">{state.message}</output>
              ) : null}
            </div>
          </form>
        )}

        {step === 4 && (
          <div className="mt-4 grid gap-4">
            <p className="text-[0.98rem]">
              Add links to your work, certificates, repositories or internship letters. Verified items count at full
              weight; self-reported items at half.
            </p>

            <form action={evidenceAction} className="grid gap-3 rounded-2xl bg-sand p-4">
              <p className="font-extrabold text-sm">Add initial evidence</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-bold">
                  Evidence title
                  <input
                    name="label"
                    required
                    minLength={3}
                    maxLength={200}
                    placeholder="e.g. GitHub Robotics Repo, CAD Certificate"
                    className="h-10 rounded-field border border-line bg-card px-3 text-sm font-normal"
                  />
                </label>
                <label className="grid gap-1 text-sm font-bold">
                  Type
                  <select
                    name="type"
                    defaultValue="portfolio"
                    className="h-10 rounded-field border border-line bg-card px-3 text-sm font-normal"
                  >
                    <option value="repository">Repository / Code (GitHub)</option>
                    <option value="doi">Publication / DOI</option>
                    <option value="portfolio">Portfolio project</option>
                    <option value="certificate">Course certificate</option>
                    <option value="letter">Internship letter</option>
                  </select>
                </label>
              </div>
              <label className="grid gap-1 text-sm font-bold">
                Source link (HTTPS)
                <input
                  name="sourceUrl"
                  type="url"
                  required
                  placeholder="https://github.com/... or https://..."
                  className="h-10 rounded-field border border-line bg-card px-3 text-sm font-normal"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button type="submit" size="sm" disabled={evidencePending}>
                  {evidencePending ? "Submitting…" : "Submit evidence"}
                </Button>
                {evidenceState ? (
                  <output className={cn("text-sm font-semibold", evidenceState.ok ? "text-low" : "text-crit")}>
                    {evidenceState.message}
                  </output>
                ) : null}
              </div>
            </form>

            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/student/quests" variant="secondary" className="w-fit">
                View suggested quests
              </ButtonLink>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="mt-4 grid gap-3">
            <p className="text-[0.98rem]">
              Setup complete! Your ambition is recorded, baseline verified, and your initial passport score has been
              calculated according to fixed institutional policy.
            </p>
            <p className="text-ink-2 text-sm">
              Your mentor will review your profile and propose actionable next steps tailored to your career track.
            </p>
            <div className="pt-2">
              <ButtonLink href="/student/passport" className="w-fit">
                Open my passport
              </ButtonLink>
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-between border-t border-line pt-5">
          <Button variant="ghost" onClick={back} disabled={step === 0}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={step === 0 ? handleNoticeAck : next}>{step === 0 ? "I understand" : "Continue"}</Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
