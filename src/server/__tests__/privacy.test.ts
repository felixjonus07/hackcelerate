/** Privacy controls (§9.4, §13.3, §13.4, §13.5): log scrubber, pseudonyms, name redaction, restricted role, retention, erasure, minors. */
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import {
  artifacts,
  attendanceWeeks,
  auditEvents,
  auditEventsArchive,
  cohortAggregates,
  counselingCards,
  evaluations,
  interventions,
  mockAttempts,
  parentalConsents,
  quests,
  rightsRequests,
  students,
} from "../db/schema";
import { pseudonymFor } from "../ingestion/pseudonym";
import { buildFacts, buildMessages, sanitizeUntrusted } from "../llm/prompt";
import { loadPolicyFile } from "../policy/file";
import { evaluate } from "../rules";
import { ME_27 } from "../rules/fixtures";
import { scrubText, scrubValue } from "../scrub";
import { dispatchIntervention } from "../services/dispatch";
import { runEvaluation } from "../services/evaluations";
import { ParentalConsentRequired, parentalState, recordParentalConsent } from "../services/parental";
import { executeErasure, runRetention } from "../services/retention";
import { raiseRequest } from "../services/rights";
import { dbAvailable, failure, inRollback } from "../testing/db";
import { assign, insertEvaluation, insertStudent, insertUser } from "../testing/fixtures";

vi.mock("../queue", () => ({ enqueue: async () => undefined }));
vi.mock("../storage", async (orig) => {
  const real = await orig<typeof import("../storage")>();
  return { ...real, storage: { ...real.storage, delete: async () => undefined } };
});

const up = await dbAvailable();
const policy = loadPolicyFile();
const DAY = 86_400_000;

describe("log scrubber (§13.3)", () => {
  it("removes emails, phone numbers, roll numbers, tokens and cookies from text", () => {
    const t = scrubText(
      "Failed for arjun.kumar@example.com roll SYN26001 phone +91 98765 43210 Bearer abcdef1234567890 cookie better-auth.session_token=abc123xyz; ok",
    );
    expect(t).toBe("Failed for [email] roll [roll] phone [phone] [credential] cookie [cookie]; ok");
    expect(scrubText("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r")).toBe("[token]");
  });

  it("scrubs nested values and error messages, and redacts sensitive keys by name", () => {
    const out = scrubValue({
      a: { email: "x@y.org", note: "mail me at x@y.org", list: ["SYN26001"] },
      err: new Error("bad roll SYN26001"),
      n: 3,
    }) as { a: { email: string; note: string; list: string[] }; err: { message: string }; n: number };
    expect(out.a.email).toBe("[redacted]");
    expect(out.a.note).toBe("mail me at [email]");
    expect(out.a.list).toEqual(["[roll]"]);
    expect(out.err.message).toBe("bad roll [roll]");
    expect(out.n).toBe(3);
    expect(JSON.stringify(out)).not.toMatch(/x@y\.org|SYN26001/);
  });

  it("leaves ordinary text and numbers alone, and survives cycles", () => {
    expect(scrubText("Track score 48.1 against 70 for ME-27")).toBe("Track score 48.1 against 70 for ME-27");
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    expect(() => scrubValue(cyc)).not.toThrow();
  });

  it("a logger built the way ours is writes nothing personal", async () => {
    const lines: string[] = [];
    const { default: pino } = await import("pino");
    const l = pino(
      {
        formatters: { log: (o) => scrubValue(o) as Record<string, unknown> },
        hooks: {
          logMethod(args, m) {
            m.apply(this, args.map((a) => (typeof a === "string" ? scrubText(a) : a)) as typeof args);
          },
        },
      },
      { write: (s: string) => void lines.push(s) } as never,
    );
    l.info({ detail: "from SYN26001 via a@b.org" }, "login for a@b.org failed");
    expect(lines.join("")).not.toMatch(/SYN26001|a@b\.org/);
  });
});

