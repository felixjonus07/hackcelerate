import { z } from "zod";
import { handle, json } from "@/server/api/handler";
import { meStudent } from "@/server/api/me";
import { audit } from "@/server/audit/log";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "@/server/consent/matrix";
import type { ConsentCategory, Role } from "@/server/db/schema/enums";
import { setConsent } from "@/server/services/consent";

const params = z.object({
  category: z.enum(Object.keys(CONSENTABLE) as [ConsentCategory, ...ConsentCategory[]]),
  recipient: z.enum(CONSENT_RECIPIENTS),
});

/** PUT /api/v1/students/me/consents/{category}/{recipient} — grant or withdraw. */
export const PUT = handle(async (req: Request, ctx: { params: Promise<{ category: string; recipient: string }> }) => {
  const { user, student } = await meStudent();
  const p = params.parse(await ctx.params);
  const { granted } = z.object({ granted: z.boolean() }).parse(await req.json());
  await setConsent(student.id, p.category, p.recipient as Role, granted, user.id);
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: granted ? "consent.grant" : "consent.withdraw",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "consent_center",
    fieldsAccessed: [`${p.category}:${p.recipient}`],
    result: "allowed",
  });
  return json({
    ok: true,
    category: p.category,
    recipient: p.recipient,
    granted,
  });
});
