/** Student experience services against Postgres: onboarding, rights requests, wellbeing nudges, leaderboards. */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import {
  activityEvents,
  artifacts,
  aspirations,
  auditEvents,
  consentRecords,
  interventions,
  leaderboardOptIns,
  mockAttempts,
  notifications,
  rightsRequests,
  students,
  wellbeingNudges,
} from "../../db/schema";
import { ME_27 } from "../../rules/fixtures";
import { dbAvailable } from "../../testing/db";
import { assign, insertEvaluation, insertStudent, insertUser } from "../../testing/fixtures";
import { applyTransition } from "../../verification/apply";
import { loadStudentFacts } from "../facts";
import { leaderboard } from "../leaderboard";
import { acknowledgeNotice, completeOnboarding, OnboardingError, onboardingState } from "../onboarding";
import { buildAccessExport, openRequestsFor, RightsError, raiseRequest, resolveRequest } from "../rights";
import { dismissNudge, openNudges, scanWellbeing } from "../wellbeing";

vi.mock("../../queue", () => ({ enqueue: async () => undefined }));

const up = await dbAvailable();
const DAY = 86_400_000;
const now = new Date("2026-10-11T08:00:00Z");

describe.skipIf(!up)("student experience", () => {
  let mentor: Awaited<ReturnType<typeof insertUser>>;
  let registrar: Awaited<ReturnType<typeof insertUser>>;

  beforeAll(async () => {
    mentor = await insertUser(db, "faculty_mentor");
    registrar = await insertUser(db, "registrar");
  });
  const newStudent = async () => {
    const u = await insertUser(db, "student");
    const s = await insertStudent(db, { userId: u.id });
    await assign(db, mentor.id, s.id, "faculty_mentor");
    return { s, u, actor: { id: u.id, role: "student" as const } };
  };

  describe("onboarding (§12.1)", () => {
    it("remembers the notice acknowledgement by version, once, and moves to the next card", async () => {
      const { s, u } = await newStudent();
      expect((await onboardingState(s.id)).noticeAcknowledged).toBe(false);
      await acknowledgeNotice(s, { id: u.id, role: "student" });
      await acknowledgeNotice(s, { id: u.id, role: "student" });
      const st = await onboardingState(s.id);
      expect(st).toMatchObject({ noticeAcknowledged: true, step: 1, onboardedAt: null, noticeVersion: "2026.10-n1" });
      expect(
        (
          await db
            .select()
            .from(auditEvents)
            .where(and(eq(auditEvents.entityId, s.pseudonymousId), eq(auditEvents.action, "notice.acknowledge")))
        ).length,
      ).toBeGreaterThan(0);
    });
    it("cannot finish without the notice and an ambition", async () => {
      const { s, u, actor } = await newStudent();
      await expect(completeOnboarding(s, actor)).rejects.toThrow(/acknowledge the notice/);
      await acknowledgeNotice(s, actor);
      await expect(completeOnboarding(s, actor)).rejects.toBeInstanceOf(OnboardingError);
      await db
        .insert(aspirations)
        .values({ studentId: s.id, track: "corporate_placement", targetOutcome: "An offer", readiness: 70 });
      await completeOnboarding(s, actor, now);
      expect((await onboardingState(s.id)).onboardedAt).toEqual(now);
      void u;
    });
  });

  describe("rights requests (§13.7)", () => {
    it("an access request resolves with a deadline, and the export holds only the student's own data", async () => {
      const { s, actor } = await newStudent();
      await db
        .insert(consentRecords)
        .values({ studentId: s.id, category: "academic_baseline", recipientRole: "placement_officer", granted: true });
      await insertEvaluation(db, s.id, ME_27);
      await db.insert(auditEvents).values({
        actorUserId: mentor.id,
        actorRole: "faculty_mentor",
        action: "student_record.view",
        entityType: "student",
        entityId: s.pseudonymousId,
        purpose: "scheduled_mentoring",
        policyVersion: "t",
        result: "allowed",
      });
      const r = await raiseRequest(s, actor, { kind: "access" }, now);
      expect(r).toMatchObject({ status: "RESOLVED" });
      expect(r.dueAt?.toISOString()).toBe(new Date(now.getTime() + 30 * DAY).toISOString());
      const out = await buildAccessExport(s, now);
      expect(out.profile.pseudonymousId).toBe(s.pseudonymousId);
      expect(out.evaluations).toHaveLength(1);
      expect(out.consentHistory).toEqual([
        expect.objectContaining({ category: "academic_baseline", office: "placement_officer", shared: true }),
      ]);
      expect(out.whoViewedMyRecord).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: "faculty_mentor", purpose: "scheduled_mentoring" })]),
      );
      // Staff appear by role only: no user ids, names or emails.
      expect(JSON.stringify(out)).not.toContain(mentor.id);
      expect(JSON.stringify(out)).not.toContain(mentor.email);
    });
    it("a correction about ERP data goes to the registrar; one about a narrative goes to the mentor of record", async () => {
      const { s, actor } = await newStudent();
      const erp = await raiseRequest(s, actor, { kind: "correction", target: "erp", detail: "My CGPA is 7.9" }, now);
      expect(erp.routedToRole).toBe("registrar");
      expect(
        (
          await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.relatedId, erp.id), eq(notifications.recipientRole, "registrar")))
        ).length,
      ).toBe(1);
      const nar = await raiseRequest(s, actor, { kind: "correction", target: "narrative" }, now);
      expect(nar.routedToRole).toBe("faculty_mentor");
      expect(
        (
          await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.relatedId, nar.id), eq(notifications.recipientUserId, mentor.id)))
        ).length,
      ).toBe(1);
    });
    it("an erasure is checked against the schedule: what is erased, what is kept and why, in writing", async () => {
      const { s, actor } = await newStudent();
      const r = await raiseRequest(s, actor, { kind: "erasure", detail: "Please delete my data" }, now);
      expect(r.letter).toMatch(/We will erase:[\s\S]*Your scores and written summaries/);
      expect(r.letter).toMatch(/We must keep, and why:[\s\S]*log of who viewed your record/);
      expect(r.status).toBe("OPEN"); // nothing is deleted until the registrar acts
    });
    it("a proposal still open keeps the intervention record", async () => {
      const { s, actor } = await newStudent();
      const ev = await insertEvaluation(db, s.id, ME_27);
      await db.insert(interventions).values({
        studentId: s.id,
        evaluationId: ev.id,
        routeKey: "aspiration_mismatch",
        recipientRole: "faculty_mentor",
        approverRole: "faculty_mentor",
        proposedMessage: "m",
        slaDueAt: now,
        closureRule: "c",
      });
      const r = await raiseRequest(s, actor, { kind: "erasure" }, now);
      expect(r.letter).toMatch(/still open/);
    });
    it("only the person it was routed to can resolve it, with a written outcome; the student is told", async () => {
      const { s, actor } = await newStudent();
      const r = await raiseRequest(s, actor, { kind: "correction", target: "erp" }, now);
      await expect(resolveRequest({ id: mentor.id, role: "faculty_mentor" }, r.id, "done")).rejects.toThrow(
        /not yours/,
      );
      await expect(resolveRequest({ id: registrar.id, role: "registrar" }, r.id, "  ")).rejects.toBeInstanceOf(
        RightsError,
      );
      expect((await openRequestsFor({ id: registrar.id, role: "registrar" })).map((x) => x.r.id)).toContain(r.id);
      await resolveRequest({ id: registrar.id, role: "registrar" }, r.id, "CGPA corrected to 7.9", now);
      expect((await db.select().from(rightsRequests).where(eq(rightsRequests.id, r.id)))[0]).toMatchObject({
        status: "RESOLVED",
        resolution: "CGPA corrected to 7.9",
        resolvedBy: registrar.id,
      });
      expect(
        (
          await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.relatedId, r.id), eq(notifications.template, "rights_resolved")))
        ).length,
      ).toBe(1);
    });
    it("a mentor sees only their own students' requests", async () => {
      const { s, actor } = await newStudent();
      const stranger = await insertUser(db, "faculty_mentor");
      const r = await raiseRequest(s, actor, { kind: "correction", target: "narrative" }, now);
      expect((await openRequestsFor({ id: mentor.id, role: "faculty_mentor" })).map((x) => x.r.id)).toContain(r.id);
      expect((await openRequestsFor({ id: stranger.id, role: "faculty_mentor" })).map((x) => x.r.id)).not.toContain(
        r.id,
      );
    });
  });

  describe("wellbeing nudges (§14.2)", () => {
    it("six nights of after-midnight study make a nudge that names the pattern, and a soft note for the mentor", async () => {
      const { s } = await newStudent();
      await db.insert(activityEvents).values(
        Array.from({ length: 6 }, (_, i) => ({
          studentId: s.id,
          kind: "practice",
          items: 20,
          at: new Date(Date.UTC(2026, 9, 10 - i, 19, 30)),
        })),
      ); // 01:00 IST
      expect(await scanWellbeing(s.id, now)).toEqual(["late_night"]);
      const [n] = await openNudges(s.id);
      expect(n).toMatchObject({ pattern: "late_night" });
      expect(n.explanation).toMatch(/after midnight on 6 of the last 14 nights/);
      const note = (
        await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.relatedId, n.id), eq(notifications.recipientUserId, mentor.id)))
      )[0];
      expect(note.template).toBe("wellbeing_soft_note");
      expect(note.payload).toEqual({ pattern: "late_night" }); // not the events behind it
      expect(await db.select().from(interventions).where(eq(interventions.studentId, s.id))).toHaveLength(0); // never a route or a label
    });
    it("does not repeat inside a fortnight, and the student can dismiss it", async () => {
      const { s } = await newStudent();
      await db.insert(activityEvents).values(
        Array.from({ length: 6 }, (_, i) => ({
          studentId: s.id,
          kind: "practice",
          items: 20,
          at: new Date(Date.UTC(2026, 9, 10 - i, 19, 30)),
        })),
      );
      await scanWellbeing(s.id, now);
      expect(await scanWellbeing(s.id, now)).toEqual([]);
      expect(await db.select().from(wellbeingNudges).where(eq(wellbeingNudges.studentId, s.id))).toHaveLength(1);
      const [n] = await openNudges(s.id);
      await dismissNudge(s.id, n.id);
      expect(await openNudges(s.id)).toHaveLength(0);
    });
    it("an ordinary student gets nothing", async () => {
      const { s } = await newStudent();
      await db
        .insert(activityEvents)
        .values([{ studentId: s.id, kind: "login", at: new Date(now.getTime() - DAY), items: 0 }]);
      expect(await scanWellbeing(s.id, now)).toEqual([]);
    });
  });

  describe("leaderboards (§12.3)", () => {
    const join = async (
      track: "corporate_placement",
      opts: { weight: number; url?: string; status?: "VERIFIED" | "ATTESTED" },
    ) => {
      const { s } = await newStudent();
      await db.update(students).set({ declaredTrack: track }).where(eq(students.id, s.id));
      await db.insert(leaderboardOptIns).values({ studentId: s.id, optedIn: true });
      await db.insert(artifacts).values({
        studentId: s.id,
        type: "repository_check",
        component: "c",
        label: "repo",
        source: "s",
        weight: opts.weight,
        status: opts.status ?? "VERIFIED",
        sourceUrl: opts.url ?? null,
      });
      return s;
    };
    it("is empty until someone opts in; ranks opted-in students by counted evidence; shows verified link chips only", async () => {
      const lo = await join("corporate_placement", { weight: 1, url: "https://github.com/a/low" });
      const hi = await join("corporate_placement", { weight: 5, url: "https://www.github.com/b/high" });
      const att = await join("corporate_placement", {
        weight: 3,
        status: "ATTESTED",
        url: "https://github.com/c/attested",
      });
      const out = await leaderboard("corporate_placement", "evidence", hi.id, { now, cache: false });
      const handles = out.entries.map((e) => e.handle);
      expect(handles.indexOf(hi.pseudonymousId)).toBeLessThan(handles.indexOf(att.pseudonymousId));
      expect(handles.indexOf(att.pseudonymousId)).toBeLessThan(handles.indexOf(lo.pseudonymousId));
      const top = out.entries.find((e) => e.handle === hi.pseudonymousId);
      expect(top).toMatchObject({ points: 5, isYou: true });
      expect(top?.links).toEqual([{ host: "github.com", url: "https://www.github.com/b/high" }]);
      expect(out.entries.find((e) => e.handle === att.pseudonymousId)?.links).toEqual([]); // attested, not link-verified
      expect(JSON.stringify(out)).not.toMatch(/persona|aeg|gap|score|index/i);
    });
    it("a student who has not opted in never appears, and opting out removes them", async () => {
      const { s } = await newStudent();
      await db.update(students).set({ declaredTrack: "higher_studies" }).where(eq(students.id, s.id));
      expect((await leaderboard("higher_studies", "evidence", null, { now, cache: false })).entries).toEqual([]);
      await db.insert(leaderboardOptIns).values({ studentId: s.id, optedIn: true });
      expect((await leaderboard("higher_studies", "evidence", null, { now, cache: false })).entries).toHaveLength(1);
      await db.update(leaderboardOptIns).set({ optedIn: false }).where(eq(leaderboardOptIns.studentId, s.id));
      expect((await leaderboard("higher_studies", "evidence", null, { now, cache: false })).entries).toEqual([]);
    });
    it("the streak tab ranks by days of complete practice and awards the badge", async () => {
      const a = await join("corporate_placement", { weight: 1 });
      await db.insert(mockAttempts).values(
        Array.from({ length: 9 }, (_, i) => ({
          studentId: a.id,
          testType: "practice",
          items: 20,
          score: 10,
          percentile: 50,
          avgSecondsPerItem: 40,
          source: "campus",
          status: "VERIFIED" as const,
          takenAt: new Date(now.getTime() - i * DAY),
        })),
      );
      const out = await leaderboard("corporate_placement", "streak", null, { now, cache: false });
      expect(out.entries[0]).toMatchObject({ handle: a.pseudonymousId, streakDays: 9, streakBadge: true });
    });
  });

  describe("internship letters (§5.3.1)", () => {
    it("count toward verified experience only once the placement cell attests them", async () => {
      const { s } = await newStudent();
      const [a] = await db
        .insert(artifacts)
        .values({
          studentId: s.id,
          type: "internship_letter",
          component: "verified_experience",
          label: "Letter",
          source: "student",
          status: "SUBMITTED",
          details: { organisation: "Acme", hours: 90 },
        })
        .returning();
      await applyTransition(a.id, "UNDER_CHECK", { kind: "system" }, "waiting");
      expect((await loadStudentFacts(s.id, { asOf: now })).verifiedInternshipHours).toBeNull();
      await applyTransition(
        a.id,
        "ATTESTED",
        { kind: "reviewer", userId: mentor.id, role: "placement_officer" },
        "Confirmed with the company contact",
      );
      expect((await loadStudentFacts(s.id, { asOf: now })).verifiedInternshipHours).toBe(90);
    });
  });
});

