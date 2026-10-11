/**
 * POST /api/session/heartbeat — renews the idle window while the user is
 * active on a page without navigating ("Stay signed in"). Returns the timing
 * the client uses for its countdown. 401 once the session is gone or idle.
 */
import { getSessionTiming } from "@/server/auth/session";

export async function POST() {
  const timing = await getSessionTiming();
  if (!timing)
    return Response.json({ status: "signed_out" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json(
    {
      status: "active",
      idleSeconds: timing.idleSeconds,
      warningSeconds: timing.warningSeconds,
      expiresAt: timing.expiresAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
