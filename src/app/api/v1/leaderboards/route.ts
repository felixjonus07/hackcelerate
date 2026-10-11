import type { NextRequest } from "next/server";
import { handle, json } from "@/server/api/handler";
import { requireApiUser } from "@/server/auth/session";
import { getLeaderboardData } from "@/server/services/leaderboard";

/** GET /api/v1/leaderboards?track= — opted-in students only (§4.1, §12.1). */
export const GET = handle(async (req: NextRequest) => {
  await requireApiUser();
  const track = req.nextUrl.searchParams.get("track") || undefined;
  const data = await getLeaderboardData(track);
  return json(data);
});
