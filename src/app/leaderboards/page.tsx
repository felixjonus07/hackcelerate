import { eq } from "drizzle-orm";
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
import { TRACK_LABELS, TRACK_SHORT } from "@/lib/labels";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { students } from "@/server/db/schema";
import { TRACK_IDS, type TrackId } from "@/server/policy/schema";
import { type LeaderboardTab, leaderboard } from "@/server/services/leaderboard";

export const metadata: Metadata = { title: "Leaderboards" };

type Search = Promise<{ track?: string; tab?: string }>;

const TABS: { id: LeaderboardTab; label: string; hint: string }[] = [
  { id: "evidence", label: "Evidence", hint: "Points for checked evidence. Verified items count in full." },
  { id: "streak", label: "Streak", hint: "Consecutive days with a valid practice test." },
];

async function Boards({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const q = await searchParams;
  const track: TrackId = (TRACK_IDS as readonly string[]).includes(q.track ?? "")
    ? (q.track as TrackId)
    : "corporate_placement";
  const tab: LeaderboardTab = q.tab === "streak" ? "streak" : "evidence";
  const [me] =
    user.role === "student"
      ? await db.select({ id: students.id }).from(students).where(eq(students.userId, user.id)).limit(1)
      : [];
  const board = await leaderboard(track, tab, me?.id ?? null);
  const href = (t: TrackId, b: LeaderboardTab) => `/leaderboards?track=${t}&tab=${b}`;

  return (
    <div className="grid gap-5">
      <nav aria-label="Track" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TRACK_IDS.map((t) => (
          <Link
            key={t}
            href={href(t, tab)}
            aria-current={t === track ? "page" : undefined}
            className={cn(
              "press shrink-0 rounded-full px-4 py-2 text-sm font-bold",
              t === track ? "bg-ink text-sand" : "bg-sand-2 text-ink hover:bg-sand-3",
            )}
          >
            {TRACK_SHORT[t]}
          </Link>
        ))}
      </nav>
      <Card aria-labelledby="board-h">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="board-h" className="text-[1.05rem] font-extrabold">
              {TRACK_LABELS[track]}
            </h2>
            <p className="text-sm text-ink-2">{TABS.find((t) => t.id === tab)?.hint}</p>
          </div>
          <div role="tablist" aria-label="Ranking" className="flex gap-1 rounded-full bg-sand p-1">
            {TABS.map((t) => (
              <Link
                key={t.id}
                role="tab"
                aria-selected={t.id === tab}
                href={href(track, t.id)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-bold",
                  t.id === tab ? "bg-card shadow-card" : "text-ink-2",
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
        </div>
        {board.entries.length === 0 ? (
          <EmptyState
            title="No opt-ins yet"
            action={
              user.role === "student" ? <ButtonLink href="/student/consent">Join from Sharing</ButtonLink> : undefined
            }
          >
            Leaderboards show only students who chose to join. Joining is off by default and can be reversed at any
            time.
          </EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {board.entries.map((e) => (
              <li key={e.handle} className={cn("grid gap-2 py-3.5", e.isYou && "-mx-3 rounded-2xl bg-sand px-3")}>
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0">
                    <span className="tabular mr-3 inline-block w-6 font-black">{e.rank}</span>
                    <span className="font-extrabold">{e.isYou ? "You" : e.handle}</span>{" "}
                    <span className="text-ink-2">· {e.department}</span>
                  </p>
                  <p className="tabular shrink-0 font-bold">
                    {tab === "streak"
                      ? `${e.streakDays} ${e.streakDays === 1 ? "day" : "days"}`
                      : `${e.points} ${e.points === 1 ? "pt" : "pts"}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-9">
                  {e.streakBadge ? (
                    <Tag kind="low" icon={<Flame aria-hidden className="size-3.5" />}>
                      {e.streakDays}-day streak
                    </Tag>
                  ) : null}
                  {e.links.map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm font-semibold ring-1 ring-inset ring-line hover:bg-sand-2"
                    >
                      {l.host}
                      <EvidenceChip status="VERIFIED" />
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <p className="text-sm text-ink-2">
        {board.optedIn} {board.optedIn === 1 ? "student has" : "students have"} joined this track. Scores, gaps and
        support flags are never shown here.
      </p>
    </div>
  );
}

export default function LeaderboardsPage({ searchParams }: { searchParams: Search }) {
  return (
    <AppShell area="auto">
      <PageHeader
        title="Leaderboards"
        description="Only students who chose to join appear, and they can leave at any time."
      />
      <Suspense fallback={<PageSkeleton />}>
        <Boards searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}
