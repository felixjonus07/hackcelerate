import { eq } from "drizzle-orm";
import { z } from "zod";
import { rolesOf } from "@/server/api/access";
import { handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { students } from "@/server/db/schema";
import { TRACK_IDS } from "@/server/policy/schema";
import { leaderboard } from "@/server/services/leaderboard";

const query = z.object({
  track: z.enum(TRACK_IDS).default("corporate_placement"),
  tab: z.enum(["evidence", "streak"]).default("evidence"),
});

/** GET /api/v1/leaderboards?track=&tab= — opted-in students only; no scores, indexes or flags (§12.3). */
export const GET = handle(async (req: Request) => {
  const user = await requireApiUser(rolesOf("leaderboards"));
  const q = query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const [me] =
    user.role === "student"
      ? await db.select({ id: students.id }).from(students).where(eq(students.userId, user.id)).limit(1)
      : [];
  const board = await leaderboard(q.track, q.tab, me?.id ?? null);
  return json({
    track: q.track,
    tab: q.tab,
    entries: board.entries,
    note: board.entries.length ? null : "No opt-ins yet",
  });
});
