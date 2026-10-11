/**
 * Data access layer for the current user (Next.js docs: "Authentication with
 * Cache Components"). The proxy only does an optimistic cookie check; every
 * page, server action and route handler authorizes here, on every request.
 *
 * Each call also enforces the idle timeout: a session with no request inside
 * its idle window is revoked and the caller is sent to sign-in (§13.2).
 */
import "server-only";
import { getSessionCookie } from "better-auth/cookies";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { forbidden, redirect, unauthorized } from "next/navigation";
import { cache } from "react";
import { audit } from "../audit/log";
import { db } from "../db";
import { students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { ROLES } from "../db/schema/enums";
import { logger } from "../logger";
import { auth } from ".";
import { type ActivityRecord, endActivity, touchActivity } from "./activity";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface SessionTiming {
  sessionId: string;
  idleSeconds: number;
  warningSeconds: number;
  expiresAt: string;
  trusted: boolean;
}

type SessionState =
  | { status: "active"; user: CurrentUser; timing: SessionTiming }
  | { status: "none" }
  | { status: "idle" };

/** One lookup per request (React cache), shared by every caller in the render. */
const readSession = cache(async (): Promise<SessionState> => {
  const h = await headers();
  // Fast path: if no session cookie exists, avoid hitting DB/Redis entirely.
  const cookie = getSessionCookie(h);
  if (!cookie) return { status: "none" };

  let s: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    s = await Promise.race([
      auth.api.getSession({ headers: h }),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("auth timeout")), 3000)),
    ]);
  } catch (err) {
    logger.warn({ err: String(err) }, "getSession failed or timed out");
    return { status: "none" };
  }
  if (!s) return { status: "none" };

  const activity: ActivityRecord | null = await touchActivity(s.session.id);
  if (!activity) {
    // Idle timeout reached: revoke the session so the cookie is useless everywhere.
    try {
      await auth.api.revokeSession({ headers: h, body: { token: s.session.token } });
    } catch (err) {
      logger.warn({ err: String(err) }, "idle session revoke failed");
    }
    await endActivity(s.session.id);
    await audit({
      actorUserId: s.user.id,
      actorRole: String(s.user.role ?? "unknown"),
      action: "session.idle_timeout",
      entityType: "session",
      entityId: s.session.id,
      purpose: "authentication",
      result: "allowed",
    }).catch(() => undefined);
    return { status: "idle" };
  }

  const role = (ROLES as readonly string[]).includes(String(s.user.role)) ? (s.user.role as Role) : "student";
  return {
    status: "active",
    user: { id: s.user.id, name: s.user.name, email: s.user.email, role },
    timing: {
      sessionId: s.session.id,
      idleSeconds: activity.idleSeconds,
      warningSeconds: activity.warningSeconds,
      expiresAt: new Date(s.session.expiresAt).toISOString(),
      trusted: activity.trusted,
    },
  };
});

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const s = await readSession();
  return s.status === "active" ? s.user : null;
}

/** Timing for the client-side timeout warning; null when signed out. */
export async function getSessionTiming(): Promise<SessionTiming | null> {
  const s = await readSession();
  return s.status === "active" ? s.timing : null;
}

/** For pages: redirect to sign-in when signed out or idle; 403 when the role is wrong. */
export async function requireUser(roles?: readonly Role[]): Promise<CurrentUser> {
  const s = await readSession();
  if (s.status === "idle") redirect("/sign-in?reason=idle");
  if (s.status === "none") redirect("/sign-in");
  if (roles && !roles.includes(s.user.role)) forbidden();
  return s.user;
}

/** For route handlers: throw 401/403 instead of redirecting. */
export async function requireApiUser(roles?: readonly Role[]): Promise<CurrentUser> {
  const s = await readSession();
  if (s.status !== "active") unauthorized();
  if (roles && !roles.includes(s.user.role)) forbidden();
  return s.user;
}

/** Resolves the authenticated student's record; ignores any id in the path (§11). */
export async function requireStudent() {
  const u = await requireUser(["student"]);
  const [student] = await db.select().from(students).where(eq(students.userId, u.id)).limit(1);
  if (!student) redirect("/student/onboarding");
  return { user: u, student };
}
