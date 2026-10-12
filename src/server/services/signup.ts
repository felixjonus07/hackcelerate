/**
 * Student self sign-up. Creates the account (role is always `student`, never taken from the request) and the
 * minimal student record the passport and onboarding need, so a new student lands on the onboarding notice.
 *
 * There is no public Better Auth sign-up endpoint (`disableSignUp`): this service is the only way in. It rate-limits
 * by network address, never says whether an email is already registered, and audits every outcome. An anonymous
 * actor is recorded by a hash of the email, never the address itself (AGENTS.md rule 11).
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { audit } from "../audit/log";
import { auth } from "../auth";
import { isDemoEmail, normalizeEmail } from "../auth/demo";
import { emailKey } from "../auth/lockout";
import { redis } from "../cache/redis";
import { db } from "../db";
import { departments, studentIdentities, students, user } from "../db/schema";
import { env, signUpEnabled } from "../env";
import { pseudonymFor } from "../ingestion/pseudonym";

export class SignUpError extends Error {
  constructor(
    readonly code: "closed" | "rate" | "invalid" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  departmentCode: string;
  /** Year of study, 1 to 4. */
  year: number;
}

const GENERIC_FAILURE = "We couldn't create that account. If you already have one, sign in instead.";

const denied = (action: string, email: string, reason: string, ip: string | null) =>
  audit({
    actorUserId: "anonymous",
    actorRole: "none",
    action,
    entityType: "account",
    entityId: emailKey(email),
    purpose: "authentication",
    reason,
    sourceIp: ip,
    result: "denied",
  }).catch(() => undefined);

/** Counts this attempt against the address's hourly allowance; true when it is over the limit. */
async function overLimit(ip: string | null): Promise<boolean> {
  const key = `signup:ip:${createHash("sha256")
    .update(ip ?? "unknown")
    .digest("hex")
    .slice(0, 24)}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 3600);
    return n > env.AUTH_SIGNUP_RATE_PER_HOUR;
  } catch {
    return false; // Redis down: the sign-in rate limits and the unique email still protect the system.
  }
}

export async function signUpStudent(input: SignUpInput, ctx: { ip: string | null }): Promise<{ email: string }> {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();

  if (!signUpEnabled)
    throw new SignUpError("closed", "Sign-up is closed right now. Ask your institution to create your account.");
  if (await overLimit(ctx.ip)) {
    await denied("sign_up.blocked_rate", email, "too many new accounts from one network address", ctx.ip);
    throw new SignUpError("rate", "Too many new accounts were created from this network. Try again in an hour.");
  }

  const [dept] = await db
    .select({ code: departments.code })
    .from(departments)
    .where(eq(departments.code, input.departmentCode))
    .limit(1);
  if (!dept || !Number.isInteger(input.year) || input.year < 1 || input.year > 4) {
    await denied("sign_up.failure", email, "unknown department or year", ctx.ip);
    throw new SignUpError("invalid", "Choose your department and year of study.");
  }
  if (isDemoEmail(email)) {
    await denied("sign_up.failure", email, "reserved demo domain", ctx.ip);
    throw new SignUpError("failed", GENERIC_FAILURE);
  }
  const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (taken) {
    await denied("sign_up.failure", email, "email already registered", ctx.ip);
    throw new SignUpError("failed", GENERIC_FAILURE);
  }

  const ba = await auth.$context;
  const created = await ba.internalAdapter.createUser(
    { email, name, emailVerified: false, role: "student" },
    { method: "email-password" },
  );
  try {
    await ba.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await ba.password.hash(input.password),
    });
    const pseudonymousId = pseudonymFor(`user:${created.id}`, env.BETTER_AUTH_SECRET);
    await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(students)
        .values({
          userId: created.id,
          pseudonymousId,
          departmentCode: dept.code,
          year: input.year,
          // Same convention as the seed: a first-year student graduates in four years.
          batch: String(new Date().getFullYear() + (5 - input.year)),
        })
        .returning({ id: students.id });
      // No roll number yet (the ERP import attaches the real one); a placeholder keeps the identity row unique.
      await tx
        .insert(studentIdentities)
        .values({ studentId: s.id, rollNumber: `SELF-${pseudonymousId.slice(2)}`, displayName: name });
    });
    await audit({
      actorUserId: created.id,
      actorRole: "student",
      action: "sign_up.success",
      entityType: "account",
      entityId: pseudonymousId,
      purpose: "authentication",
      sourceIp: ctx.ip,
      result: "allowed",
    });
  } catch (err) {
    // No half-made account: the credential row goes with the user (cascade).
    await db.delete(user).where(eq(user.id, created.id));
    await denied("sign_up.failure", email, "could not create the student record", ctx.ip);
    throw err;
  }
  return { email };
}
