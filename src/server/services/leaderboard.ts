/**
 * Leaderboards read model (§4.1, §12.1).
 *
 * Leaderboards are strictly opt-in (off by default) and can be reversed
 * at any time. Only students with an active opt-in appear here.
 * Tracks are tabbed, scores come from pure evaluations, and verified links
 * are shown as chips.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { artifacts, evaluations, leaderboardOptIns, students } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import { TRACK_IDS, type TrackId } from "../policy/schema";

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  pseudonymousId: string;
  departmentCode: string;
  year: number;
  trackId: TrackId;
  trackName: string;
  score: number;
  streakDays: number;
  verifiedArtifactsCount: number;
  verifiedItems: { id: string; label: string; type: string }[];
}

export async function getLeaderboardData(selectedTrack?: string) {
  const policy = getActivePolicy();
  const tracks = Object.entries(policy.tracks).map(([id, t]) => ({
    id: id as TrackId,
    name: t.name,
  }));

  const activeTrack: TrackId =
    selectedTrack && (TRACK_IDS as readonly string[]).includes(selectedTrack)
      ? (selectedTrack as TrackId)
      : (tracks[0]?.id ?? "corporate_placement");

  // Query only students with optedIn = true
  const optIns = await db
    .select({
      studentId: leaderboardOptIns.studentId,
    })
    .from(leaderboardOptIns)
    .where(eq(leaderboardOptIns.optedIn, true));

  if (optIns.length === 0) {
    return {
      activeTrack,
      tracks,
      entries: [],
      totalOptIns: 0,
    };
  }

  const studentIds = optIns.map((o) => o.studentId);

  // Fetch student info
  const studentRows = await db.select().from(students).where(inArray(students.id, studentIds));

  // For each student, get latest evaluation for the active track
  const entries: LeaderboardEntry[] = [];

  for (const s of studentRows) {
    // Only include if declared track matches or if they have an evaluation on this track
    const [latestEval] = await db
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.studentId, s.id), eq(evaluations.track, activeTrack)))
      .orderBy(desc(evaluations.createdAt))
      .limit(1);

    if (!latestEval && s.declaredTrack !== activeTrack) {
      continue;
    }

    const verifiedArtifacts = await db
      .select({
        id: artifacts.id,
        label: artifacts.label,
        type: artifacts.type,
      })
      .from(artifacts)
      .where(and(eq(artifacts.studentId, s.id), inArray(artifacts.status, ["VERIFIED", "ATTESTED"])))
      .limit(5);

    const score = latestEval?.trackScore ?? (s.declaredTrack === activeTrack ? 0 : 0);

    entries.push({
      rank: 0, // Assigned after sorting
      studentId: s.id,
      pseudonymousId: s.pseudonymousId,
      departmentCode: s.departmentCode,
      year: s.year,
      trackId: activeTrack,
      trackName: policy.tracks[activeTrack]?.name ?? activeTrack,
      score,
      streakDays: s.signals?.streakValidDays ?? 0,
      verifiedArtifactsCount: verifiedArtifacts.length,
      verifiedItems: verifiedArtifacts,
    });
  }

  // Sort descending by score, then by verifiedArtifactsCount
  entries.sort((a, b) => b.score - a.score || b.verifiedArtifactsCount - a.verifiedArtifactsCount);

  // Assign ranks
  entries.forEach((e, i) => {
    e.rank = i + 1;
  });

  return {
    activeTrack,
    tracks,
    entries,
    totalOptIns: optIns.length,
  };
}
