import { Flame } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, PageHeader } from "@/components/shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EvidenceChip } from "@/components/ui/evidence-chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/cn";
import { score1 } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { getLeaderboardData } from "@/server/services/leaderboard";

export const metadata: Metadata = { title: "Leaderboards" };

async function Boards({ searchParams }: { searchParams: Promise<{ track?: string }> }) {
  const user = await requireUser();
  const { track } = await searchParams;
  const { activeTrack, tracks, entries } = await getLeaderboardData(track);

  return (
    <div>
      <nav aria-label="Career tracks" className="mb-6 flex flex-wrap gap-2">
        {tracks.map((t) => (
          <Link
            key={t.id}
            href={`/leaderboards?track=${t.id}`}
            className={cn(
              "press inline-flex h-10 items-center rounded-full px-5 text-sm font-bold transition-colors",
              t.id === activeTrack ? "bg-act text-act-ink shadow-sm" : "bg-sand-2 text-ink hover:bg-sand-3",
            )}
          >
            {t.name}
          </Link>
        ))}
      </nav>

      {entries.length === 0 ? (
        <Card>
          <EmptyState
            title="No opt-ins for this track yet"
            action={
              user.role === "student" ? <ButtonLink href="/student/consent">Join from Sharing</ButtonLink> : undefined
            }
          >
            Leaderboards show only students who chose to join. Joining is off by default and can be reversed at any time
            in Sharing.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          {/* Phones: stacked cards */}
          <ul className="divide-y divide-line sm:hidden">
            {entries.map((e) => (
              <li key={e.studentId} className="py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-full bg-sand-2 font-black text-ink text-sm">
                      {e.rank}
                    </span>
                    <span className="font-extrabold text-ink">{e.pseudonymousId}</span>
                  </div>
                  <span className="tabular font-black text-2xl text-ink">{score1(e.score)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-2">
                  <span>
                    {e.departmentCode} · Year {e.year}
                  </span>
                  {e.streakDays > 0 && (
                    <Tag kind="low" icon={<Flame aria-hidden className="size-3 text-low" />}>
                      {e.streakDays}d streak
                    </Tag>
                  )}
                  {e.verifiedArtifactsCount > 0 && <EvidenceChip status="VERIFIED" className="text-xs" />}
                </div>
              </li>
            ))}
          </ul>

          {/* Tablets / desktop: clean table */}
          <div className="hidden sm:block">
            <table className="w-full text-left">
              <caption className="sr-only">Track leaderboard for opted-in students</caption>
              <thead className="text-sm text-ink-2">
                <tr>
                  <th className="pb-3 font-bold w-16">Rank</th>
                  <th className="pb-3 font-bold">Student</th>
                  <th className="pb-3 font-bold">Department</th>
                  <th className="pb-3 font-bold text-center">Streak</th>
                  <th className="pb-3 font-bold">Verified Evidence</th>
                  <th className="pb-3 font-bold text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular">
                {entries.map((e) => (
                  <tr key={e.studentId}>
                    <td className="py-3.5 font-black text-ink">
                      <span className="flex size-7 items-center justify-center rounded-full bg-sand-2 text-sm">
                        {e.rank}
                      </span>
                    </td>
                    <td className="py-3.5 font-bold text-ink">{e.pseudonymousId}</td>
                    <td className="py-3.5 text-sm text-ink-2">
                      {e.departmentCode} (Yr {e.year})
                    </td>
                    <td className="py-3.5 text-center">
                      {e.streakDays > 0 ? (
                        <Tag kind="low" icon={<Flame aria-hidden className="size-3 text-low" />}>
                          {e.streakDays}d
                        </Tag>
                      ) : (
                        <span className="text-sm text-ink-2">—</span>
                      )}
                    </td>
                    <td className="py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {e.verifiedArtifactsCount > 0 ? (
                          <>
                            <EvidenceChip status="VERIFIED" />
                            <span className="text-xs text-ink-2">({e.verifiedArtifactsCount} verified)</span>
                          </>
                        ) : (
                          <span className="text-sm text-ink-2">—</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 text-right font-black text-xl text-ink">{score1(e.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 border-t border-line pt-3 text-xs text-ink-2">
            Leaderboards display pseudonymous IDs only (§4.1). Participation is strictly voluntary and can be toggled in
            Sharing at any time.
          </p>
        </Card>
      )}
    </div>
  );
}

export default function LeaderboardsPage({ searchParams }: { searchParams: Promise<{ track?: string }> }) {
  return (
    <AppShell area="auto">
      <PageHeader
        title="Leaderboards"
        description="Opt-in only. Shows students who chose to share their verified progress on each career track."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Boards searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
