import { z } from "zod";
import { apiError, handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { COUNSELING_COLUMNS } from "@/server/db/schema/enums";
import { moveCard } from "@/server/services/counseling";

/** PATCH /api/v1/counseling/cards/{id} — move a card; backward moves need a reason. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser(["faculty_mentor"]);
  const id = z.uuid().parse((await ctx.params).id);
  const b = z
    .object({
      column: z.enum(COUNSELING_COLUMNS),
      reason: z.string().max(300).optional(),
    })
    .parse(await req.json());
  try {
    await moveCard(id, user.id, b.column, b.reason ?? null);
  } catch (e) {
    return apiError(409, "move_rejected", e instanceof Error ? e.message : "Move failed");
  }
  return json({ ok: true });
});
