/** Staff list views, the audit report sample, digests, delivery and who sees which notice (§12.2, §12.3, §10.1). */
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { STUDENT_BANNED } from "@/lib/language";
import { db } from "../../db";
import {
  artifacts,
  auditEvents,
  departments,
  mockAttempts,
  notifications,
  staffProfiles,
  type students,
} from "../../db/schema";
import { markNoticesRead, noticesFor, notify } from "../../notifications";
import { buildWeeklyDigests, deliverPending, setPreference } from "../../notifications/digest";
import { renderNotice, TEMPLATES } from "../../notifications/templates";
import { type Delivery, type Transport, whatsappPayload } from "../../notifications/transport";
import { CS_44, EE_12, ME_27 } from "../../rules/fixtures";
import { dbAvailable } from "../../testing/db";
import { assign, insertEvaluation, insertStudent, insertUser } from "../../testing/fixtures";
import { AUDIT_REASONS, auditReport, SampleError, sampleRecords } from "../audit-report";
import { setConsent } from "../consent";
import { attendanceView, placementReadiness, tractionView } from "../staff-views";
import { AccessDenied } from "../students";

const up = await dbAvailable();
const now = new Date("2026-10-12T04:00:00Z"); // a Monday

let changer = "";
const share = (studentId: string, category: Parameters<typeof setConsent>[1], role: Parameters<typeof setConsent>[2]) =>
  setConsent(studentId, category, role, true, changer);

describe("student-facing wording", () => {
  it("no student-facing template uses a banned label or a persona name (§14.3)", () => {
    const studentFacing = [
      "intervention_message",
      "quest_expired_student",
      "evidence_reviewed",
      "rights_resolved",
      "weekly_passport",
    ];
    for (const t of studentFacing) {
      const n = renderNotice(t, {
        message: "One option is to book a mock.",
        quest: "Take the assessment",
        kind: "erasure",
      });
      for (const re of STUDENT_BANNED) expect(`${n.title} ${n.body}`, t).not.toMatch(re);
    }
    expect(Object.keys(TEMPLATES).length).toBeGreaterThan(10);
  });
  it("WhatsApp messages use only pre-approved templates and carry no personal detail", () => {
    const d: Delivery = { to: "+91 98765 43210", title: "", body: "", template: "weekly_passport" };
    expect(whatsappPayload(d)).toEqual({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "template",
      template: { name: "aspiredge_weekly_passport", language: { code: "en" }, components: [] },
    });
    expect(whatsappPayload({ ...d, template: "intervention_message" })).toBeNull();
    expect(JSON.stringify(whatsappPayload({ ...d, template: "weekly_digest", vars: { count: 3 } }))).toContain(
      '"text":"3"',
    );
  });
});

