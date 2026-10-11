/**
 * Better Auth instance (§13.2).
 *
 * Sessions: stored in Redis (secondary storage) with a copy in Postgres for
 * listing and audit. Each session gets a role-based absolute lifetime at
 * creation (no sliding refresh) plus an idle timeout tracked in Redis
 * (see ./activity.ts, enforced in ./session.ts on every request).
 *
 * Sign-in protection: per-IP rate limiting, per-account lockout after repeated
 * failures, demo accounts off in production, generic OIDC for the institution.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { eq } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import * as schema from "../db/schema";
import { demoLoginEnabled, env, isProduction, oidcEnabled } from "../env";
import { logger } from "../logger";
import { endActivity, startActivity } from "./activity";
import { MAX_SESSION_SECONDS, sessionPolicyConfig } from "./config";
import { clearFailures, emailKey, lockedFor, recordFailure } from "./lockout";
import { sessionPolicyFor } from "./session-policy";
import { redisSecondaryStorage } from "./storage";

async function roleOf(userId: string): Promise<string> {
  const [u] = await db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  return u?.role ?? "student";
}

async function roleByEmail(email: string): Promise<string | null> {
  const [u] = await db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.email, email.trim().toLowerCase()))
    .limit(1);
  return u?.role ?? null;
}

const safeAudit = (e: Parameters<typeof audit>[0]) =>
  audit(e).catch((err) => logger.error({ err: String(err), action: e.action }, "auth audit failed"));

const minutes = (s: number) => Math.ceil(s / 60);

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL, env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  secondaryStorage: redisSecondaryStorage,
  emailAndPassword: {
    enabled: demoLoginEnabled,
    disableSignUp: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
  },
  user: {
    additionalFields: {
      // Roles come from directory groups in production (§13.2); never user-editable.
      role: { type: "string", required: false, defaultValue: "student", input: false },
    },
  },
  session: {
    // Ceiling only: each session's real expiresAt is set per role at creation.
    expiresIn: MAX_SESSION_SECONDS,
    // Absolute lifetime: activity never extends expiresAt (idle timeout is separate).
    disableSessionRefresh: true,
    storeSessionInDatabase: true,
    preserveSessionInDatabase: true,
    additionalFields: {
      trusted: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  rateLimit: {
    enabled: true,
    storage: "secondary-storage",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: env.AUTH_SIGNIN_RATE_PER_MINUTE },
      "/sign-in/social": { window: 60, max: env.AUTH_SIGNIN_RATE_PER_MINUTE },
      "/change-password": { window: 300, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" },
    ipAddress: { ipAddressHeaders: [env.TRUSTED_IP_HEADER] },
  },
  databaseHooks: {
    session: {
      create: {
        // Apply the role's policy: absolute expiry and whether the device is trusted.
        before: async (session, ctx) => {
          const role = await roleOf(session.userId);
          const wantsTrusted = Boolean((ctx?.body as { rememberMe?: boolean } | undefined)?.rememberMe);
          const p = sessionPolicyFor(role, wantsTrusted, sessionPolicyConfig);
          return {
            data: { ...session, trusted: p.trusted, expiresAt: new Date(Date.now() + p.absoluteSeconds * 1000) },
          };
        },
        after: async (session) => {
          const role = await roleOf(session.userId);
          const p = sessionPolicyFor(role, Boolean((session as { trusted?: boolean }).trusted), sessionPolicyConfig);
          await startActivity(session.id, role, p);
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-in/email") {
        const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "");
        const locked = email ? await lockedFor(email) : 0;
        if (locked) {
          await safeAudit({
            actorUserId: "anonymous",
            actorRole: "none",
            action: "sign_in.blocked_locked",
            entityType: "account",
            entityId: emailKey(email),
            purpose: "authentication",
            result: "denied",
          });
          throw new APIError("TOO_MANY_REQUESTS", {
            message: `Too many failed attempts. Try again in ${minutes(locked)} minute${minutes(locked) === 1 ? "" : "s"}.`,
          });
        }
        // Staff are never "remembered": shared office computers (§13.2).
        const role = email ? await roleByEmail(email) : null;
        if (role && role !== "student") return { context: { body: { ...(ctx.body as object), rememberMe: false } } };
      }
      if (ctx.path === "/sign-out") {
        const s = await getSessionFromCtx(ctx).catch(() => null);
        if (s) {
          await endActivity(s.session.id);
          await safeAudit({
            actorUserId: s.user.id,
            actorRole: String((s.user as { role?: string }).role ?? "unknown"),
            action: "sign_out",
            entityType: "session",
            entityId: s.session.id,
            purpose: "authentication",
            result: "allowed",
          });
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email") return;
      const email = String((ctx.body as { email?: unknown } | undefined)?.email ?? "");
      const returned = ctx.context.returned;
      if (isAPIError(returned)) {
        if (returned.statusCode === 401 && email) {
          const lockedNow = await recordFailure(email);
          await safeAudit({
            actorUserId: "anonymous",
            actorRole: "none",
            action: lockedNow ? "sign_in.locked" : "sign_in.failure",
            entityType: "account",
            entityId: emailKey(email),
            purpose: "authentication",
            result: "denied",
          });
        }
        return;
      }
      const s = ctx.context.newSession;
      if (s) {
        await clearFailures(email);
        await safeAudit({
          actorUserId: s.user.id,
          actorRole: String((s.user as { role?: string }).role ?? "unknown"),
          action: "sign_in.success",
          entityType: "session",
          entityId: s.session.id,
          purpose: "authentication",
          sourceIp: s.session.ipAddress ?? null,
          result: "allowed",
        });
      }
    }),
  },
  plugins: [
    ...(oidcEnabled
      ? [
          genericOAuth({
            config: [
              {
                providerId: env.OIDC_PROVIDER_ID,
                discoveryUrl: env.OIDC_DISCOVERY_URL,
                clientId: env.OIDC_CLIENT_ID,
                clientSecret: env.OIDC_CLIENT_SECRET,
                scopes: ["openid", "profile", "email", "groups"],
                pkce: true,
              },
            ],
          }),
        ]
      : []),
    nextCookies(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
