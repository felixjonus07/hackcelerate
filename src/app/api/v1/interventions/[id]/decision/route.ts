import { z } from "zod";
import { rolesOf } from "@/server/api/access";
import { apiError, handle, json } from "@/server/api/handler";
import { audit } from "@/server/audit/log";
import { requireApiUser } from "@/server/auth/session";
import { decide } from "@/server/services/approvals";

const body = z.object({
  decision: z.enum(["approve", "edit_approve", "reject"]),
  note: z.string().max(500).optional(),
  message: z.string().max(1000).optional(),
});

/** POST /api/v1/interventions/{id}/decision — approve, edit and approve, or reject. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireApiUser(rolesOf("decision"));
  const id = z.uuid().parse((await ctx.params).id);
  const b = body.parse(await req.json());
  try {
    const { intervention: row, dispatch } = await decide(id, user, b.decision, b.note ?? null, b.message ?? null);
    await audit({
      actorUserId: user.id,
      actorRole: user.role,
      action: `intervention.${b.decision}`,
      entityType: "intervention",
      entityId: id,
      purpose: "approval_decision",
      result: "allowed",
    });
    return json({
      ok: true,
      status: dispatch?.status === "DISPATCHED" ? "DISPATCHED" : row.status,
      dispatch: dispatch?.status ?? null,
      blockedReason: dispatch?.status === "BLOCKED" ? dispatch.message : null,
    });
  } catch (e) {
    return apiError(409, "decision_rejected", e instanceof Error ? e.message : "Could not record decision");
  }
});
