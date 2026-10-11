import { z } from "zod";
import { REASON_CODES } from "@/lib/labels";
import { apiError, handle, json } from "@/server/api/handler";
import { STAFF_ROLES } from "@/server/auth/roles";
import { requireApiUser } from "@/server/auth/session";
import { studentBrief } from "@/server/services/students";

/** GET /api/v1/students/{id}?reason= — deep-dive; requires a reason code (§13.2). */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser(STAFF_ROLES);
  const { id } = await ctx.params;
  const reason = new URL(req.url).searchParams.get("reason");
  if (!reason || !REASON_CODES.some((r) => r.value === reason))
    return apiError(400, "reason_required", `Pass ?reason= one of ${REASON_CODES.map((r) => r.value).join(", ")}`);
  const brief = await studentBrief(z.uuid().parse(id), user, {
    reasonCode: reason,
    purpose: reason,
    sourceIp: req.headers.get("x-forwarded-for"),
  });
  return json(brief);
});