describe("pseudonymous IDs (§4.1)", () => {
  const secret = "a-long-enough-secret-value";
  it("is stable, keyed and not derived from the roll number", () => {
    const a = pseudonymFor("SYN26001", secret);
    expect(a).toMatch(/^P-[A-HJ-NP-Z2-9]{10}$/);
    expect(pseudonymFor(" syn26001 ", secret)).toBe(a);
    expect(pseudonymFor("SYN26002", secret)).not.toBe(a);
    expect(pseudonymFor("SYN26001", `${secret}-other`)).not.toBe(a);
    expect(a).not.toContain("26001");
    expect(() => pseudonymFor("SYN26001", "short")).toThrow();
  });
});

describe("what a model request carries (§9.4)", () => {
  it("never holds the student's name, roll number, email or phone, even when they typed them", () => {
    const text = "I am Arjun Kumar (roll SYN26001), mail arjun@example.com or call +91 98765 43210. Built a gearbox.";
    const s = sanitizeUntrusted(text, 1000, ["Arjun", "Kumar"]);
    expect(s.text).not.toMatch(/Arjun|Kumar|SYN26001|arjun@|98765/);
    expect(s.text).toContain("Built a gearbox");
    const input = {
      evaluationId: "e",
      pseudonymousId: "ME-27",
      departmentName: "Mechanical",
      redactNames: ["Arjun", "Kumar"],
      evaluation: evaluate(ME_27, policy),
      evidence: ME_27.evidence.map((e) => ({ ...e, description: text })),
      remediation: [],
    };
    const { layer } = buildFacts(input, policy);
    const prompt = buildMessages(layer, policy)
      .map((m) => m.content)
      .join("\n");
    expect(prompt).not.toMatch(/Arjun|Kumar|SYN26001|arjun@example|98765/);
    expect(prompt).toContain("ME-27"); // the pseudonymous ID is what goes
  });
});

describe.skipIf(!up)("restricted roll numbers (§4.1)", () => {
  it("the analytics role reads the student record but not the roll numbers or names", async () => {
    await insertStudent(db);
    await inRollback(async (tx) => {
      await tx.execute(sql`set local role aspiredge_analytics`);
      expect((await tx.execute<{ n: number }>(sql`select count(*)::int as n from students`))[0].n).toBeGreaterThan(0);
      expect(await failure(tx.transaction((t) => t.execute(sql`select roll_number from student_identities`)))).toMatch(
        /permission denied/,
      );
      expect(await failure(tx.transaction((t) => t.execute(sql`select email from "user"`)))).toMatch(
        /permission denied/,
      );
      expect(await failure(tx.transaction((t) => t.execute(sql`select * from demographic_profiles`)))).toMatch(
        /permission denied/,
      );
      expect(await failure(tx.transaction((t) => t.execute(sql`update students set year = 1`)))).toMatch(
        /permission denied/,
      );
    });
  });
});

