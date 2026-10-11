import { eq } from "drizzle-orm";
import { handle } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { students } from "@/server/db/schema";
import { exportStudentData, submitRightsRequest } from "@/server/services/rights";

/** GET /api/v1/students/me/export — downloadable JSON export of personal data (§13.7, DPDP Act 2023). */
export const GET = handle(async () => {
  const user = await requireApiUser(["student"]);
  const [s] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
  if (!s) {
    return Response.json({ error: { code: "not_found", message: "Student record not found" } }, { status: 404 });
  }

  const data = await exportStudentData(s.id, user.id);
  await submitRightsRequest(s.id, user.id, user.role, s.pseudonymousId, "access", "Data export downloaded");

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="aspiredge-export-${s.pseudonymousId}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
});
