"use client";
import { Download, FilePenLine, Info, Trash2 } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { requestRight, setLeaderboardVisibility, updateConsent } from "@/app/student/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tag } from "@/components/ui/tag";
import type { ConsentCategory } from "@/server/db/schema/enums";
import type { getStudentRightsRequests } from "@/server/services/rights";

const RECIPIENT_LABELS: Record<string, string> = {
  placement_officer: "Placement cell",
  ecell_coordinator: "E-Cell",
  sports_officer: "Sports & NCC office",
};

type State = Record<string, Record<string, boolean>>;

type RightsRequestItem = Awaited<ReturnType<typeof getStudentRightsRequests>>[number];

export function ConsentCenter({
  state,
  categories,
  recipients,
  leaderboard,
  rightsRequestsList = [],
}: {
  state: State;
  categories: Record<string, string>;
  recipients: string[];
  leaderboard: boolean;
  rightsRequestsList?: RightsRequestItem[];
}) {
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(state, (s: State, u: { c: string; r: string; v: boolean }) => ({
    ...s,
    [u.c]: { ...s[u.c], [u.r]: u.v },
  }));
  const [lb, setLb] = useOptimistic(leaderboard);
  const [correctionNote, setCorrectionNote] = useState("");
  const [showCorrectionForm, setShowCorrectionForm] = useState(false);
  const [showErasureConfirm, setShowErasureConfirm] = useState(false);

  const toggle = (c: string, r: string, v: boolean) =>
    start(async () => {
      setOptimistic({ c, r, v });
      await updateConsent({
        category: c as ConsentCategory,
        recipient: r as (typeof recipients)[number] as "placement_officer",
        granted: v,
      });
    });

  const handleCorrectionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionNote.trim()) return;
    start(async () => {
      await requestRight("correction", correctionNote.trim());
      setCorrectionNote("");
      setShowCorrectionForm(false);
    });
  };

  const handleErasureSubmit = () => {
    start(async () => {
      await requestRight("erasure", "Student requested account erasure against retention schedule");
      setShowErasureConfirm(false);
    });
  };

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
            <div>
              <p className="font-semibold">Show me on my track's leaderboard</p>
              <p className="text-xs text-ink-2">
                Displays your pseudonymous score and verified projects on leaderboard tabs.
              </p>
            </div>
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
          <CardHeader title="Your data rights" hint="Statutory rights under India DPDP Act 2023 (§13.7)." />
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/v1/students/me/export"
              download
              className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-sand-2 px-4 text-sm font-bold text-ink hover:bg-sand-3"
            >
              <Download aria-hidden className="size-4" />
              Download my data
            </a>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setShowCorrectionForm((s) => !s)}>
              <FilePenLine aria-hidden className="size-4" />
              Request a correction
            </Button>
            <Button variant="danger" size="sm" disabled={pending} onClick={() => setShowErasureConfirm((s) => !s)}>
              <Trash2 aria-hidden className="size-4" />
              Request erasure
            </Button>
          </div>

          {showCorrectionForm && (
            <form onSubmit={handleCorrectionSubmit} className="mt-4 grid gap-2 rounded-2xl bg-sand p-3.5">
              <label className="text-xs font-bold text-ink">
                What would you like corrected?
                <input
                  type="text"
                  required
                  placeholder="e.g. CGPA update, attendance record, or name spelling"
                  value={correctionNote}
                  onChange={(e) => setCorrectionNote(e.target.value)}
                  className="mt-1 h-9 w-full rounded-field border border-line bg-card px-3 text-sm font-normal"
                />
              </label>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={pending}>
                  Submit request
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCorrectionForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {showErasureConfirm && (
            <div className="mt-4 rounded-2xl bg-sand p-3.5 text-xs text-ink-2">
              <p className="font-bold text-ink text-sm">Retention Schedule Notice (§13.5)</p>
              <p className="mt-1">
                Academic baseline, official degrees, and audit logs are retained for a minimum of 5 years post-degree
                per statutory university guidelines. Self-reported links and elective aspirations are erased within 30
                days.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <Button variant="danger" size="sm" disabled={pending} onClick={handleErasureSubmit}>
                  Confirm erasure request
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowErasureConfirm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {rightsRequestsList.length > 0 && (
        <Card>
          <CardHeader
            title="Request history"
            hint="Requests logged under DPDP Act 2023 with a 30-day statutory response SLA."
          />
          <ul className="divide-y divide-line">
            {rightsRequestsList.map((req) => (
              <li key={req.id} className="grid gap-1 py-3 text-sm sm:flex sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold capitalize text-ink">{req.kind} request</span>
                    <Tag kind={req.status === "COMPLETED" ? "low" : "mod"}>{req.status}</Tag>
                  </div>
                  {req.detail && <p className="text-ink-2 text-xs mt-0.5">{req.detail}</p>}
                  {req.resolution && (
                    <p className="text-xs text-ink-2 mt-0.5">
                      <Info aria-hidden className="inline mr-1 size-3.5 text-mod align-text-bottom" />
                      {req.resolution}
                    </p>
                  )}
                </div>
                <div className="text-xs text-ink-2 shrink-0">
                  {req.dueAt ? `SLA: ${new Date(req.dueAt).toLocaleDateString()}` : "Logged"}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
