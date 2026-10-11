/**
 * Interventions and counseling against Postgres (§8): approval, the consent check at dispatch, SLA
 * escalation, the quest lifecycle and the Kanban rules. "Dispatch without consent is impossible" is
 * the authorization test named in the Phase 6 exit gate.
 */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../db";
import {
  artifacts,
  auditEvents,
  consentRecords,
  counselingCardMoves,
  counselingCards,
  interventions,
  notifications,
  quests,
} from "../../db/schema";
import { CS_44, EE_12, ME_27 } from "../../rules/fixtures";
import { dbAvailable } from "../../testing/db";
import { assign, insertEvaluation, insertStudent, insertUser } from "../../testing/fixtures";
import { applyTransition } from "../../verification/apply";
import { decide, pendingApprovals } from "../approvals";
import { setConsent } from "../consent";
import { moveCard } from "../counseling";
import { dispatchIntervention } from "../dispatch";
import { runSlaEscalation } from "../escalation";
import {
  acceptQuest,
  deferQuest,
  editQuestDays,
  expireDueQuests,
  QuestError,
  recordPlatformResult,
  reopenQuest,
  settleQuestForArtifact,
  startQuest,
} from "../quests";

vi.mock("../../queue", () => ({ enqueue: async () => undefined }));

const up = await dbAvailable();
const DAY = 86_400_000;