describe.skipIf(!up)("students under 18 (§4.3, §13.4)", () => {
  let registrar: Awaited<ReturnType<typeof insertUser>>;
  beforeAll(async () => {
    registrar = await insertUser(db, "registrar");
  });
  const minor = () => insertStudent(db, { dateOfBirth: "2009-05-01", year: 1 });
  const now = new Date("2026-10-11T00:00:00Z");

  it("an adult needs nothing; a minor is pending until the registrar verifies the guardian", async () => {
    const adult = await insertStudent(db, { dateOfBirth: "2000-05-01" });
    expect(await parentalState(adult.id, now)).toEqual({ minor: false, status: "NOT_REQUIRED" });
    const m = await minor();
    expect(await parentalState(m.id, now)).toEqual({ minor: true, status: "PENDING" });
  });

  it("no evaluation runs for a minor without verified consent; it runs once recorded, and stops if revoked", async () => {
    const m = await minor();
    await expect(runEvaluation(m.id, { now })).rejects.toBeInstanceOf(ParentalConsentRequired);
    expect(await db.select().from(evaluations).where(eq(evaluations.studentId, m.id))).toHaveLength(0);
    await expect(recordParentalConsent({ id: "x", role: "dean" }, m.id, "verify", "form")).rejects.toThrow(
      /Only the registrar/,
    );
    await expect(recordParentalConsent({ id: registrar.id, role: "registrar" }, m.id, "verify", " ")).rejects.toThrow(
      /how the guardian/,
    );
    await recordParentalConsent(
      { id: registrar.id, role: "registrar" },
      m.id,
      "verify",
      "Signed form checked against the admission record",
      now,
    );
    expect((await db.select().from(parentalConsents).where(eq(parentalConsents.studentId, m.id)))[0]).toMatchObject({
      status: "VERIFIED",
      verifiedBy: registrar.id,
    });
    expect((await runEvaluation(m.id, { now })).id).toBeTruthy();
    await recordParentalConsent(
      { id: registrar.id, role: "registrar" },
      m.id,
      "revoke",
      "Guardian withdrew consent",
      now,
    );
    await expect(runEvaluation(m.id, { now })).rejects.toBeInstanceOf(ParentalConsentRequired);
  });

  it("an approved proposal for a minor is not sent before consent", async () => {
    const m = await minor();
    const ev = await insertEvaluation(db, m.id, ME_27);
    const [i] = await db
      .insert(interventions)
      .values({
        studentId: m.id,
        evaluationId: ev.id,
        routeKey: "aspiration_mismatch",
        recipientRole: "faculty_mentor",
        approverRole: "faculty_mentor",
        status: "APPROVED",
        proposedMessage: "m",
        slaDueAt: now,
        closureRule: "c",
      })
      .returning();
    expect(await dispatchIntervention(i.id, now)).toMatchObject({ status: "BLOCKED" });
    expect((await db.select().from(interventions).where(eq(interventions.id, i.id)))[0].status).toBe("APPROVED");
  });
});

