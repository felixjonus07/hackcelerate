/**
 * Leaderboards (§12.1, §12.3): tabs per track, opted-in students only, off by default. Ranking is by verified
 * effort (evidence that counts, and the practice streak), never by score or gap, and shows no persona, index or
 * grade. Students appear under their pseudonymous ID; their verified public links appear as chips.
 */
import { and, eq, inArray } from "drizzle-orm";
import { cached } from "../cache";
import { db } from "../db";
import { artifacts, leaderboardOptIns, mockAttempts, students } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import type { TrackId } from "../policy/schema";
import { localDate } from "../rules/calendar";
import { streakValidDays } from "../rules/integrity";
import { multiplier } from "../rules/normalize";

export type LeaderboardTab = "evidence" | "streak";

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  department: string;
  points: number;
  streakDays: number;
  streakBadge: boolean;
  links: { host: string; url: string }[];
  isYou: boolean;
}

const LINK_TYPES = new Set(["repository_check", "doi_or_preprint"]);

async function compute(track: TrackId, tab: LeaderboardTab, viewerStudentId: string | null, now: Date) {
  const policy = await getActivePolicy();
  const asOf = localDate(now, policy.calendar);
  const opted = await db
    .select({ id: students.id, handle: students.pseudonymousId, department: students.departmentCode })
    .from(leaderboardOptIns)
    .innerJoin(students, eq(students.id, leaderboardOptIns.studentId))
    .where(and(eq(leaderboardOptIns.optedIn, true), eq(students.declaredTrack, track)));
  if (opted.length === 0) return { entries: [] as LeaderboardEntry[], optedIn: 0 };
  const ids = opted.map((o) => o.id);
  const [arts, mocks] = await Promise.all([
    db.select().from(artifacts).where(inArray(artifacts.studentId, ids)),
    db.select().from(mockAttempts).where(inArray(mockAttempts.studentId, ids)),
  ]);
  const rows = opted.map((o) => {
    const mine = arts.filter((a) => a.studentId === o.id);
    const points = mine.reduce((n, a) => n + a.weight * multiplier(a.status, policy), 0);
    const streakDays = streakValidDays(
      mocks
        .filter((m) => m.studentId === o.id)
        .map((m) => ({
          id: m.id,
          testType: m.testType,
          date: localDate(m.takenAt, policy.calendar),
          items: m.items,
          percentile: m.percentile,
          avgSecondsPerItem: m.avgSecondsPerItem,
          status: m.status,
        })),
      asOf,
      policy,
    );
    const links = mine
      .filter((a) => a.status === "VERIFIED" && a.sourceUrl && LINK_TYPES.has(a.type))
      .map((a) => ({ host: new URL(a.sourceUrl as string).hostname.replace(/^www\./, ""), url: a.sourceUrl as string }))
      .slice(0, 3);
    return { o, points: Math.round(points * 10) / 10, streakDays, links };
  });
  rows.sort(
    (a, b) =>
      (tab === "streak"
        ? b.streakDays - a.streakDays || b.points - a.points
        : b.points - a.points || b.streakDays - a.streakDays) || a.o.handle.localeCompare(b.o.handle),
  );
  const entries = rows.slice(0, 20).map((r, i) => ({
    rank: i + 1,
    handle: r.o.handle,
    department: r.o.department,
    points: r.points,
    streakDays: r.streakDays,
    streakBadge: r.streakDays >= policy.leaderboard.streak_badge_days,
    links: r.links,
    isYou: r.o.id === viewerStudentId,
  }));
  return { entries, optedIn: opted.length };
}

/** Refreshed daily (§12.3): the computation is cached per track, tab and day; the viewer's own row is marked afterwards. */
export async function leaderboard(
  track: TrackId,
  tab: LeaderboardTab,
  viewerStudentId: string | null,
  opts: { now?: Date; cache?: boolean } = {},
) {
  const now = opts.now ?? new Date();
  const policy = await getActivePolicy();
  const base =
    opts.cache === false
      ? await compute(track, tab, null, now)
      : await cached(`leaderboard:${track}:${tab}:${localDate(now, policy.calendar)}`, 3600, () =>
          compute(track, tab, null, now),
        );
  if (!viewerStudentId) return base;
  const [me] = await db
    .select({ handle: students.pseudonymousId })
    .from(students)
    .where(eq(students.id, viewerStudentId))
    .limit(1);
  return { ...base, entries: base.entries.map((e) => ({ ...e, isYou: e.handle === me?.handle })) };
}
