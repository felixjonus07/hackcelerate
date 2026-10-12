/** Student self sign-up: the account, the student record, the rules it refuses, and the audit trail. */
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../db";
import { account, auditEvents, departments, studentIdentities, students, user } from "../../db/schema";
import { dbAvailable } from "../../testing/db";
import { SignUpError, signUpStudent } from "../signup";

const up = await dbAvailable();
const run = `${Date.now()}`;
const created: string[] = [];
const email = (n: string) => `signup-${n}-${run}@test.example`;
const ip = (n: string) => `203.0.113.${n}-${run}`; // a separate rate-limit bucket per test

async function anyDepartment() {
  const [d] = await db.select({ code: departments.code }).from(departments).limit(1);
  return d?.code;
}

describe.skipIf(!up)("student sign-up", () => {
  afterAll(async () => {
    if (!created.length) return;
    const users = await db.select({ id: user.id }).from(user).where(inArray(user.email, created));
    const ids = users.map((u) => u.id);
    if (ids.length) {
      await db.delete(students).where(inArray(students.userId, ids));
      await db.delete(user).where(inArray(user.id, ids));
    }
  });

  it("creates a student account with a student record, and never takes a role from the request", async () => {
    const department = await anyDepartment();
    if (!department) return; // a database with no departments cannot sign anyone up
    const e = email("ok");
    created.push(e);
    await signUpStudent(
      {
        name: "  Asha Menon ",
        email: e.toUpperCase(),
        password: "correct horse battery",
        departmentCode: department,
        year: 2,
      },
      { ip: ip("1") },
    );
    const [u] = await db.select().from(user).where(eq(user.email, e)).limit(1);
    expect(u.role).toBe("student");
    expect(u.name).toBe("Asha Menon");
    expect(u.disabledAt).toBeNull();
    const [cred] = await db.select().from(account).where(eq(account.userId, u.id)).limit(1);
    expect(cred.providerId).toBe("credential");
    expect(cred.password).toBeTruthy();
    expect(cred.password).not.toContain("correct horse");
    const [s] = await db.select().from(students).where(eq(students.userId, u.id)).limit(1);
    expect(s).toMatchObject({ departmentCode: department, year: 2, onboardedAt: null, isSynthetic: false });
    expect(s.pseudonymousId).toMatch(/^P-/);
    const [identity] = await db.select().from(studentIdentities).where(eq(studentIdentities.studentId, s.id)).limit(1);
    expect(identity.displayName).toBe("Asha Menon");
    const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, s.pseudonymousId));
    expect(events.map((x) => x.action)).toContain("sign_up.success");
    // The audit trail names the student by pseudonym, never by email.
    expect(JSON.stringify(events)).not.toContain(e);
  });

  it("answers a repeat or reserved address the same way, without saying which it was", async () => {
    const department = await anyDepartment();
    if (!department) return;
    const e = email("dup");
    created.push(e);
    const input = { name: "Ravi K", email: e, password: "another long password", departmentCode: department, year: 1 };
    await signUpStudent(input, { ip: ip("2") });
    const again = await signUpStudent(input, { ip: ip("2") }).catch((x) => x);
    const demo = await signUpStudent({ ...input, email: "student@aspiredge.example" }, { ip: ip("2") }).catch((x) => x);
    expect(again).toBeInstanceOf(SignUpError);
    expect(demo).toBeInstanceOf(SignUpError);
    expect(again.message).toBe(demo.message);
    expect(again.code).toBe("failed");
  });

  it("refuses an unknown department or a year outside 1 to 4", async () => {
    const base = { name: "Meera", password: "a perfectly long pass", departmentCode: "NOPE", year: 2 };
    const a = await signUpStudent({ ...base, email: email("dept") }, { ip: ip("3") }).catch((x) => x);
    expect(a).toMatchObject({ code: "invalid" });
    const department = await anyDepartment();
    if (!department) return;
    const b = await signUpStudent(
      { ...base, departmentCode: department, year: 7, email: email("year") },
      { ip: ip("3") },
    ).catch((x) => x);
    expect(b).toMatchObject({ code: "invalid" });
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(inArray(user.email, [email("dept"), email("year")]));
    expect(rows).toHaveLength(0);
  });

  it("limits how many accounts one network address can create in an hour", async () => {
    const department = await anyDepartment();
    if (!department) return;
    const addr = ip("4");
    const attempts: unknown[] = [];
    for (let i = 0; i < 7; i++) {
      const e = email(`rate${i}`);
      created.push(e);
      attempts.push(
        await signUpStudent(
          { name: "Rate Test", email: e, password: "yet another long pass", departmentCode: department, year: 3 },
          { ip: addr },
        ).catch((x) => x),
      );
    }
    const blocked = attempts.filter((a) => a instanceof SignUpError && a.code === "rate");
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(attempts.slice(0, 5).every((a) => !(a instanceof Error))).toBe(true);
  });
});