describe.skipIf(!up)("retention jobs (§13.5)", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  const old = (days: number) => new Date(now.getTime() - days * DAY);

  it("replaces old ERP weeks, removes verified files after 90 days, clears raw answers, and keeps what is within its period", async () => {
    const s = await insertStudent(db);
    await db.insert(attendanceWeeks).values([
      { studentId: s.id, course: "A", weekStart: "2024-01-01", classesHeld: 10, classesAttended: 9 },
      { studentId: s.id, course: "A", weekStart: "2026-10-05", classesHeld: 10, classesAttended: 9 },
    ]);
    const [oldFile, newFile] = await db
      .insert(artifacts)
      .values([
        {
          studentId: s.id,
          type: "t",
          component: "c",
          label: "old",
          source: "s",
          status: "ATTESTED",
          attestedAt: old(120),
          fileRef: "students/x/old",
          details: {},
        },
        {
          studentId: s.id,
          type: "t",
          component: "c",
          label: "new",
          source: "s",
          status: "ATTESTED",
          attestedAt: old(10),
          fileRef: "students/x/new",
          details: {},
        },
      ])
      .returning();
    const [oldMock, newMock] = await db
      .insert(mockAttempts)
      .values([
        {
          studentId: s.id,
          testType: "t",
          items: 1,
          score: 1,
          percentile: 1,
          avgSecondsPerItem: 1,
          source: "s",
          status: "VERIFIED",
          takenAt: old(500),
          rawAnswers: { a: 1 },
        },
        {
          studentId: s.id,
          testType: "t",
          items: 1,
          score: 1,
          percentile: 1,
          avgSecondsPerItem: 1,
          source: "s",
          status: "VERIFIED",
          takenAt: old(20),
          rawAnswers: { a: 1 },
        },
      ])
      .returning();

    const dry = await runRetention(now, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.attendanceWeeks).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(attendanceWeeks).where(eq(attendanceWeeks.studentId, s.id))).toHaveLength(2); // a dry run changes nothing

    await runRetention(now);
    expect(
      (await db.select().from(attendanceWeeks).where(eq(attendanceWeeks.studentId, s.id))).map((w) =>
        String(w.weekStart),
      ),
    ).toEqual(["2026-10-05"]);
    const a = await db.select().from(artifacts).where(eq(artifacts.studentId, s.id));
    expect(a.find((x) => x.id === oldFile.id)).toMatchObject({ fileRef: null, status: "ATTESTED" }); // the outcome stays
    expect(a.find((x) => x.id === oldFile.id)?.details).toHaveProperty("fileDeletedAt");
    expect(a.find((x) => x.id === newFile.id)?.fileRef).toBe("students/x/new");
    const m = await db.select().from(mockAttempts).where(eq(mockAttempts.studentId, s.id));
    expect(m.find((x) => x.id === oldMock.id)).toMatchObject({ rawAnswers: null, percentile: 1 }); // scores stay
    expect(m.find((x) => x.id === newMock.id)?.rawAnswers).toEqual({ a: 1 });
  });

  it("deletes evaluations 12 months after graduation but keeps aggregates, and keeps one a retained record depends on", async () => {
    const grad = await insertStudent(db, { graduatedOn: "2025-06-01" });
    const e1 = await insertEvaluation(db, grad.id, ME_27);
    const e2 = await insertEvaluation(db, grad.id, ME_27);
    await db.insert(interventions).values({
      studentId: grad.id,
      evaluationId: e2.id,
      routeKey: "aspiration_mismatch",
      recipientRole: "faculty_mentor",
      approverRole: "faculty_mentor",
      status: "DISPATCHED",
      proposedMessage: "m",
      slaDueAt: now,
      closureRule: "c",
    });
    const current = await insertStudent(db, { graduatedOn: "2026-06-01" });
    const keep = await insertEvaluation(db, current.id, ME_27);
    const r = await runRetention(now);
    expect(r.aggregatesWritten).toBeGreaterThanOrEqual(1);
    const left = (
      await db.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.studentId, grad.id))
    ).map((x) => x.id);
    expect(left).toEqual([e2.id]); // e1 deleted; e2 stays with its intervention
    expect(left).not.toContain(e1.id);
    expect(await db.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.id, keep.id))).toHaveLength(
      1,
    ); // graduated under a year ago
    expect((await db.select().from(cohortAggregates)).some((a) => a.department === "MECH")).toBe(true);
  });

  it("deletes interventions three years after closure and archives audit events older than seven years", async () => {
    const s = await insertStudent(db);
    const ev = await insertEvaluation(db, s.id, ME_27);
    const [card] = await db
      .insert(counselingCards)
      .values({ studentId: s.id, mentorUserId: (await insertUser(db, "faculty_mentor")).id })
      .returning();
    const base = {
      studentId: s.id,
      evaluationId: ev.id,
      routeKey: "x",
      recipientRole: "faculty_mentor",
      approverRole: "faculty_mentor",
      status: "CLOSED",
      proposedMessage: "m",
      closureRule: "c",
    } as const;
    const [oldClosed, recentClosed] = await db
      .insert(interventions)
      .values([
        { ...base, slaDueAt: old(2000), decidedAt: old(1500) },
        { ...base, slaDueAt: old(100), decidedAt: old(90) },
      ])
      .returning();
    await db.update(counselingCards).set({ interventionId: oldClosed.id }).where(eq(counselingCards.id, card.id));
    const [ancient] = await db
      .insert(auditEvents)
      .values({
        actorUserId: "t",
        actorRole: "t",
        action: "ancient",
        entityType: "x",
        entityId: "1",
        purpose: "t",
        policyVersion: "t",
        result: "allowed",
        at: old(3000),
      })
      .returning();
    await runRetention(now);
    expect((await db.select().from(interventions).where(eq(interventions.studentId, s.id))).map((i) => i.id)).toEqual([
      recentClosed.id,
    ]);
    expect(
      (await db.select().from(counselingCards).where(eq(counselingCards.id, card.id)))[0].interventionId,
    ).toBeNull();
    expect(await db.select().from(auditEvents).where(eq(auditEvents.id, ancient.id))).toHaveLength(0);
    expect((await db.select().from(auditEventsArchive).where(eq(auditEventsArchive.id, ancient.id)))[0]).toMatchObject({
      action: "ancient",
    });
    // The archive is append-only as well.
    expect(await failure(db.execute(sql`delete from audit_events_archive where id = ${ancient.id}`))).toMatch(
      /append-only/,
    );
  });
});