describe.skipIf(!up)("interventions and counseling", () => {
  let mentor: Awaited<ReturnType<typeof insertUser>>;
  let advisor: Awaited<ReturnType<typeof insertUser>>;
  let placement: Awaited<ReturnType<typeof insertUser>>;
  let studentUser: Awaited<ReturnType<typeof insertUser>>;

  beforeAll(async () => {
    mentor = await insertUser(db, "faculty_mentor");
    advisor = await insertUser(db, "class_advisor");
    placement = await insertUser(db, "placement_officer");
    studentUser = await insertUser(db, "student");
  });

  /** A student with a mentor, an advisor and a placement officer assigned, and an evaluation on file. */
  async function setup(facts = ME_27) {
    const s = await insertStudent(db, { userId: studentUser.id === "" ? null : null });
    for (const [u, role] of [
      [mentor, "faculty_mentor"],
      [advisor, "class_advisor"],
      [placement, "placement_officer"],
    ] as const)
      await assign(db, u.id, s.id, role);
    const ev = await insertEvaluation(db, s.id, facts);
    return { s, ev };
  }
  async function propose(
    studentId: string,
    evaluationId: string,
    routeKey: string,
    over: Partial<typeof interventions.$inferInsert> = {},
  ) {
    const recipient =
      routeKey === "detention_threat_builder"
        ? "class_advisor"
        : routeKey === "false_positive_high_flyer"
          ? "placement_officer"
          : "faculty_mentor";
    const [i] = await db
      .insert(interventions)
      .values({
        studentId,
        evaluationId,
        routeKey,
        recipientRole: recipient,
        approverRole: recipient,
        copyRoles: routeKey === "detention_threat_builder" ? ["ecell_coordinator"] : [],
        proposedMessage: "Here is a first step you could take.",
        slaDueAt: new Date(Date.now() + 2 * DAY),
        closureRule: "closed when done",
        ...over,
      })
      .returning();
    return i;
  }
  const approver = (u: { id: string }, role: "faculty_mentor" | "class_advisor" | "placement_officer") => ({
    id: u.id,
    role,
  });

  describe("approval and dispatch", () => {
    it("approving a mentor route sends it: the student is told, the recipient is told, a card opens, and it is audited", async () => {
      const { s, ev } = await setup();
      const i = await propose(s.id, ev.id, "aspiration_mismatch");
      const r = await decide(
        i.id,
        approver(mentor, "faculty_mentor"),
        "edit_approve",
        null,
        "I would like to talk about your timeline.",
      );
      expect(r.dispatch?.status).toBe("DISPATCHED");
      const [row] = await db.select().from(interventions).where(eq(interventions.id, i.id));
      expect(row).toMatchObject({
        status: "DISPATCHED",
        finalMessage: "I would like to talk about your timeline.",
        approverUserId: mentor.id,
      });
      expect(row.dispatchedAt).toBeInstanceOf(Date);

      const notes = await db.select().from(notifications).where(eq(notifications.relatedId, i.id));
      expect(notes.map((n) => n.template).sort()).toEqual(["intervention_for_you", "intervention_message"]);
      expect(notes.find((n) => n.template === "intervention_message")?.payload).toMatchObject({
        message: "I would like to talk about your timeline.",
      });

      const cards = await db.select().from(counselingCards).where(eq(counselingCards.studentId, s.id));
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ column: "REFERRED", mentorUserId: mentor.id });
      const audits = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.entityId, i.id), eq(auditEvents.action, "intervention.dispatch")));
      expect(audits).toHaveLength(1);
    });

    it("a rejection needs a reason, sends nothing and contacts no one", async () => {
      const { s, ev } = await setup();
      const i = await propose(s.id, ev.id, "aspiration_mismatch");
      await expect(decide(i.id, approver(mentor, "faculty_mentor"), "reject", null, null)).rejects.toThrow(
        /reason is required/,
      );
      const r = await decide(i.id, approver(mentor, "faculty_mentor"), "reject", "Not the right moment", null);
      expect(r.dispatch).toBeNull();
      expect((await db.select().from(interventions).where(eq(interventions.id, i.id)))[0]).toMatchObject({
        status: "REJECTED",
        decisionNote: "Not the right moment",
      });
      expect(await db.select().from(notifications).where(eq(notifications.relatedId, i.id))).toHaveLength(0);
    });

    it("only the approver for the route can decide, and only once", async () => {
      const { s, ev } = await setup();
      const i = await propose(s.id, ev.id, "aspiration_mismatch");
      await expect(decide(i.id, approver(advisor, "class_advisor"), "approve", null, null)).rejects.toThrow(
        /not the approver/,
      );
      await decide(i.id, approver(mentor, "faculty_mentor"), "approve", null, null);
      await expect(decide(i.id, approver(mentor, "faculty_mentor"), "approve", null, null)).rejects.toThrow(
        /already been decided/,
      );
    });

    it("an intervention is only ever created as PENDING_APPROVAL and cannot be dispatched before a decision", async () => {
      const { s, ev } = await setup();
      const i = await propose(s.id, ev.id, "aspiration_mismatch");
      expect(i.status).toBe("PENDING_APPROVAL");
      expect((await dispatchIntervention(i.id)).status).toBe("SKIPPED");
      expect((await db.select().from(interventions).where(eq(interventions.id, i.id)))[0].status).toBe(
        "PENDING_APPROVAL",
      );
    });
  });

  describe("dispatch without consent is impossible (Phase 6 exit gate)", () => {
    it("the attendance route cannot reach the E-Cell without the student's consent; approval is kept and the block is explained", async () => {
      const { s, ev } = await setup(CS_44);
      const i = await propose(s.id, ev.id, "detention_threat_builder");
      const r = await decide(i.id, approver(advisor, "class_advisor"), "approve", null, null);
      expect(r.dispatch).toMatchObject({ status: "BLOCKED" });
      expect(r.dispatch?.status === "BLOCKED" && r.dispatch.message).toMatch(
        /has not shared “Projects, certificates and evidence” with the E-Cell/,
      );
      const [row] = await db.select().from(interventions).where(eq(interventions.id, i.id));
      expect(row.status).toBe("APPROVED"); // the human decision stands
      expect(row.dispatchedAt).toBeNull();
      expect(row.dispatchBlockedReason).toMatch(/nothing was sent/);
      // Nothing reached the student or the E-Cell, and no card was opened.
      const sent = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.relatedId, i.id), eq(notifications.template, "intervention_message")));
      expect(sent).toHaveLength(0);
      expect(await db.select().from(counselingCards).where(eq(counselingCards.studentId, s.id))).toHaveLength(0);
      // The approver is told why.
      expect(
        (
          await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.relatedId, i.id), eq(notifications.template, "dispatch_blocked")))
        ).length,
      ).toBe(1);
      expect(
        (
          await db
            .select()
            .from(auditEvents)
            .where(and(eq(auditEvents.entityId, i.id), eq(auditEvents.action, "intervention.dispatch_blocked")))
        )[0].result,
      ).toBe("denied");
    });

    it("calling dispatch again without consent still sends nothing", async () => {
      const { s, ev } = await setup(CS_44);
      const i = await propose(s.id, ev.id, "detention_threat_builder", {
        status: "APPROVED",
        approverUserId: advisor.id,
      });
      for (let n = 0; n < 3; n++) expect((await dispatchIntervention(i.id)).status).toBe("BLOCKED");
      expect((await db.select().from(interventions).where(eq(interventions.id, i.id)))[0].status).toBe("APPROVED");
    });

    it("consent for a different office does not release it", async () => {
      const { s, ev } = await setup(CS_44);
      const i = await propose(s.id, ev.id, "detention_threat_builder", {
        status: "APPROVED",
        approverUserId: advisor.id,
      });
      await setConsent(s.id, "artifacts_evidence", "placement_officer", true, studentUser.id);
      expect((await dispatchIntervention(i.id)).status).toBe("BLOCKED");
    });

    it("when the student shares what the route carries, the waiting proposal goes out by itself; withdrawing later does not recall it", async () => {
      const { s, ev } = await setup(CS_44);
      const i = await propose(s.id, ev.id, "detention_threat_builder", {
        status: "APPROVED",
        approverUserId: advisor.id,
      });
      expect((await dispatchIntervention(i.id)).status).toBe("BLOCKED");
      await setConsent(s.id, "artifacts_evidence", "ecell_coordinator", true, studentUser.id);
      const [row] = await db.select().from(interventions).where(eq(interventions.id, i.id));
      expect(row).toMatchObject({ status: "DISPATCHED", dispatchBlockedReason: null });
      const copies = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.relatedId, i.id), eq(notifications.template, "intervention_copy")));
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        recipientRole: "ecell_coordinator",
        payload: { shared: "artifacts_evidence" },
      });
      await setConsent(s.id, "artifacts_evidence", "ecell_coordinator", false, studentUser.id);
      expect((await db.select().from(interventions).where(eq(interventions.id, i.id)))[0].status).toBe("DISPATCHED");
    });

    it("the consent history stays append-only through these changes", async () => {
      const { s } = await setup();
      await setConsent(s.id, "persona_aeg", "placement_officer", true, studentUser.id);
      await setConsent(s.id, "persona_aeg", "placement_officer", false, studentUser.id);
      const rows = await db.select().from(consentRecords).where(eq(consentRecords.studentId, s.id));
      expect(rows.map((r) => r.granted)).toEqual([true, false]);
    });
  });

  describe("who sees a proposal", () => {
    it("a placement officer sees the High Flyer route only for a student who shared persona flags with them", async () => {
      const { s, ev } = await setup(EE_12);
      const i = await propose(s.id, ev.id, "false_positive_high_flyer");
      expect((await pendingApprovals(approver(placement, "placement_officer"))).map((r) => r.id)).not.toContain(i.id);
      await setConsent(s.id, "persona_aeg", "placement_officer", true, studentUser.id);
      const seen = await pendingApprovals(approver(placement, "placement_officer"));
      expect(seen.map((r) => r.id)).toContain(i.id);
      await setConsent(s.id, "persona_aeg", "placement_officer", false, studentUser.id);
      expect((await pendingApprovals(approver(placement, "placement_officer"))).map((r) => r.id)).not.toContain(i.id);
    });
    it("the class advisor sees the attendance route for assigned students and the mentor does not", async () => {
      const { s, ev } = await setup(CS_44);
      const i = await propose(s.id, ev.id, "detention_threat_builder");
      expect((await pendingApprovals(approver(advisor, "class_advisor"))).map((r) => r.id)).toContain(i.id);
      expect((await pendingApprovals(approver(mentor, "faculty_mentor"))).map((r) => r.id)).not.toContain(i.id);
      const stranger = await insertUser(db, "class_advisor");
      expect((await pendingApprovals({ id: stranger.id, role: "class_advisor" })).map((r) => r.id)).not.toContain(i.id);
    });
    it("the queue carries working days left and flags a stale import", async () => {
      const { s, ev } = await setup();
      await db
        .update((await import("../../db/schema")).students)
        .set({ erpImportedAt: new Date(Date.now() - 5 * DAY) })
        .where(eq((await import("../../db/schema")).students.id, s.id));
      const i = await propose(s.id, ev.id, "aspiration_mismatch", { slaDueAt: new Date(Date.now() + 3 * DAY) });
      const row = (await pendingApprovals(approver(mentor, "faculty_mentor"))).find((r) => r.id === i.id);
      expect(row?.erpStale).toBe(true);
      expect(typeof row?.workingDaysLeft).toBe("number");
    });
  });

  describe("SLA escalation", () => {
    it("tells the dean, with a count and no student, after five working days without a decision; once", async () => {
      const { s, ev } = await setup(CS_44);
      const i = await propose(s.id, ev.id, "detention_threat_builder", { createdAt: new Date(Date.now() - 12 * DAY) });
      const r = await runSlaEscalation();
      expect(r.escalated).toBeGreaterThanOrEqual(1);
      const [row] = await db.select().from(interventions).where(eq(interventions.id, i.id));
      expect(row).toMatchObject({ escalatedTo: "dean" });
      const note = (
        await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.relatedId, i.id), eq(notifications.template, "route_escalated")))
      )[0];
      expect(note).toMatchObject({ recipientRole: "dean", studentId: null });
      expect(note.payload).toMatchObject({ route: "Attendance support" });
      await runSlaEscalation();
      expect(
        await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.relatedId, i.id), eq(notifications.template, "route_escalated"))),
      ).toHaveLength(1);
    });
    it("High Flyer with no quest started escalates to the mentor, who may then decide", async () => {
      const { s, ev } = await setup(EE_12);
      const i = await propose(s.id, ev.id, "false_positive_high_flyer", {
        status: "APPROVED",
        decidedAt: new Date(Date.now() - 40 * DAY),
        approverUserId: placement.id,
        createdAt: new Date(Date.now() - 41 * DAY),
      });
      await runSlaEscalation();
      expect((await db.select().from(interventions).where(eq(interventions.id, i.id)))[0].escalatedTo).toBe(
        "faculty_mentor",
      );
      const mentorNote = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.relatedId, i.id), eq(notifications.recipientRole, "faculty_mentor")));
      expect(mentorNote[0].studentId).toBe(s.id); // the assigned mentor sees whom it concerns
    });
    it("a started quest stops that escalation", async () => {
      const { s, ev } = await setup(EE_12);
      const i = await propose(s.id, ev.id, "false_positive_high_flyer", {
        status: "DISPATCHED",
        decidedAt: new Date(Date.now() - 40 * DAY),
        createdAt: new Date(Date.now() - 41 * DAY),
      });
      await db.insert(quests).values({
        studentId: s.id,
        title: "q",
        action: "a",
        targetDays: 14,
        requiredEvidenceType: "internal_test",
        status: "ACCEPTED",
      });
      await runSlaEscalation();
      expect((await db.select().from(interventions).where(eq(interventions.id, i.id)))[0].escalatedAt).toBeNull();
    });
  });

  describe("quests (§8.3)", () => {
    const quest = async (studentId: string, over: Partial<typeof quests.$inferInsert> = {}) =>
      (
        await db
          .insert(quests)
          .values({
            studentId,
            title: "Take the timed GD&T assessment",
            action: "Do it",
            targetDays: 14,
            requiredEvidenceType: "platform_timed_assessment",
            componentKey: "domain_practical_evidence",
            standardItem: "gdt_assessment",
            ...over,
          })
          .returning()
      )[0];
    const actor = { id: "user-x", role: "student" };
    const stu = (s: { id: string; pseudonymousId: string }) => ({ id: s.id, pseudonymousId: s.pseudonymousId });

    it("accept sets the clock; start marks it active; days stay inside the policy range", async () => {
      const { s } = await setup();
      const q = await quest(s.id);
      const now = new Date("2026-10-11T00:00:00Z");
      await acceptQuest(stu(s), actor, q.id, now);
      let [row] = await db.select().from(quests).where(eq(quests.id, q.id));
      expect(row).toMatchObject({ status: "ACCEPTED" });
      expect(row.dueAt?.toISOString()).toBe("2026-10-25T00:00:00.000Z");
      await startQuest(stu(s), actor, q.id);
      await editQuestDays(stu(s), actor, q.id, 500);
      [row] = await db.select().from(quests).where(eq(quests.id, q.id));
      expect(row).toMatchObject({ status: "ACTIVE", targetDays: 90 });
      expect(row.dueAt?.toISOString()).toBe(new Date(now.getTime() + 90 * DAY).toISOString());
    });
    it("a student cannot touch someone else's quest, accept twice, or start before accepting", async () => {
      const { s } = await setup();
      const { s: other } = await setup();
      const q = await quest(s.id);
      await expect(acceptQuest(stu(other), actor, q.id)).rejects.toBeInstanceOf(QuestError);
      await expect(startQuest(stu(s), actor, q.id)).rejects.toThrow(/Accept this quest/);
      await acceptQuest(stu(s), actor, q.id);
      await expect(acceptQuest(stu(s), actor, q.id)).rejects.toThrow(/already been accepted/);
    });
    it("deferring keeps it proposed and brings it back after the policy's days", async () => {
      const { s } = await setup();
      const q = await quest(s.id);
      const now = new Date("2026-10-11T00:00:00Z");
      await deferQuest(stu(s), actor, q.id, now);
      const [row] = await db.select().from(quests).where(eq(quests.id, q.id));
      expect(row.status).toBe("PROPOSED");
      expect(row.deferredUntil?.toISOString()).toBe(new Date(now.getTime() + 14 * DAY).toISOString());
    });

    it("is completed only by counted evidence of the named type: a pending upload does not, a verified one does", async () => {
      const { s } = await setup();
      const q = await quest(s.id, {
        requiredEvidenceType: "faculty_rubric_review",
        standardItem: null,
        componentKey: "domain_practical_evidence",
      });
      await acceptQuest(stu(s), actor, q.id);
      const [a] = await db
        .insert(artifacts)
        .values({
          studentId: s.id,
          type: "faculty_rubric_review",
          component: "domain_practical_evidence",
          label: "Model",
          source: "student",
          status: "SUBMITTED",
        })
        .returning();
      await db
        .update(quests)
        .set({ status: "EVIDENCE_SUBMITTED", evidenceArtifactId: a.id })
        .where(eq(quests.id, q.id));
      await applyTransition(a.id, "UNDER_CHECK", { kind: "system" }, "waiting");
      expect((await db.select().from(quests).where(eq(quests.id, q.id)))[0].status).toBe("EVIDENCE_SUBMITTED");
      await applyTransition(
        a.id,
        "ATTESTED",
        { kind: "reviewer", userId: mentor.id, role: "faculty_mentor" },
        "Reviewed on the rubric",
      );
      const [done] = await db.select().from(quests).where(eq(quests.id, q.id));
      expect(done.status).toBe("DONE");
      expect(done.completedAt).toBeInstanceOf(Date);
    });
    it("evidence of the wrong type never completes it", async () => {
      const { s } = await setup();
      const q = await quest(s.id);
      await acceptQuest(stu(s), actor, q.id);
      const [a] = await db
        .insert(artifacts)
        .values({
          studentId: s.id,
          type: "participation_certificate",
          component: "domain_practical_evidence",
          standardItem: "gdt_assessment",
          label: "Cert",
          source: "student",
          status: "VERIFIED",
        })
        .returning();
      await db
        .update(quests)
        .set({ status: "EVIDENCE_SUBMITTED", evidenceArtifactId: a.id })
        .where(eq(quests.id, q.id));
      await settleQuestForArtifact(a.id);
      expect((await db.select().from(quests).where(eq(quests.id, q.id)))[0].status).toBe("ACTIVE"); // sent back, with the reason
      expect((await db.select().from(quests).where(eq(quests.id, q.id)))[0].statusNote).toMatch(
        /needs evidence of type/,
      );
    });
    it("a rejected upload sends the quest back to Active with the reason, so the student can resubmit", async () => {
      const { s } = await setup();
      const q = await quest(s.id, { requiredEvidenceType: "attested_log", standardItem: null });
      await acceptQuest(stu(s), actor, q.id);
      const [a] = await db
        .insert(artifacts)
        .values({
          studentId: s.id,
          type: "attested_log",
          component: "domain_practical_evidence",
          label: "Log",
          source: "student",
          status: "SUBMITTED",
        })
        .returning();
      await db
        .update(quests)
        .set({ status: "EVIDENCE_SUBMITTED", evidenceArtifactId: a.id })
        .where(eq(quests.id, q.id));
      await applyTransition(a.id, "UNDER_CHECK", { kind: "system" }, "waiting");
      await applyTransition(
        a.id,
        "REJECTED",
        { kind: "reviewer", userId: mentor.id, role: "faculty_mentor" },
        "The signature is missing",
      );
      const [row] = await db.select().from(quests).where(eq(quests.id, q.id));
      expect(row.status).toBe("ACTIVE");
      expect(row.statusNote).toMatch(/not accepted|rejected/i);
    });
    it("a platform result completes a matching accepted quest without the student submitting anything", async () => {
      const { s } = await setup();
      const q = await quest(s.id);
      await acceptQuest(stu(s), actor, q.id);
      await recordPlatformResult({
        studentId: s.id,
        type: "platform_timed_assessment",
        component: "domain_practical_evidence",
        standardItem: "gdt_assessment",
        label: "Timed GD&T assessment",
        details: { score: 41 },
      });
      expect((await db.select().from(quests).where(eq(quests.id, q.id)))[0].status).toBe("DONE");
      const arts = await db
        .select()
        .from(artifacts)
        .where(and(eq(artifacts.studentId, s.id), eq(artifacts.status, "VERIFIED")));
      expect(arts).toHaveLength(1);
      await expect(
        recordPlatformResult({ studentId: s.id, type: "attested_log", component: "c", label: "x" }),
      ).rejects.toThrow(/not a platform result/);
    });

    it("an expired quest moves the mentor's card to Follow-up due, tells the mentor, and is not held against the student", async () => {
      const { s } = await setup();
      const q = await quest(s.id);
      await acceptQuest(stu(s), actor, q.id, new Date(Date.now() - 20 * DAY));
      const [card] = await db
        .insert(counselingCards)
        .values({ studentId: s.id, mentorUserId: mentor.id, column: "PLAN_ACTIVE" })
        .returning();
      expect(await expireDueQuests()).toBeGreaterThanOrEqual(1);
      expect((await db.select().from(quests).where(eq(quests.id, q.id)))[0]).toMatchObject({ status: "EXPIRED" });
      expect((await db.select().from(counselingCards).where(eq(counselingCards.id, card.id)))[0].column).toBe(
        "FOLLOW_UP_DUE",
      );
      const move = (await db.select().from(counselingCardMoves).where(eq(counselingCardMoves.cardId, card.id)))[0];
      expect(move).toMatchObject({
        actorKind: "system",
        actorUserId: null,
        fromColumn: "PLAN_ACTIVE",
        toColumn: "FOLLOW_UP_DUE",
      });
      const note = (
        await db
          .select()
          .from(notifications)
          .where(and(eq(notifications.relatedId, q.id), eq(notifications.template, "quest_expired")))
      )[0];
      expect(note.recipientUserId).toBe(mentor.id);
      await reopenQuest(stu(s), actor, q.id);
      expect((await db.select().from(quests).where(eq(quests.id, q.id)))[0].status).toBe("ACCEPTED");
    });
    it("expiry opens a Follow-up due card when the student has none", async () => {
      const { s } = await setup();
      const q = await quest(s.id);
      await acceptQuest(stu(s), actor, q.id, new Date(Date.now() - 20 * DAY));
      await expireDueQuests();
      const cards = await db.select().from(counselingCards).where(eq(counselingCards.studentId, s.id));
      expect(cards).toHaveLength(1);
      expect(cards[0].column).toBe("FOLLOW_UP_DUE");
    });
    it("a quest that is waiting for a reviewer does not expire", async () => {
      const { s } = await setup();
      const q = await quest(s.id, { status: "EVIDENCE_SUBMITTED", dueAt: new Date(Date.now() - 5 * DAY) });
      await expireDueQuests();
      expect((await db.select().from(quests).where(eq(quests.id, q.id)))[0].status).toBe("EVIDENCE_SUBMITTED");
    });
  });

  describe("counseling board rules (§8.2)", () => {
    it("backward moves need a reason; Plan active needs a started quest; moves are recorded", async () => {
      const { s } = await setup();
      const [card] = await db
        .insert(counselingCards)
        .values({ studentId: s.id, mentorUserId: mentor.id, column: "SCHEDULED" })
        .returning();
      await expect(moveCard(card.id, mentor.id, "REFERRED", null)).rejects.toThrow(/needs a reason/);
      await expect(moveCard(card.id, mentor.id, "PLAN_ACTIVE", null)).rejects.toThrow(/at least one accepted quest/);
      await db.insert(quests).values({
        studentId: s.id,
        title: "q",
        action: "a",
        targetDays: 14,
        requiredEvidenceType: "internal_test",
        status: "ACTIVE",
      });
      await moveCard(card.id, mentor.id, "PLAN_ACTIVE", null);
      await moveCard(card.id, mentor.id, "IN_CONVERSATION", "Student asked to talk first");
      const moves = await db.select().from(counselingCardMoves).where(eq(counselingCardMoves.cardId, card.id));
      expect(moves.map((m) => `${m.fromColumn}>${m.toColumn}`)).toEqual([
        "SCHEDULED>PLAN_ACTIVE",
        "PLAN_ACTIVE>IN_CONVERSATION",
      ]);
      expect(moves[1].reason).toBe("Student asked to talk first");
    });
    it("only the card's own mentor can move it", async () => {
      const { s } = await setup();
      const [card] = await db.insert(counselingCards).values({ studentId: s.id, mentorUserId: mentor.id }).returning();
      const other = await insertUser(db, "faculty_mentor");
      await expect(moveCard(card.id, other.id, "SCHEDULED", null)).rejects.toThrow(/not found/);
    });
  });
});
