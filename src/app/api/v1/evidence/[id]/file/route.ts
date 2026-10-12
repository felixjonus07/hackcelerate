import { z } from "zod";
import { rolesOf } from "@/server/api/access";
import { apiError, handle } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { EvidenceError, evidenceFileLink } from "@/server/services/evidence";

/** GET /api/v1/evidence/{id}/file — redirects to a link that expires within minutes (§13.3). */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser(rolesOf("evidence-file"));
  const id = z.uuid().parse((await ctx.params).id);
  try {
    const url = await evidenceFileLink(user, id, req.headers.get("x-forwarded-for"));
    return Response.redirect(new URL(url, req.url), 302);
  } catch (e) {
    if (e instanceof EvidenceError) return apiError(403, "forbidden", e.message);
    throw e;
  }
});