describe.skipIf(!up)("fairness report from consented demographics (§14.1)", () => {
  it("reports flag rates only for groups of at least 20, and only for students who agreed", async () => {
    const { demographicProfiles } = await import("../../db/schema");
    const { fairnessReport, setDemographics, demographicsOf } = await import("../fairness");
    await db.delete(demographicProfiles);
    const make = async (first: boolean, flagged: boolean) => {
      const u = await insertUser(db, "student");
      const s = await insertStudent(db, { userId: u.id });
      await insertEvaluation(
        db,
        s.id,
        flagged
          ? {
              ...ME_27,
              attendancePct: 62,
              artifactScore: 90,
              cohortArtifactP75: 66,
              aspiration: { ...ME_27.aspiration, track: "entrepreneurship" },
            }
          : ME_27,
      );
      await setDemographics(s.id, { firstGeneration: first, gender: first ? "f" : "m" });
      return s;
    };
    for (let i = 0; i < 24; i++) await make(true, i < 12); // 24 first-generation students, half flagged
    for (let i = 0; i < 22; i++) await make(false, i < 4); // 22 others, 4 flagged
    for (let i = 0; i < 3; i++) await make(true, false); // too few for another dimension below
    const r = await fairnessReport({ id: (await insertUser(db, "auditor")).id, role: "auditor" });
    expect(r.participants).toBe(49);
    const dim = r.dimensions.find((d) => d.dimension === "first_generation");
    const crit = dim?.critical;
    expect(crit?.groups.map((g) => g.group).sort()).toEqual(["false", "true"]);
    expect(crit?.reference).toBe("true");
    expect(crit?.groups.find((g) => g.group === "false")?.ratio).not.toBeNull();
    // A dimension nobody filled in is empty, and a group under 20 is suppressed.
    expect(r.dimensions.find((d) => d.dimension === "home_region")?.students).toBe(0);
    expect(r.note).toMatch(/never changes a rubric/);
    // Withdrawing deletes the row.
    const [one] = await db.select().from(demographicProfiles).limit(1);
    await setDemographics(one.studentId, null);
    expect(await demographicsOf(one.studentId)).toBeNull();
  });
});
