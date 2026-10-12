import { randomBytes } from "node:crypto";
import { connection } from "next/server";
import { requireApiUser } from "@/server/auth/session";
import { redis } from "@/server/cache/redis";
import { env, githubOAuthEnabled } from "@/server/env";

/**
 * GET /api/github/link — starts the GitHub OAuth flow that proves a student owns their GitHub account
 * (§6.2). Off unless a GitHub OAuth app is configured. The state value ties the callback to this
 * signed-in student and expires in ten minutes.
 */
export async function GET() {
  await connection();
  const user = await requireApiUser(["student"]);
  if (!githubOAuthEnabled) return new Response("GitHub linking is not set up", { status: 404 });
  const state = randomBytes(24).toString("base64url");
  if (redis.status === "wait") await redis.connect();
  await redis.set(`gh:state:${state}`, user.id, "EX", 600);
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${env.APP_URL}/api/github/callback`);
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  return Response.redirect(url, 302);
}
