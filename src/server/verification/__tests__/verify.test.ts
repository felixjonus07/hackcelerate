/** Verification end to end against Postgres: transitions, audit, re-checks, reviewers, flags, sampling. */
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import {
  artifactStatusEvents,
  artifacts,
  auditEvents,
  integrityFlags,
  mockAttempts,
  notifications,
  students,
} from "../../db/schema";
import { submitEvidence } from "../../services/evidence";
import { dbAvailable } from "../../testing/db";
import { assign, insertStudent, insertUser } from "../../testing/fixtures";
import { loadFixture, recordedFetcher } from "../../testing/recorded-fetch";
import { applyTransition } from "../apply";
import { flagDuplicateClaim, flagImplausibleSpeed, flagReusedText } from "../flags";
import { verifyArtifact } from "../index";
import { TransitionError } from "../lifecycle";
import { expireAttestations, queueDueRechecks, sampleExternalMocks, verifyKindFor } from "../recheck";
import { resolveFlag, reviewArtifact, reviewSampledMock } from "../review";

const queued: { name: string; data: { artifactId: string; kind: string }; jobId?: string }[] = [];
vi.mock("../../queue", () => ({
  enqueue: async (name: string, data: never, jobId?: string) => {
    queued.push({ name, data, jobId });
  },
}));

const up = await dbAvailable();
const dir = join(__dirname, "fixtures");
const DAY = 86_400_000;
const repoRoutes = (status: number) => [
  {
    match: /\/repos\/vercel\/next\.js$/,
    reply: status === 200 ? loadFixture(dir, "github-repo-original.json") : loadFixture(dir, "github-404.json"),
  },
  { match: /\/commits/, reply: loadFixture(dir, "github-commits.json") },
];