describe.skipIf(!up)("staff views and notices", () => {
  let advisor: Awaited<ReturnType<typeof insertUser>>;
  let placement: Awaited<ReturnType<typeof insertUser>>;
  let ecell: Awaited<ReturnType<typeof insertUser>>;
  let mentor: Awaited<ReturnType<typeof insertUser>>;
  let auditor: Awaited<ReturnType<typeof insertUser>>;

  beforeAll(async () => {
    advisor = await insertUser(db, "class_advisor");
    placement = await insertUser(db, "placement_officer");
    ecell = await insertUser(db, "ecell_coordinator");
    mentor = await insertUser(db, "faculty_mentor");
    auditor = await insertUser(db, "auditor");
    changer = (await insertUser(db, "student")).id;
  });
  const person = async (over: Partial<typeof students.$inferInsert> = {}) => {
    const u = await insertUser(db, "student");
    return { u, s: await insertStudent(db, { userId: u.id, ...over }) };
  };

  describe("class advisor attendance view", () => {
    it("lists only assigned students, lowest attendance first, with band, trend and flag; each read is audited", async () => {
      const a = (await person({ attendancePct: 62 })).s;
      const b = (await person({ attendancePct: 70 })).s;
      const c = (await person({ attendancePct: 90 })).s;
      const other = (await person({ attendancePct: 50 })).s;
      for (const s of [a, b, c]) await assign(db, advisor.id, s.id, "class_advisor");
      await insertEvaluation(db, a.id, CS_44);
      const rows = await attendanceView({ id: advisor.id, role: "class_advisor" }, now);
      expect(rows.map((r) => r.handle)).toEqual([a.pseudonymousId, b.pseudonymousId, c.pseudonymousId]);
      expect(rows.map((r) => r.band)).toEqual(["critical", "watch", "ok"]);
      expect(rows[0]).toMatchObject({ attendanceFlag: true, trend: "WORSENING" });
      expect(rows.map((r) => r.handle)).not.toContain(other.pseudonymousId);
      const logged = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.actorUserId, advisor.id), eq(auditEvents.action, "student_record.list_view")));
      expect(logged.map((e) => e.entityId).sort()).toEqual([a, b, c].map((s) => s.pseudonymousId).sort());
      expect(JSON.stringify(rows)).not.toMatch(/persona|high flyer|drifting/i);
    });
    it("is the class advisor's alone", async () => {
      await expect(attendanceView({ id: mentor.id, role: "faculty_mentor" }, now)).rejects.toBeInstanceOf(AccessDenied);
    });
  });

  describe("placement readiness list (consented fields only)", () => {
    it("lists a student only when academic and project fields are shared, and shows each further field only if shared", async () => {
      const { s: full } = await person({ cgpa: 8.1, attendancePct: 88 });
      const { s: academicOnly } = await person();
      const { s: nothing } = await person();
      await db.insert(artifacts).values({
        studentId: full.id,
        type: "t",
        component: "c",
        label: "Gearbox model",
        source: "s",
        status: "VERIFIED",
      });
      await db.insert(artifacts).values({
        studentId: full.id,
        type: "t",
        component: "c",
        label: "Unchecked claim",
        source: "s",
        status: "UNVERIFIED",
      });
      await db.insert(mockAttempts).values({
        studentId: full.id,
        testType: "campus_aptitude",
        items: 60,
        score: 55,
        percentile: 55,
        avgSecondsPerItem: 40,
        source: "campus",
        status: "VERIFIED",
        takenAt: now,
      });
      await insertEvaluation(db, full.id, ME_27);
      for (const c of ["academic_baseline", "artifacts_evidence"] as const)
        await share(full.id, c, "placement_officer");
      await share(academicOnly.id, "academic_baseline", "placement_officer");

      const first = await placementReadiness({ id: placement.id, role: "placement_officer" });
      const row = first.find((r) => r.handle === full.pseudonymousId);
      expect(first.map((r) => r.handle)).not.toContain(academicOnly.pseudonymousId);
      expect(first.map((r) => r.handle)).not.toContain(nothing.pseudonymousId);
      expect(row).toMatchObject({
        academic: { cgpa: 8.1, attendancePct: 88 },
        tests: null,
        readiness: null,
        name: null,
      });
      expect(row?.projects).toEqual([{ label: "Gearbox model", status: "VERIFIED" }]); // the unverified claim does not count

      await share(full.id, "mock_scores", "placement_officer");
      await share(full.id, "persona_aeg", "placement_officer");
      await share(full.id, "identity_contact", "placement_officer");
      const second = (await placementReadiness({ id: placement.id, role: "placement_officer" })).find(
        (r) => r.handle === full.pseudonymousId,
      );
      expect(second?.tests).toEqual({ aptitude: 55 });
      expect(second?.readiness).toMatchObject({ gap: expect.any(String) });
      expect(second?.name).toMatch(/^Test Student/);
      expect(second?.fieldsShared).toEqual(expect.arrayContaining(["persona_aeg", "mock_scores", "identity_contact"]));

      await setConsent(full.id, "academic_baseline", "placement_officer", false, changer);
      expect(
        (await placementReadiness({ id: placement.id, role: "placement_officer" })).map((r) => r.handle),
      ).not.toContain(full.pseudonymousId);
    });
    it("consent for another office does not open it, and only the placement officer can ask", async () => {
      const { s } = await person();
      for (const c of ["academic_baseline", "artifacts_evidence"] as const) await share(s.id, c, "ecell_coordinator");
      expect(
        (await placementReadiness({ id: placement.id, role: "placement_officer" })).map((r) => r.handle),
      ).not.toContain(s.pseudonymousId);
      await expect(placementReadiness({ id: mentor.id, role: "faculty_mentor" })).rejects.toBeInstanceOf(AccessDenied);
    });
  });

  describe("E-Cell traction view", () => {
    it("shows venture evidence the student shared with the E-Cell, and nothing about attendance or grades", async () => {
      const { s } = await person({ cgpa: 9.1, attendancePct: 60 });
      await db.insert(artifacts).values([
        {
          studentId: s.id,
          type: "client_reference",
          component: "venture_traction",
          label: "Pilot customer",
          source: "s",
          status: "ATTESTED",
        },
        {
          studentId: s.id,
          type: "interview_log",
          component: "customer_validation",
          label: "Interview 1",
          source: "s",
          status: "ATTESTED",
        },
        {
          studentId: s.id,
          type: "lab_record",
          component: "domain_practical_evidence",
          label: "Lab hours",
          source: "s",
          status: "VERIFIED",
        },
      ]);
      expect((await tractionView({ id: ecell.id, role: "ecell_coordinator" })).map((r) => r.handle)).not.toContain(
        s.pseudonymousId,
      );
      await share(s.id, "artifacts_evidence", "ecell_coordinator");
      const row = (await tractionView({ id: ecell.id, role: "ecell_coordinator" })).find(
        (r) => r.handle === s.pseudonymousId,
      );
      expect(row?.items).toEqual([{ label: "Pilot customer", status: "ATTESTED", component: "venture_traction" }]);
      expect(row?.interviews).toBe(1);
      expect(JSON.stringify(row)).not.toMatch(/cgpa|attendance|9\.1|60/);
    });
  });

  describe("audit report (§12.3)", () => {
    it("aggregates by cohort and carries the policy version and its history", async () => {
      const { s } = await person({ departmentCode: "CSE" });
      await insertEvaluation(db, s.id, EE_12);
      const all = await auditReport();
      const cse = await auditReport({ department: "CSE" });
      expect(all.policy.version).toBeTruthy();
      expect(cse.evalStats.total).toBeLessThanOrEqual(all.evalStats.total);
      expect(cse.department).toBe("CSE");
      expect(JSON.stringify(all)).not.toContain(s.pseudonymousId); // aggregates never name a student
    });
    it("opens a sample only with a stated reason, reproducibly, showing provenance and not the narrative", async () => {
      for (let i = 0; i < 4; i++) await insertEvaluation(db, (await person()).s.id, ME_27);
      const actor = { id: auditor.id, role: "auditor" as const };
      await expect(sampleRecords(actor, "whenever", "", 5, now)).rejects.toBeInstanceOf(SampleError);
      await expect(sampleRecords(actor, "other", " ", 5, now)).rejects.toThrow(/note/);
      const a = await sampleRecords(actor, "audit_request", "NAAC cycle", 3, now);
      const b = await sampleRecords(actor, "audit_request", "NAAC cycle", 3, now);
      expect(a).toHaveLength(3);
      expect(a.map((r) => r.handle)).toEqual(b.map((r) => r.handle));
      expect(a[0]).toMatchObject({
        engineVersion: expect.any(String),
        policyVersion: expect.any(String),
        model: "rules only",
      });
      expect(JSON.stringify(a)).not.toMatch(/narrative|persona|risk_summary/);
      const logged = await db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.actorUserId, auditor.id), eq(auditEvents.action, "audit_report.sample")));
      expect(logged.length).toBeGreaterThanOrEqual(6);
      expect(logged.every((e) => e.reason === "NAAC cycle" && e.purpose === "audit_request")).toBe(true);
      expect(AUDIT_REASONS).toContain("audit_request");
    });
  });

  describe("digests and delivery (§10.1)", () => {
    it("writes one weekly digest per advisor and mentor per week, and a student digest only on opt-in", async () => {
      const adv = await insertUser(db, "class_advisor");
      const men = await insertUser(db, "faculty_mentor");
      const { s, u } = await person({ attendancePct: 70 });
      await assign(db, adv.id, s.id, "class_advisor");
      await assign(db, men.id, s.id, "faculty_mentor");
      const optedOut = await person();
      await setPreference(u.id, "email", true);
      await buildWeeklyDigests(now);
      const again = await buildWeeklyDigests(now);
      expect(again).toBe(0); // idempotent within the week
      const advice = await noticesFor({ id: adv.id, role: "class_advisor" });
      expect(advice.find((n) => n.template === "weekly_digest")?.body).toMatch(
        /1 students in the watch band \(65 to 74 percent\)/,
      );
      expect(
        (await noticesFor({ id: men.id, role: "faculty_mentor" })).some((n) => n.template === "weekly_digest"),
      ).toBe(true);
      expect((await noticesFor({ id: u.id, role: "student" })).some((n) => n.template === "weekly_passport")).toBe(
        true,
      );
      expect(
        (await noticesFor({ id: optedOut.u.id, role: "student" })).some((n) => n.template === "weekly_passport"),
      ).toBe(false);
    });
    it("delivers email, skips WhatsApp without an opt-in and a number, and marks failures", async () => {
      const { u } = await person();
      const sent: Delivery[] = [];
      const ok: Transport = {
        channel: "email",
        send: async (d) => {
          sent.push(d);
          return { ok: true, detail: "ok" };
        },
      };
      const wa: Transport = {
        channel: "whatsapp",
        send: async (d) => {
          sent.push(d);
          return { ok: true, detail: "ok" };
        },
      };
      await db.insert(notifications).values([
        { recipientUserId: u.id, channel: "email", template: "weekly_passport" },
        { recipientUserId: u.id, channel: "whatsapp", template: "weekly_passport" },
      ]);
      let r = await deliverPending([ok, wa], now);
      expect(r.sent).toBeGreaterThanOrEqual(1);
      expect(sent.filter((d) => d.to === u.email).map((d) => d.template)).toEqual(["weekly_passport"]); // email only; the WhatsApp row was skipped
      await expect(setPreference(u.id, "whatsapp", true, "12")).rejects.toThrow(/country code/);
      await setPreference(u.id, "whatsapp", true, "+91 98765 43210");
      await db
        .insert(notifications)
        .values({ recipientUserId: u.id, channel: "whatsapp", template: "weekly_passport" });
      r = await deliverPending([ok, wa], now);
      expect(sent.some((d) => d.to === "+91 98765 43210")).toBe(true);
      const boom: Transport = {
        channel: "email",
        send: async () => {
          throw new Error("relay down");
        },
      };
      await db.insert(notifications).values({ recipientUserId: u.id, channel: "email", template: "weekly_passport" });
      expect((await deliverPending([boom], now)).failed).toBe(1);
      await setPreference(u.id, "whatsapp", false);
      expect(
        (await db.select().from(notifications).where(eq(notifications.recipientUserId, u.id))).every(
          (n) => n.status !== "PENDING",
        ),
      ).toBe(true);
    });
  });

  describe("who sees a notice", () => {
    it("a student sees notices about themselves; assigned staff see them; unassigned staff, and other students, do not", async () => {
      const { s, u } = await person();
      const { u: other } = await person();
      const men = await insertUser(db, "faculty_mentor");
      const stranger = await insertUser(db, "faculty_mentor");
      await assign(db, men.id, s.id, "faculty_mentor");
      await notify({
        to: { role: "student" },
        studentId: s.id,
        template: "intervention_message",
        vars: { message: "Here is a step." },
      });
      await notify({
        to: { role: "faculty_mentor" },
        studentId: s.id,
        template: "intervention_for_you",
        vars: { route: "Timeline review" },
      });
      expect((await noticesFor({ id: u.id, role: "student" })).map((n) => n.template)).toContain(
        "intervention_message",
      );
      expect((await noticesFor({ id: other.id, role: "student" })).map((n) => n.template)).not.toContain(
        "intervention_message",
      );
      expect((await noticesFor({ id: men.id, role: "faculty_mentor" })).map((n) => n.template)).toContain(
        "intervention_for_you",
      );
      expect((await noticesFor({ id: stranger.id, role: "faculty_mentor" })).map((n) => n.template)).not.toContain(
        "intervention_for_you",
      );
      // The student's notice is not addressed to staff roles.
      expect((await noticesFor({ id: men.id, role: "faculty_mentor" })).map((n) => n.template)).not.toContain(
        "intervention_message",
      );
      await markNoticesRead({ id: u.id, role: "student" });
      expect((await noticesFor({ id: u.id, role: "student" })).every((n) => n.read)).toBe(true);
    });
    it("the dean and HOD hear about a route only as a count for their department, never about a student", async () => {
      const dean = await insertUser(db, "dean");
      const hodA = await insertUser(db, "hod");
      const hodB = await insertUser(db, "hod");
      for (const [code, name] of [
        ["MECH", "Mechanical"],
        ["LAW", "Law"],
      ])
        await db.insert(departments).values({ code, name, standardsVersion: "t" }).onConflictDoNothing();
      await db
        .insert(staffProfiles)
        .values([
          { userId: hodA.id, departmentCode: "MECH" },
          { userId: hodB.id, departmentCode: "LAW" },
        ])
        .onConflictDoNothing();
      const { s } = await person();
      await notify({
        to: { role: "hod" },
        template: "route_escalated",
        vars: { route: "Attendance support", department: "MECH", workingDays: 6 },
      });
      await notify({ to: { role: "dean" }, studentId: s.id, template: "intervention_for_you", vars: { route: "x" } });
      expect((await noticesFor({ id: hodA.id, role: "hod" })).map((n) => n.template)).toContain("route_escalated");
      expect((await noticesFor({ id: hodB.id, role: "hod" })).map((n) => n.template)).not.toContain("route_escalated");
      expect((await noticesFor({ id: dean.id, role: "dean" })).map((n) => n.template)).not.toContain(
        "intervention_for_you",
      );
    });
  });
});
