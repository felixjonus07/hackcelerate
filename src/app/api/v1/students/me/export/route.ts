import { handle } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { buildAccessExport } from "@/server/services/rights";

/**
 * GET /api/v1/students/me/export — the student's own data as a download (§13.7 access request). It acts only on
 * the signed-in student and is audited; staff cannot call it.
 */
export const GET = handle(async () => {
  const { student } = await meStudent();
  const data = await buildAccessExport(student);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="aspiredge-my-data-${student.pseudonymousId}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
});
