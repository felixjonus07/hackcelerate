import { rolesOf } from "@/server/api/access";
import { apiError, handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { createDraft, listPolicyVersions, PolicyError } from "@/server/services/policy-admin";

/** GET /api/v1/admin/policy/versions — read-only list (registrar edits; dean, HOD and auditor view, §13.1). */
export const GET = handle(async () => {
  await requireApiUser(rolesOf("policy-list"));
  return json({ versions: await listPolicyVersions() });
});

/** POST /api/v1/admin/policy/versions — create a DRAFT policy version (registrar). */
export const POST = handle(async (req: Request) => {
  const user = await requireApiUser(rolesOf("policy-create"));
  try {
    const draft = await createDraft(user, await req.json(), req.headers.get("x-forwarded-for"));
    return json({ ok: true, ...draft }, { status: 201 });
  } catch (e) {
    if (e instanceof PolicyError) return apiError(409, e.code, e.message);
    throw e;
  }
});