describe.skipIf(!up)("erasure on request (§13.7)", () => {
  it("erases what the schedule lets go of, keeps the audit trail and consent history, and explains both in writing", async () => {
    const registrar = await insertUser(db, "registrar");
    const u = await insertUser(db, "student");
    const s = await insertStudent(db, { userId: u.id, cgpa: 8, attendancePct: 90 });
    await assign(db, (await insertUser(db, "faculty_mentor")).id, s.id, "faculty_mentor");
    await db
      .insert(attendanceWeeks)
      .values({ studentId: s.id, course: "A", weekStart: "2026-10-05", classesHeld: 10, classesAttended: 9 });
    await db.insert(artifacts).values({
      studentId: s.id,
      type: "t",
      component: "c",
      label: "cert",
      source: "s",
      status: "ATTESTED",
      fileRef: "students/x/y",
    });
    const ev = await insertEvaluation(db, s.id, ME_27);
    const ev2 = await insertEvaluation(db, s.id, ME_27);
    await db.insert(quests).values({
      studentId: s.id,
      evaluationId: ev.id,
      title: "q",
      action: "a",
      targetDays: 14,
      requiredEvidenceType: "internal_test",
    });
    await db.insert(interventions).values({
      studentId: s.id,
      evaluationId: ev2.id,
      routeKey: "x",
      recipientRole: "faculty_mentor",
      approverRole: "faculty_mentor",
      status: "CLOSED",
      proposedMessage: "m",
      slaDueAt: new Date(),
      closureRule: "c",
    });

    const req = await raiseRequest(s, { id: u.id, role: "student" }, { kind: "erasure" });
    await expect(executeErasure({ id: u.id, role: "student" }, req.id)).rejects.toThrow(/Only the registrar/);
    const out = await executeErasure({ id: registrar.id, role: "registrar" }, req.id);
    expect(out.outcome).toMatch(/Erased: .*copies of your university records.*1 uploaded file.*1 score/);
    expect(out.outcome).toMatch(/Kept, and why:.*audit/i);
    expect(await db.select().from(attendanceWeeks).where(eq(attendanceWeeks.studentId, s.id))).toHaveLength(0);
    expect(await db.select().from(artifacts).where(eq(artifacts.studentId, s.id))).toHaveLength(0);
    expect((await db.select().from(students).where(eq(students.id, s.id)))[0]).toMatchObject({
      cgpa: null,
      attendancePct: null,
    });
    // The evaluation a retained support record depends on stays with it; the other goes.
    expect(
      (await db.select({ id: evaluations.id }).from(evaluations).where(eq(evaluations.studentId, s.id))).map(
        (e) => e.id,
      ),
    ).toEqual([ev2.id]);
    expect((await db.select().from(rightsRequests).where(eq(rightsRequests.id, req.id)))[0]).toMatchObject({
      status: "RESOLVED",
      resolvedBy: registrar.id,
    });
    expect(
      await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, req.id), eq(auditEvents.action, "rights.erasure.execute"))),
    ).toHaveLength(1);
    await expect(executeErasure({ id: registrar.id, role: "registrar" }, req.id)).rejects.toThrow(
      /not an open erasure/,
    );
  });
});
