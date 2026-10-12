/** Registrar user administration: who may do what, the lock-out guards, and that sessions really end. */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redisSecondaryStorage } from "../../auth/storage";
import { db } from "../../db";
import { auditEvents, session, user } from "../../db/schema";
import { dbAvailable } from "../../testing/db";
import { insertStudent, insertUser } from "../../testing/fixtures";
import { changeRole, createStaffUser, listUsers, setDisabled, signOutEverywhere, UserAdminError } from "../users";

const up = await dbAvailable();
const run = `${Date.now()}`;

async function openSession(userId: string) {
  const id = crypto.randomUUID();
  const token = `tok-${id}`;
  await db.insert(session).values({ id, token, userId, expiresAt: new Date(Date.now() + 3_600_000) });
  await redisSecondaryStorage.set(token, JSON.stringify({ user: { id: userId } }), 3600);
  return { id, token };
}

describe.skipIf(!up)("user administration", () => {
  let registrar: { id: string; role: string };
  let otherRegistrar: { id: string; role: string };
  let mentor: { id: string; role: string };
  const made: string[] = [];

  beforeAll(async () => {
    registrar = { ...(await insertUser(db, "registrar")), role: "registrar" };
    otherRegistrar = { ...(await insertUser(db, "registrar")), role: "registrar" };
    mentor = { ...(await insertUser(db, "faculty_mentor")), role: "faculty_mentor" };
  });
  afterAll(async () => {
    for (const id of made) await db.delete(user).where(eq(user.id, id));
  });

  it("is for the registrar only", async () => {
    await expect(listUsers(mentor, {})).rejects.toBeInstanceOf(UserAdminError);
    await expect(changeRole(mentor, registrar.id, "dean")).rejects.toBeInstanceOf(UserAdminError);
    await expect(setDisabled(mentor, registrar.id, true)).rejects.toBeInstanceOf(UserAdminError);
    await expect(
      createStaffUser(mentor, { name: "X Y", email: `x-${run}@test.example`, role: "dean", password: "x".repeat(12) }),
    ).rejects.toBeInstanceOf(UserAdminError);
  });

  it("lists and filters people, and audits the read", async () => {
    const staff = await insertUser(db, "dean", `findme-${run}@test.example`);
    const res = await listUsers(registrar, { q: `findme-${run}`, role: "dean", status: "active" });
    expect(res.total).toBe(1);
    expect(res.rows[0]).toMatchObject({ id: staff.id, role: "dean", off: false, isStudent: false });
    // A "%" in the search is text, not a wildcard.
    expect(
      (await listUsers(registrar, { q: "%" })).rows.every((r) => r.name.includes("%") || r.email.includes("%")),
    ).toBe(true);
    const reads = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, registrar.id), eq(auditEvents.action, "users.list")));
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it("adds a staff member who can sign in, and refuses students, duplicates and the demo domain", async () => {
    const email = `new-advisor-${run}@test.example`;
    const id = await createStaffUser(registrar, {
      name: "New Advisor",
      email,
      role: "class_advisor",
      password: "twelve chars!!",
    });
    made.push(id);
    const [u] = await db.select().from(user).where(eq(user.id, id)).limit(1);
    expect(u).toMatchObject({ role: "class_advisor", emailVerified: true });
    const base = { name: "Someone", password: "twelve chars!!" };
    await expect(createStaffUser(registrar, { ...base, email, role: "dean" })).rejects.toThrow(
      "already has an account",
    );
    await expect(
      createStaffUser(registrar, { ...base, email: `s-${run}@test.example`, role: "student" }),
    ).rejects.toThrow("staff role");
    await expect(createStaffUser(registrar, { ...base, email: "x@aspiredge.example", role: "dean" })).rejects.toThrow(
      "reserved",
    );
    const log = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "user.created")));
    expect(log).toHaveLength(1);
  });

  it("changes a role, ends the person's sessions, and records it", async () => {
    const target = await insertUser(db, "faculty_mentor");
    const s = await openSession(target.id);
    await changeRole(registrar, target.id, "hod");
    const [u] = await db.select().from(user).where(eq(user.id, target.id)).limit(1);
    expect(u.role).toBe("hod");
    expect(await redisSecondaryStorage.get(s.token)).toBeNull();
    const [row] = await db.select().from(session).where(eq(session.id, s.id)).limit(1);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    const [log] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, target.id), eq(auditEvents.action, "user.role_changed")));
    expect(log.reason).toBe("faculty_mentor to hod");
  });

  it("will not change your own role, a student's role, or a role to the same value", async () => {
    await expect(changeRole(registrar, registrar.id, "dean")).rejects.toThrow("your own role");
    const stuUser = await insertUser(db, "student");
    await insertStudent(db, { userId: stuUser.id });
    await expect(changeRole(registrar, stuUser.id, "dean")).rejects.toThrow("keep the student role");
    const t = await insertUser(db, "dean");
    await expect(changeRole(registrar, t.id, "dean")).rejects.toThrow("already has this role");
    await expect(changeRole(registrar, "no-such-user", "dean")).rejects.toThrow("no longer exists");
  });

  it("lets a registrar step down only while another active registrar exists", async () => {
    // otherRegistrar is active, so registrar may demote them; the guard counts active registrars besides the target.
    await changeRole(registrar, otherRegistrar.id, "auditor");
    await changeRole(registrar, otherRegistrar.id, "registrar");
    const [u] = await db.select().from(user).where(eq(user.id, otherRegistrar.id)).limit(1);
    expect(u.role).toBe("registrar");
  });

  it("turns an account off and on, signing it out each time it is turned off", async () => {
    const target = await insertUser(db, "placement_officer");
    const s = await openSession(target.id);
    await expect(setDisabled(registrar, registrar.id, true)).rejects.toThrow("your own account");
    await setDisabled(registrar, target.id, true);
    const [off] = await db.select().from(user).where(eq(user.id, target.id)).limit(1);
    expect(off.disabledAt).toBeInstanceOf(Date);
    expect(await redisSecondaryStorage.get(s.token)).toBeNull();
    await expect(setDisabled(registrar, target.id, true)).rejects.toThrow("already turned off");
    await setDisabled(registrar, target.id, false);
    const [on] = await db.select().from(user).where(eq(user.id, target.id)).limit(1);
    expect(on.disabledAt).toBeNull();
    await expect(setDisabled(registrar, target.id, false)).rejects.toThrow("already on");
    const actions = (await db.select().from(auditEvents).where(eq(auditEvents.entityId, target.id))).map(
      (e) => e.action,
    );
    expect(actions).toEqual(expect.arrayContaining(["user.disabled", "user.enabled"]));
  });

  it("signs someone out of every session on request", async () => {
    const target = await insertUser(db, "alumni_mentor");
    const a = await openSession(target.id);
    const b = await openSession(target.id);
    expect(await signOutEverywhere(registrar, target.id)).toBe(2);
    expect(await redisSecondaryStorage.get(a.token)).toBeNull();
    expect(await redisSecondaryStorage.get(b.token)).toBeNull();
    expect(await signOutEverywhere(registrar, target.id)).toBe(2); // rows are kept for audit, just expired
  });
});
