/** Quest lifecycle (§8.3), SLA escalation (§8.1) and the consent gaps at dispatch, as pure rules. */
import { describe, expect, it } from "vitest";
import { consentGaps, explainGaps } from "../../consent/dispatch";
import { loadPolicyFile } from "../../policy/file";
import type { Calendar } from "../calendar";
import {
  clampTargetDays,
  dueDate,
  evidenceCompletesQuest,
  nextQuestState,
  QUEST_STATES,
  type QuestEvent,
  shouldExpire,
} from "../quest";
import { escalationDecision, slaState } from "../sla";

const policy = loadPolicyFile();
const cal: Calendar = { ...policy.calendar };

describe("quest lifecycle", () => {
  const events: QuestEvent[] = [
    "accept",
    "start",
    "submit_evidence",
    "evidence_counted",
    "evidence_rejected",
    "expire",
    "reopen",
  ];
  const table = Object.fromEntries(QUEST_STATES.map((s) => [s, events.map((e) => nextQuestState(s, e))]));

  it("follows Proposed → Accepted → Active → Evidence submitted → Done", () => {
    expect(nextQuestState("PROPOSED", "accept")).toBe("ACCEPTED");
    expect(nextQuestState("ACCEPTED", "start")).toBe("ACTIVE");
    expect(nextQuestState("ACTIVE", "submit_evidence")).toBe("EVIDENCE_SUBMITTED");
    expect(nextQuestState("EVIDENCE_SUBMITTED", "evidence_counted")).toBe("DONE");
  });
  it("offers nothing after Done, and cannot skip acceptance", () => {
    expect(table.DONE.every((x) => x === null)).toBe(true);
    expect(nextQuestState("PROPOSED", "submit_evidence")).toBeNull();
    expect(nextQuestState("PROPOSED", "expire")).toBeNull();
  });
  it("evidence that does not count sends it back to Active; an expired quest can be picked up again", () => {
    expect(nextQuestState("EVIDENCE_SUBMITTED", "evidence_rejected")).toBe("ACTIVE");
    expect(nextQuestState("EXPIRED", "reopen")).toBe("ACCEPTED");
  });
  it("only an accepted or active quest can expire, and only after its date", () => {
    const due = new Date("2026-10-10");
    const now = new Date("2026-10-11");
    expect(shouldExpire({ status: "ACCEPTED", dueAt: due }, now)).toBe(true);
    expect(shouldExpire({ status: "ACTIVE", dueAt: due }, now)).toBe(true);
    expect(shouldExpire({ status: "ACTIVE", dueAt: new Date("2026-10-12") }, now)).toBe(false);
    expect(shouldExpire({ status: "EVIDENCE_SUBMITTED", dueAt: due }, now)).toBe(false);
    expect(shouldExpire({ status: "PROPOSED", dueAt: null }, now)).toBe(false);
  });

  describe("completion needs evidence of the named type that counts", () => {
    const quest = {
      requiredEvidenceType: "platform_timed_assessment",
      componentKey: "domain_practical_evidence",
      standardItem: "gdt_assessment",
    };
    const art = {
      type: "platform_timed_assessment",
      component: "domain_practical_evidence",
      standardItem: "gdt_assessment",
      status: "VERIFIED" as const,
    };
    it("accepts the right type, item and a counted status", () => {
      expect(evidenceCompletesQuest(quest, art, policy).ok).toBe(true);
      expect(evidenceCompletesQuest(quest, { ...art, status: "ATTESTED" }, policy).ok).toBe(true);
    });
    it("a GD&T quest is not completed by a link, a certificate or another item", () => {
      expect(evidenceCompletesQuest(quest, { ...art, type: "participation_certificate" }, policy)).toMatchObject({
        ok: false,
        reason: expect.stringMatching(/needs evidence of type/),
      });
      expect(evidenceCompletesQuest(quest, { ...art, standardItem: "autocad_lab" }, policy)).toMatchObject({
        ok: false,
      });
    });
    it("evidence that does not count does not complete it", () => {
      for (const status of ["UNVERIFIED", "REJECTED", "STALE", "UNDER_CHECK", "SUBMITTED"] as const)
        expect(evidenceCompletesQuest(quest, { ...art, status }, policy).ok).toBe(false);
    });
  });

  it("keeps edited days inside the policy range and computes the due date", () => {
    expect(clampTargetDays(3, [7, 90])).toBe(7);
    expect(clampTargetDays(500, [7, 90])).toBe(90);
    expect(clampTargetDays(20.4, [7, 90])).toBe(20);
    expect(dueDate(new Date("2026-10-11T00:00:00Z"), 14).toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
});

describe("SLA escalation (§8.1)", () => {
  const base = {
    status: "PENDING_APPROVAL" as const,
    createdAt: new Date("2026-10-05T06:00:00Z"), // Monday
    decidedAt: null,
    questStarted: false,
    meetingLogged: false,
    alreadyEscalated: false,
    calendar: cal,
  };
  const detention = policy.routes.detention_threat_builder;

  it("Detention Threat Builder: escalates to the dean after 5 working days without a decision", () => {
    expect(escalationDecision({ ...base, route: detention, now: new Date("2026-10-11T06:00:00Z") }).escalate).toBe(
      false,
    ); // 4 working days (Sat/Sun skipped... Mon→Sun = 4)
    expect(escalationDecision({ ...base, route: detention, now: new Date("2026-10-12T06:00:00Z") })).toMatchObject({
      escalate: true,
      workingDaysElapsed: 5,
    });
  });
  it("a holiday does not count as a working day", () => {
    // 2026-10-20 is a holiday in the policy calendar: created Wed 14 Oct, five working days is Wed 21 not Tue 20.
    const created = new Date("2026-10-14T06:00:00Z");
    expect(
      escalationDecision({ ...base, createdAt: created, route: detention, now: new Date("2026-10-20T06:00:00Z") })
        .escalate,
    ).toBe(false);
    expect(
      escalationDecision({ ...base, createdAt: created, route: detention, now: new Date("2026-10-22T06:00:00Z") })
        .escalate,
    ).toBe(true);
  });
  it("a decision stops the clock for 'no decision' routes", () => {
    expect(
      escalationDecision({ ...base, route: detention, status: "APPROVED", now: new Date("2026-11-30T06:00:00Z") })
        .escalate,
    ).toBe(false);
  });
  it("High Flyer: mentor review if no quest has started after the window, counted from approval", () => {
    const hf = policy.routes.false_positive_high_flyer;
    const input = {
      ...base,
      route: hf,
      status: "DISPATCHED" as const,
      decidedAt: new Date("2026-10-05T06:00:00Z"),
      now: new Date("2026-11-02T06:00:00Z"),
    };
    expect(escalationDecision(input).escalate).toBe(true);
    expect(escalationDecision({ ...input, questStarted: true }).escalate).toBe(false);
    expect(escalationDecision({ ...input, now: new Date("2026-10-12T06:00:00Z") }).escalate).toBe(false);
  });
  it("Drifting: the department head is informed after 21 days with no meeting", () => {
    const dr = policy.routes.drifting_student;
    const input = {
      ...base,
      route: dr,
      status: "DISPATCHED" as const,
      decidedAt: new Date("2026-09-01T06:00:00Z"),
      now: new Date("2026-10-11T06:00:00Z"),
    };
    expect(escalationDecision(input).escalate).toBe(true);
    expect(escalationDecision({ ...input, meetingLogged: true }).escalate).toBe(false);
  });
  it("a route without a time rule, a rejected one and an escalated one never escalate", () => {
    const mismatch = policy.routes.aspiration_mismatch;
    expect(escalationDecision({ ...base, route: mismatch, now: new Date("2027-01-01") }).escalate).toBe(false);
    expect(
      escalationDecision({ ...base, route: detention, status: "REJECTED", now: new Date("2027-01-01") }).escalate,
    ).toBe(false);
    expect(
      escalationDecision({ ...base, route: detention, alreadyEscalated: true, now: new Date("2027-01-01") }).escalate,
    ).toBe(false);
  });
  it("SLA state: on track, due today, overdue", () => {
    const due = new Date("2026-10-14T06:00:00Z");
    expect(slaState(due, new Date("2026-10-12T06:00:00Z"), cal)).toMatchObject({
      state: "on_track",
      workingDaysLeft: 2,
    });
    expect(slaState(due, new Date("2026-10-14T01:00:00Z"), cal).state).toBe("due_today");
    expect(slaState(due, new Date("2026-10-16T06:00:00Z"), cal)).toMatchObject({
      state: "overdue",
      workingDaysLeft: -2,
    });
  });
});

describe("consent at dispatch (§8.1, §13.1)", () => {
  const none = {};
  const route = (name: string) => policy.routes[name];

  it("a route to the placement officer carrying persona flags needs 'persona_aeg' for placement", () => {
    expect(consentGaps(route("false_positive_high_flyer"), none)).toEqual([
      { role: "placement_officer", category: "persona_aeg", label: "Gap index and support flags" },
    ]);
    expect(consentGaps(route("false_positive_high_flyer"), { persona_aeg: { placement_officer: true } })).toEqual([]);
  });
  it("the E-Cell copy of the attendance route needs the traction evidence shared, and never attendance", () => {
    expect(consentGaps(route("detention_threat_builder"), none)).toEqual([
      { role: "ecell_coordinator", category: "artifacts_evidence", label: "Projects, certificates and evidence" },
    ]);
    expect(consentGaps(route("detention_threat_builder"), { artifacts_evidence: { ecell_coordinator: true } })).toEqual(
      [],
    );
    expect(route("detention_threat_builder").shares).not.toContain("academic_baseline");
  });
  it("assigned staff (mentor, class advisor) need no consent", () => {
    expect(consentGaps(route("aspiration_mismatch"), none)).toEqual([]);
    expect(consentGaps(route("drifting_student"), none)).toEqual([]);
    expect(consentGaps(route("attendance_critical"), none)).toEqual([]);
  });
  it("consent for one office is not consent for another", () => {
    expect(
      consentGaps(route("detention_threat_builder"), { artifacts_evidence: { placement_officer: true } }),
    ).toHaveLength(1);
  });
  it("explains the block in words the approver can act on", () => {
    const text = explainGaps(consentGaps(route("false_positive_high_flyer"), none));
    expect(text).toMatch(/has not shared “Gap index and support flags” with the placement cell/);
    expect(text).toMatch(/nothing was sent/);
    expect(explainGaps([])).toBe("");
  });
});