describe.skipIf(!up)("verification workflow", () => {
  let me: Awaited<ReturnType<typeof insertStudent>>;
  let other: Awaited<ReturnType<typeof insertStudent>>;
  let mentor: Awaited<ReturnType<typeof insertUser>>;
  let advisor: Awaited<ReturnType<typeof insertUser>>;
  let studentUser: Awaited<ReturnType<typeof insertUser>>;
  const uploaded: string[] = [];

  beforeAll(async () => {
    me = await insertStudent(db);
    other = await insertStudent(db);
    mentor = await insertUser(db, "faculty_mentor");
    advisor = await insertUser(db, "class_advisor");
    studentUser = await insertUser(db, "student");
    await assign(db, mentor.id, me.id, "faculty_mentor");
    await assign(db, advisor.id, me.id, "class_advisor");
    await db.update(students).set({ githubLogin: "timneutkens" }).where(eq(students.id, me.id));
  });
  afterAll(async () => {
    const { storage } = await import("../../storage");
    for (const k of uploaded) await storage.delete(k);
  });
  beforeEach(() => {
    queued.length = 0;
  });

  const repo = async (studentId = me.id, url = "https://github.com/vercel/next.js") =>
    (
      await db
        .insert(artifacts)
        .values({
          studentId,
          type: "repository_check",
          component: "build_evidence",
          label: "Repo",
          source: "student",
          sourceUrl: url,
          claimKey: "github:vercel/next.js",
          weight: 2,
        })
        .returning()
    )[0];
  const events = (id: string) =>
    db
      .select()
      .from(artifactStatusEvents)
      .where(eq(artifactStatusEvents.artifactId, id))
      .orderBy(artifactStatusEvents.at);

  it("verifies a repository the student's linked account committed to, with a reasoned event and audit entry", async () => {
    const a = await repo();
    const { fetcher } = recordedFetcher(repoRoutes(200));
    const r = await verifyArtifact(a.id, "github", { fetcher });
    expect(r).toMatchObject({ status: "VERIFIED", changed: true });

    const ev = await events(a.id);
    expect(ev.map((e) => `${e.fromStatus}→${e.toStatus}`)).toEqual(["SUBMITTED→UNDER_CHECK", "UNDER_CHECK→VERIFIED"]);
    expect(ev[1]).toMatchObject({ actorKind: "system" });
    expect(ev[1].reason).toMatch(/commits authored by your linked account/);

    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, a.id));
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(Math.round((+(row.nextCheckAt as Date) - Date.now()) / DAY)).toBe(30); // re-checked every 30 days

    const audit = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, a.id), eq(auditEvents.action, "artifact.status_change")));
    expect(audit).toHaveLength(2);
    expect(audit.find((e) => e.fieldsAccessed.includes("status:UNDER_CHECK->VERIFIED"))).toMatchObject({
      actorRole: "system",
      reason: expect.stringMatching(/GitHub API/),
    });
  });

  it("stays LIVE_UNVERIFIED when the student has not linked a GitHub account", async () => {
    const lonely = await insertStudent(db);
    const a = await repo(lonely.id);
    const { fetcher } = recordedFetcher(repoRoutes(200));
    expect((await verifyArtifact(a.id, "github", { fetcher })).status).toBe("LIVE_UNVERIFIED");
  });

  it("re-checks: one failure makes it STALE, a pass restores it, two failures make it UNVERIFIED", async () => {
    const a = await repo();
    await verifyArtifact(a.id, "github", { fetcher: recordedFetcher(repoRoutes(200)).fetcher });
    const gone = recordedFetcher(repoRoutes(404)).fetcher;
    expect((await verifyArtifact(a.id, "github", { fetcher: gone })).status).toBe("STALE");
    expect((await verifyArtifact(a.id, "github", { fetcher: recordedFetcher(repoRoutes(200)).fetcher })).status).toBe(
      "VERIFIED",
    );
    expect((await verifyArtifact(a.id, "github", { fetcher: gone })).status).toBe("STALE");
    expect((await verifyArtifact(a.id, "github", { fetcher: gone })).status).toBe("UNVERIFIED");
    expect((await events(a.id)).map((e) => e.toStatus)).toEqual([
      "UNDER_CHECK",
      "VERIFIED",
      "STALE",
      "VERIFIED",
      "STALE",
      "UNVERIFIED",
    ]);
  });

  it("an API outage leaves the item where it is and tries again later", async () => {
    const a = await repo();
    const down = recordedFetcher([{ match: /./, reply: { status: 503, body: "" } }]).fetcher;
    const r = await verifyArtifact(a.id, "github", { fetcher: down });
    expect(r).toMatchObject({ status: "UNDER_CHECK", pending: true, changed: false });
    const [row] = await db.select().from(artifacts).where(eq(artifacts.id, a.id));
    expect(+(row.nextCheckAt as Date)).toBeGreaterThan(Date.now());
  });

  it("an unreachable link is retried for 14 days, then becomes UNVERIFIED with the reason", async () => {
    const a = (
      await db
        .insert(artifacts)
        .values({
          studentId: me.id,
          type: "doi_or_preprint",
          component: "research_output",
          label: "Site",
          source: "student",
          sourceUrl: "https://portfolio.example/arjun",
        })
        .returning()
    )[0];
    const dead = recordedFetcher([{ match: /./, reply: { status: 404, body: "" } }]).fetcher;
    const resolver = async () => ["93.184.216.34"];
    const first = await verifyArtifact(a.id, "link", { fetcher: dead, resolver });
    expect(first).toMatchObject({ status: "UNDER_CHECK", pending: true });
    const later = await verifyArtifact(a.id, "link", { fetcher: dead, resolver, now: new Date(Date.now() + 15 * DAY) });
    expect(later).toMatchObject({ status: "UNVERIFIED", changed: true });
    expect((await events(a.id)).at(-1)?.reason).toMatch(/did not respond|not found/);
  });

  it("a link with a bad scheme is refused before any request", async () => {
    const a = (
      await db
        .insert(artifacts)
        .values({
          studentId: me.id,
          type: "doi_or_preprint",
          component: "research_output",
          label: "x",
          source: "student",
          sourceUrl: "ftp://example.org/x",
        })
        .returning()
    )[0];
    const { fetcher, calls } = recordedFetcher([]);
    expect((await verifyArtifact(a.id, "link", { fetcher })).status).toBe("UNVERIFIED");
    expect(calls).toEqual([]);
  });

  it("the transition service refuses moves the lifecycle forbids, and moves the wrong actor may not make", async () => {
    const a = await repo();
    await expect(applyTransition(a.id, "VERIFIED", { kind: "system" }, "skip")).rejects.toBeInstanceOf(TransitionError);
    await applyTransition(a.id, "UNDER_CHECK", { kind: "system" }, "queued");
    await expect(
      applyTransition(a.id, "VERIFIED", { kind: "student", userId: studentUser.id }, "I say so"),
    ).rejects.toThrow(/student cannot set VERIFIED/);
    await expect(applyTransition(a.id, "ATTESTED", { kind: "system" }, "auto")).rejects.toThrow(
      /system cannot set ATTESTED/,
    );
  });

  describe("certificates and letters are attested by a named reviewer", () => {
    const submitCert = async () => {
      const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);
      const a = await submitEvidence(
        me,
        { id: "student-user", role: "student" },
        {
          type: "attested_log",
          label: "Factory log",
          component: "domain_practical_evidence",
          standardItem: "factory_internship_hours",
          file: { bytes: pdf, contentType: "application/pdf" },
        },
      );
      if (a.fileRef) uploaded.push(a.fileRef);
      return a;
    };

    it("an upload goes to private storage and waits for review", async () => {
      const a = await submitCert();
      expect(a.fileRef).toMatch(/^students\//);
      const [row] = await db.select().from(artifacts).where(eq(artifacts.id, a.id));
      expect(row.status).toBe("UNDER_CHECK");
      expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(queued).toEqual([]); // no automatic check for a letter
    });

    it("an assigned reviewer of the named role attests with a reason; it is recorded and audited", async () => {
      const a = await submitCert();
      const row = await reviewArtifact(
        { id: mentor.id, role: "faculty_mentor" },
        a.id,
        "attest",
        "Log signed by the training office",
      );
      expect(row.status).toBe("ATTESTED");
      expect(row.attestedAt).toBeInstanceOf(Date);
      const ev = (await events(a.id)).at(-1);
      expect(ev).toMatchObject({
        toStatus: "ATTESTED",
        actorKind: "reviewer",
        actorUserId: mentor.id,
        reason: "Log signed by the training office",
      });
    });

    it("refuses a reviewer who is not assigned, has the wrong role, or gives no reason", async () => {
      const a = await submitCert();
      const stranger = await insertUser(db, "faculty_mentor");
      await expect(reviewArtifact({ id: stranger.id, role: "faculty_mentor" }, a.id, "attest", "ok")).rejects.toThrow(
        /not assigned/,
      );
      await expect(reviewArtifact({ id: advisor.id, role: "class_advisor" }, a.id, "attest", "ok")).rejects.toThrow(
        /reviewed by the faculty mentor/,
      );
      await expect(reviewArtifact({ id: mentor.id, role: "faculty_mentor" }, a.id, "attest", "  ")).rejects.toThrow(
        /reason is required/,
      );
    });

    it("a rejection records its reason, and the student may resubmit", async () => {
      const a = await submitCert();
      await reviewArtifact({ id: mentor.id, role: "faculty_mentor" }, a.id, "reject", "The signature is missing");
      const [row] = await db.select().from(artifacts).where(eq(artifacts.id, a.id));
      expect(row.status).toBe("REJECTED");
      await applyTransition(
        a.id,
        "SUBMITTED",
        { kind: "student", userId: studentUser.id },
        "Resubmitted with the signed page",
      );
    });

    it("an attestation lapses to STALE after its review period", async () => {
      const a = await submitCert();
      await reviewArtifact({ id: mentor.id, role: "faculty_mentor" }, a.id, "attest", "ok");
      expect(await expireAttestations(new Date(Date.now() + 100 * DAY))).toBeGreaterThanOrEqual(0);
      expect((await db.select().from(artifacts).where(eq(artifacts.id, a.id)))[0].status).toBe("ATTESTED");
      await expireAttestations(new Date(Date.now() + 366 * DAY));
      expect((await db.select().from(artifacts).where(eq(artifacts.id, a.id)))[0].status).toBe("STALE");
    });

    it("rejects a file that is not what it says it is", async () => {
      await expect(
        submitEvidence(
          me,
          { id: "u", role: "student" },
          {
            type: "attested_log",
            label: "x",
            component: "c",
            file: { bytes: new TextEncoder().encode("<html>"), contentType: "application/pdf" },
          },
        ),
      ).rejects.toThrow(/do not match/);
    });

    it("platform and reviewer evidence cannot be submitted by a student", async () => {
      await expect(
        submitEvidence(
          me,
          { id: "u", role: "student" },
          { type: "platform_timed_assessment", label: "x", component: "c" },
        ),
      ).rejects.toThrow(/campus platform/);
    });
  });

  describe("integrity flags (§6.3) ask for a review and change nothing else", () => {
    it("the same repository claimed by two students flags both, once", async () => {
      const a = await repo(me.id, "https://github.com/dup/repo");
      const b = await repo(other.id, "https://github.com/dup/repo");
      await db.update(artifacts).set({ claimKey: "github:dup/repo" }).where(eq(artifacts.id, a.id));
      await db.update(artifacts).set({ claimKey: "github:dup/repo" }).where(eq(artifacts.id, b.id));
      expect(await flagDuplicateClaim(a.id)).toBe(2);
      expect(await flagDuplicateClaim(a.id)).toBe(0); // dedupe key
      const flags = await db.select().from(integrityFlags).where(eq(integrityFlags.check, "duplicate_claim"));
      expect(flags.filter((f) => [a.id, b.id].includes(f.subjectId))).toHaveLength(2);
      // Both keep their status.
      expect((await db.select().from(artifacts).where(eq(artifacts.id, b.id)))[0].status).toBe("SUBMITTED");
    });

    it("identical descriptions in two students' evidence are flagged", async () => {
      const t = "x".repeat(10);
      const hash = "f".repeat(64);
      const [a] = await db
        .insert(artifacts)
        .values({ studentId: me.id, type: "t", component: "c", label: t, source: "s", textHash: hash })
        .returning();
      await db
        .insert(artifacts)
        .values({ studentId: other.id, type: "t", component: "c", label: t, source: "s", textHash: hash });
      expect(await flagReusedText(a.id)).toBe(2);
    });

    it("implausible speed flags a mock and leaves its status alone", async () => {
      const [m] = await db
        .insert(mockAttempts)
        .values({
          studentId: me.id,
          testType: "gs_full",
          items: 50,
          score: 40,
          percentile: 90,
          avgSecondsPerItem: 2,
          itemKind: "mcq",
          source: "campus",
          status: "VERIFIED",
          takenAt: new Date(),
        })
        .returning();
      expect(await flagImplausibleSpeed(me.id)).toBe(1);
      expect((await db.select().from(mockAttempts).where(eq(mockAttempts.id, m.id)))[0].status).toBe("VERIFIED");
    });

    it("resolving a flag needs an assigned reviewer and a stated reason, and tells the student it was reviewed", async () => {
      const [a] = await db
        .insert(artifacts)
        .values({ studentId: me.id, type: "t", component: "c", label: "l", source: "s", textHash: "e".repeat(64) })
        .returning();
      await db
        .insert(artifacts)
        .values({ studentId: other.id, type: "t", component: "c", label: "l", source: "s", textHash: "e".repeat(64) });
      await flagReusedText(a.id);
      const [flag] = await db
        .select()
        .from(integrityFlags)
        .where(and(eq(integrityFlags.subjectId, a.id), eq(integrityFlags.check, "reused_text")));
      await expect(resolveFlag({ id: mentor.id, role: "faculty_mentor" }, flag.id, "")).rejects.toThrow(/reason/);
      await resolveFlag({ id: mentor.id, role: "faculty_mentor" }, flag.id, "Group project; both students contributed");
      expect((await db.select().from(integrityFlags).where(eq(integrityFlags.id, flag.id)))[0]).toMatchObject({
        status: "RESOLVED",
        resolvedBy: mentor.id,
      });
      const n = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.studentId, me.id), eq(notifications.template, "evidence_reviewed")));
      expect(n.length).toBeGreaterThan(0);
    });
  });

  describe("external score reports are sampled each term (§6.2)", () => {
    it("picks about the policy share, the same reports every time, and a mismatch rejects and tells the mentor", async () => {
      const rows = await db
        .insert(mockAttempts)
        .values(
          Array.from({ length: 200 }, (_, i) => ({
            studentId: me.id,
            testType: "entrance",
            items: 50,
            score: 30 + (i % 10),
            percentile: 60,
            avgSecondsPerItem: 40,
            source: "external body",
            status: "SELF_REPORTED" as const,
            takenAt: new Date(),
          })),
        )
        .returning({ id: mockAttempts.id });
      const n = await sampleExternalMocks("2026-07-27");
      expect(n).toBeGreaterThanOrEqual(8); // 10% of 200 is 20; hashing gives some spread
      expect(n).toBeLessThanOrEqual(40);
      expect(await sampleExternalMocks("2026-07-27")).toBe(0); // already sampled this term
      const sampled = await db
        .select()
        .from(mockAttempts)
        .where(and(eq(mockAttempts.studentId, me.id), eq(mockAttempts.status, "SELF_REPORTED")));
      const pick = sampled.find((m) => m.sampledAt);
      expect(pick).toBeDefined();
      expect(rows.length).toBe(200);

      await reviewSampledMock(
        { id: mentor.id, role: "faculty_mentor" },
        (pick as (typeof sampled)[0]).id,
        "MISMATCH",
        "Test body shows 41, not 52",
      );
      expect(
        (
          await db
            .select()
            .from(mockAttempts)
            .where(eq(mockAttempts.id, (pick as (typeof sampled)[0]).id))
        )[0],
      ).toMatchObject({ status: "REJECTED", sampleOutcome: "MISMATCH" });
      const notes = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.template, "mock_report_mismatch"), eq(notifications.studentId, me.id)));
      expect(notes).toHaveLength(1);

      const next = sampled.find((m) => m.sampledAt && m.id !== (pick as (typeof sampled)[0]).id) as (typeof sampled)[0];
      await reviewSampledMock({ id: mentor.id, role: "faculty_mentor" }, next.id, "MATCH", "Matches the score report");
      expect((await db.select().from(mockAttempts).where(eq(mockAttempts.id, next.id)))[0].status).toBe("VERIFIED");
    });
  });

  describe("the re-check scheduler", () => {
    it("queues the right kind of check for what is due, once a day", async () => {
      const a = await repo();
      await db
        .update(artifacts)
        .set({ status: "VERIFIED", nextCheckAt: new Date(Date.now() - 1000) })
        .where(eq(artifacts.id, a.id));
      const doi = (
        await db
          .insert(artifacts)
          .values({
            studentId: me.id,
            type: "doi_or_preprint",
            component: "research_output",
            label: "Paper",
            source: "s",
            sourceUrl: "https://doi.org/10.1038/nature14539",
            status: "UNDER_CHECK",
            nextCheckAt: new Date(Date.now() - 1000),
          })
          .returning()
      )[0];
      expect(await queueDueRechecks()).toBeGreaterThanOrEqual(2);
      expect(queued.find((q) => q.data.artifactId === a.id)?.data.kind).toBe("github");
      expect(queued.find((q) => q.data.artifactId === doi.id)?.data.kind).toBe("crossref");
      expect(queued.every((q) => q.jobId?.startsWith("recheck-"))).toBe(true);
    });
    it("picks the check from the evidence type, then the link", () => {
      const cat = { repository_check: { verifier: "github" }, doi_or_preprint: { verifier: "crossref" } };
      expect(verifyKindFor({ type: "repository_check", sourceUrl: "x" }, cat)).toBe("github");
      expect(verifyKindFor({ type: "doi_or_preprint", sourceUrl: "https://example.org/preprint" }, cat)).toBe("link");
      expect(verifyKindFor({ type: "other", sourceUrl: "https://github.com/a/b" }, {})).toBe("github");
      expect(verifyKindFor({ type: "other", sourceUrl: null }, {})).toBeNull();
    });
  });
});
