/**
 * User administration for the registrar: find people, add staff, change a role, turn an account on or off, and
 * sign someone out everywhere. Every change writes an audit event, ends the affected sessions (Redis caches the
 * role with the session) and refuses the moves that could lock the institution out of its own admin.
 */
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { auth } from "../auth";
import { isDemoEmail, normalizeEmail } from "../auth/demo";
import { revokeUserSessions } from "../auth/revoke";
import { STAFF_ROLES } from "../auth/roles";
import { db } from "../db";
import { user } from "../db/schema";
import type { Role } from "../db/schema/enums";

export class UserAdminError extends Error {}

export const USER_PAGE_SIZE = 25;

type Actor = { id: string; role: string };

export interface UserQuery {
  q?: string;
  role?: Role;
  status?: "active" | "off";
  page?: number;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  off: boolean;
  createdAt: Date;
  /** Has a student record: the role stays "student". */
  isStudent: boolean;
}

function assertRegistrar(actor: Actor) {
  if (actor.role !== "registrar") throw new UserAdminError("Only the registrar can manage user accounts.");
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const record = (actor: Actor, action: string, target: { id: string }, reason?: string) =>
  audit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action,
    entityType: "user",
    entityId: target.id,
    purpose: "user_administration",
    reason,
    result: "allowed",
  });

/** Reading the directory is a read of personal data, so it is audited like any other (§13.6). */
export async function listUsers(actor: Actor, query: UserQuery) {
  assertRegistrar(actor);
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const q = query.q?.trim();
  const where = and(
    q ? or(ilike(user.name, `%${escapeLike(q)}%`), ilike(user.email, `%${escapeLike(q)}%`)) : undefined,
    query.role ? eq(user.role, query.role) : undefined,
    query.status === "active" ? isNull(user.disabledAt) : undefined,
    query.status === "off" ? isNotNull(user.disabledAt) : undefined,
  );
  const [{ n }] = await db.select({ n: count() }).from(user).where(where);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      disabledAt: user.disabledAt,
      createdAt: user.createdAt,
      isStudent: sql<boolean>`exists (select 1 from students s where s.user_id = "user"."id")`,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt), asc(user.email))
    .limit(USER_PAGE_SIZE)
    .offset((page - 1) * USER_PAGE_SIZE);
  await audit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: "users.list",
    entityType: "user_directory",
    entityId: "all",
    purpose: "user_administration",
    reason: [q && "search", query.role && `role ${query.role}`, query.status && `status ${query.status}`]
      .filter(Boolean)
      .join(", "),
    fieldsAccessed: ["name", "email", "role", "status"],
    result: "allowed",
  });
  return {
    page,
    total: n,
    pages: Math.max(1, Math.ceil(n / USER_PAGE_SIZE)),
    rows: rows.map<UserRow>((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      off: r.disabledAt != null,
      createdAt: r.createdAt,
      isStudent: Boolean(r.isStudent),
    })),
  };
}

async function load(id: string) {
  const [u] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      disabledAt: user.disabledAt,
      isStudent: sql<boolean>`exists (select 1 from students s where s.user_id = "user"."id")`,
    })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  if (!u) throw new UserAdminError("That account no longer exists.");
  return { ...u, isStudent: Boolean(u.isStudent) };
}

/** True when some other registrar can still sign in, so the last one is never removed or turned off. */
async function anotherRegistrar(exceptId: string) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(user)
    .where(and(eq(user.role, "registrar"), isNull(user.disabledAt), ne(user.id, exceptId)));
  return n > 0;
}

export async function createStaffUser(
  actor: Actor,
  input: { name: string; email: string; role: Role; password: string },
) {
  assertRegistrar(actor);
  const email = normalizeEmail(input.email);
  if (!STAFF_ROLES.includes(input.role)) throw new UserAdminError("Choose a staff role. Students sign up themselves.");
  if (isDemoEmail(email)) throw new UserAdminError("That email domain is reserved for the demo accounts.");
  const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (taken) throw new UserAdminError("That email already has an account.");
  const ba = await auth.$context;
  const created = await ba.internalAdapter.createUser(
    { email, name: input.name.trim(), emailVerified: true, role: input.role },
    { method: "admin" },
  );
  await ba.internalAdapter.linkAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: await ba.password.hash(input.password),
  });
  await record(actor, "user.created", created, `role ${input.role}`);
  return created.id;
}

export async function changeRole(actor: Actor, userId: string, role: Role) {
  assertRegistrar(actor);
  const target = await load(userId);
  if (target.id === actor.id) throw new UserAdminError("You can't change your own role.");
  if (target.isStudent || target.role === "student")
    throw new UserAdminError("Student accounts keep the student role. Add a staff account for them instead.");
  if (!STAFF_ROLES.includes(role)) throw new UserAdminError("Choose a staff role.");
  if (target.role === role) throw new UserAdminError("That account already has this role.");
  if (target.role === "registrar" && !target.disabledAt && !(await anotherRegistrar(target.id)))
    throw new UserAdminError("Keep at least one active registrar. Add another one first.");
  await db.update(user).set({ role, updatedAt: new Date() }).where(eq(user.id, target.id));
  await revokeUserSessions(target.id);
  await record(actor, "user.role_changed", target, `${target.role} to ${role}`);
}

export async function setDisabled(actor: Actor, userId: string, off: boolean) {
  assertRegistrar(actor);
  const target = await load(userId);
  if (target.id === actor.id) throw new UserAdminError("You can't turn off your own account.");
  if (off && target.disabledAt) throw new UserAdminError("That account is already turned off.");
  if (!off && !target.disabledAt) throw new UserAdminError("That account is already on.");
  if (off && target.role === "registrar" && !(await anotherRegistrar(target.id)))
    throw new UserAdminError("Keep at least one active registrar. Add another one first.");
  await db
    .update(user)
    .set({ disabledAt: off ? new Date() : null, updatedAt: new Date() })
    .where(eq(user.id, target.id));
  if (off) await revokeUserSessions(target.id);
  await record(actor, off ? "user.disabled" : "user.enabled", target);
}

export async function signOutEverywhere(actor: Actor, userId: string) {
  assertRegistrar(actor);
  const target = await load(userId);
  const ended = await revokeUserSessions(target.id);
  await record(actor, "user.sessions_revoked", target, `${ended} session${ended === 1 ? "" : "s"} ended`);
  return ended;
}
