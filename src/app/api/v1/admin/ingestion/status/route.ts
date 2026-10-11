import { desc } from "drizzle-orm";
import { handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { ingestionRuns } from "@/server/db/schema";

/** GET /api/v1/admin/ingestion/status — latest import checksums and errors (registrar). */
export const GET = handle(async () => {
  await requireApiUser(["registrar"]);
  return json({
    runs: await db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(20),
  });
});
