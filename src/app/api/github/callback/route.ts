import { and, eq, ne } from "drizzle-orm";
import { connection } from "next/server";
import { audit } from "@/server/audit/log";
import { requireApiUser } from "@/server/auth/session";
import { redis } from "@/server/cache/redis";
import { db } from "@/server/db";
import { students } from "@/server/db/schema";
import { env, githubOAuthEnabled } from "@/server/env";

const back = (status: "linked" | "failed" | "taken") =>
  Response.redirect(new URL(`/student/quests?github=${status}`, env.APP_URL), 302);

/** GET /api/github/callback — completes the flow and records the verified GitHub login (§6.2). */
export async function GET(req: Request) {
  await connection();
  const user = await requireApiUser(["student"]);
  if (!githubOAuthEnabled) return new Response("GitHub linking is not set up", { status: 404 });
  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const state = q.get("state");
  if (!code || !state) return back("failed");
  if (redis.status === "wait") await redis.connect();
  const owner = await redis.getdel(`gh:state:${state}`);
  if (owner !== user.id) return back("failed");

  const token = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }),
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => r.json() as Promise<{ access_token?: string }>)
    .catch(() => ({}) as { access_token?: string });
  if (!token.access_token) return back("failed");
  const me = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "AspirEdge",
    },
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ login?: string }>) : null))
    .catch(() => null);
  if (!me?.login) return back("failed");

  const [student] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
  if (!student) return back("failed");
  // One GitHub account proves one student: a login already linked to someone else is refused.
  const [clash] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.githubLogin, me.login.toLowerCase()), ne(students.id, student.id)))
    .limit(1);
  if (clash) return back("taken");
  await db
    .update(students)
    .set({ githubLogin: me.login.toLowerCase(), githubLinkedAt: new Date() })
    .where(eq(students.id, student.id));
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "github.link",
    entityType: "student",
    entityId: student.pseudonymousId,
    purpose: "evidence_verification",
    result: "allowed",
  });
  return back("linked");
}
