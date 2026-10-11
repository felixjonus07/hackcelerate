import { z } from "zod";
import { handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { db } from "@/server/db";
import { leaderboardOptIns } from "@/server/db/schema";

/** PUT /api/v1/students/me/leaderboard-visibility — opt in or out (default off). */
export const PUT = handle(async (req: Request) => {
  const { student } = await meStudent();
  const { optedIn } = z.object({ optedIn: z.boolean() }).parse(await req.json());
  await db
    .insert(leaderboardOptIns)
    .values({ studentId: student.id, optedIn })
    .onConflictDoUpdate({
      target: leaderboardOptIns.studentId,
      set: { optedIn, changedAt: new Date() },
    });
  return json({ ok: true, optedIn });
});
