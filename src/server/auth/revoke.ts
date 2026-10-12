/**
 * Ends every session of one user (role change, account turned off, "sign out everywhere").
 * Sessions are cached in Redis together with the user's role, so deleting only the database rows would leave a
 * stale role usable until the cache expired. The database copy is kept for audit and just made expired.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { session } from "../db/schema";
import { endActivity } from "./activity";
import { redisSecondaryStorage } from "./storage";

/** Returns how many sessions were ended. */
export async function revokeUserSessions(userId: string): Promise<number> {
  const rows = await db
    .select({ id: session.id, token: session.token })
    .from(session)
    .where(eq(session.userId, userId));
  await Promise.all(
    rows.map(async (r) => {
      await redisSecondaryStorage.delete(r.token);
      await endActivity(r.id);
    }),
  );
  await redisSecondaryStorage.delete(`active-sessions-${userId}`);
  await db.update(session).set({ expiresAt: new Date() }).where(eq(session.userId, userId));
  return rows.length;
}
