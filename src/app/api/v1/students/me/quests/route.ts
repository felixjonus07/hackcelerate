import { eq } from "drizzle-orm";
import { handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { db } from "@/server/db";
import { quests } from "@/server/db/schema";

/** GET /api/v1/students/me/quests */
export const GET = handle(async () => {
  const { student } = await meStudent();
  return json({
    quests: await db.select().from(quests).where(eq(quests.studentId, student.id)),
  });
});
