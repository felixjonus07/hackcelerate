import { handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { currentConsents } from "@/server/services/consent";

/** GET /api/v1/students/me/consents — current consent by category and recipient. */
export const GET = handle(async () => {
  const { student } = await meStudent();
  return json({ consents: await currentConsents(student.id) });
});
