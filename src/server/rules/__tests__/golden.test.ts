/**
 * Golden rubric tests (§15.1): the worked examples in §20 must reproduce to
 * one decimal place. If one of these fails, the engine — not the test — is wrong.
 */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import { addWorkingDays, toDateKey } from "../../services/time";
import { evaluate, gapIndex, gapRatio, levelRank, round1, round2, scoreTrack, whatIf } from "..";
import { CS_44, EE_12, ME_27, SEED_RECORDS } from "../fixtures";

const policy = loadPolicyFile("policy/2026.10-v1.json");

describe("§20.1 Example A — ME-27, Corporate Placement", () => {
  const s = scoreTrack("corporate_placement", ME_27, policy);
  const byKey = Object.fromEntries(s.components.map((c) => [c.key, c]));

  it("reproduces each component score", () => {
    expect(round2(byKey.academic_baseline.score)).toBe(74);
    expect(round2(byKey.aptitude.score)).toBe(52);
    expect(round2(byKey.domain_practical_evidence.score)).toBe(48.89);
    expect(round2(byKey.mock_interview_readiness.score)).toBe(62.5);
    expect(round2(byKey.verified_experience.score)).toBe(0);
  });

  it("reproduces each contribution", () => {
    expect(round2(byKey.academic_baseline.contribution)).toBe(11.1);
    expect(round2(byKey.aptitude.contribution)).toBe(13);
    expect(round2(byKey.domain_practical_evidence.contribution)).toBe(14.67);
    expect(round2(byKey.mock_interview_readiness.contribution)).toBe(9.38);
  });

  it("track score is 48.14 (48.1)", () => {
    expect(round2(s.score)).toBe(48.14);
    expect(round1(s.score)).toBe(48.1);
  });

  it("gap ratio 0.312 → MODERATE, no persona, MEDIUM confidence", () => {
    const e = evaluate(ME_27, policy);
    expect(Math.round(e.gapRatio * 1000) / 1000).toBe(0.312);
    expect(e.gapIndex).toBe("MODERATE");
    expect(e.personas).toHaveLength(0);
    expect(e.aegIndex).toBe("MODERATE");
    expect(e.trackScore.confidence).toBe("MEDIUM");
    expect(e.trackScore.dataGaps).toHaveLength(1);
    expect(e.routes).toHaveLength(0);
  });
});

describe("§20.2 What-if levers", () => {
  const gdtVerified = (f: typeof ME_27) => ({
    ...f,
    evidence: [
      ...f.evidence,
      {
        id: "ev-whatif-gdt",
        component: "domain_practical_evidence",
        standardItem: "gdt_assessment",
        label: "Timed GD&T assessment",
        status: "VERIFIED" as const,
      },
    ],
  });

  it("GD&T verified → 58.14, gap 0.169, MODERATE", () => {
    const e = whatIf(ME_27, gdtVerified, policy);
    expect(round2(e.trackScore.score)).toBe(58.14);
    expect(Math.round(e.gapRatio * 1000) / 1000).toBe(0.169);
    expect(e.gapIndex).toBe("MODERATE");
  });

  it("GD&T verified and aptitude 58 → 59.64, gap 0.148, LOW", () => {
    const e = whatIf(ME_27, (f) => ({ ...gdtVerified(f), campusAptitudePercentile: 58 }), policy);
    expect(round2(e.trackScore.score)).toBe(59.64);
    expect(Math.round(e.gapRatio * 1000) / 1000).toBe(0.148);
    expect(e.gapIndex).toBe("LOW");
  });

  it("what-if never mutates the base record", () => {
    whatIf(ME_27, gdtVerified, policy);
    expect(ME_27.evidence).toHaveLength(3);
  });
});

describe("§20.3 Example B — CS-44 Detention Threat Builder", () => {
  const e = evaluate(CS_44, policy);
  it("fires the persona with a CRITICAL floor and a WORSENING trend", () => {
    expect(e.primaryPersona).toBe("detention_threat_builder");
    expect(e.aegIndex).toBe("CRITICAL");
    expect(e.trend.signals.attendance.label).toBe("WORSENING");
    expect(e.trend.overall).toBe("WORSENING");
  });
  it("routes to the class advisor with a two-working-day SLA and an E-Cell copy", () => {
    expect(e.routes[0]).toMatchObject({
      routeKey: "detention_threat_builder",
      recipientRole: "class_advisor",
      slaWorkingDays: 2,
      copyRoles: ["ecell_coordinator"],
      queued: false,
    });
  });
});

describe("§20.4 Example C — EE-12 False-Positive High Flyer", () => {
  it("persona floor MODERATE; track score 52 gives gap 0.257, also MODERATE", () => {
    const e = evaluate(EE_12, policy);
    expect(e.primaryPersona).toBe("false_positive_high_flyer");
    expect(e.routes[0].recipientRole).toBe("placement_officer");
    expect(Math.round(gapRatio(70, 52) * 1000) / 1000).toBe(0.257);
    expect(gapIndex(gapRatio(70, 52), policy)).toBe("MODERATE");
  });
  it("the fixture's own record reproduces a track score of 52 (within 0.1)", () => {
    const e = evaluate(EE_12, policy);
    expect(Math.abs(e.trackScore.score - 52)).toBeLessThan(0.1);
    expect(e.gapIndex).toBe("MODERATE");
    expect(e.aegIndex).toBe("MODERATE");
    expect(e.routes[0]).toMatchObject({ routeKey: "false_positive_high_flyer", slaWorkingDays: 5, queued: false });
  });
});

describe("§20.3 CS-44: the numbers behind the persona", () => {
  const e = evaluate(CS_44, policy);
  it("attendance falls 3 points a week and the artifact score beats the cohort 75th percentile", () => {
    expect(e.trend.signals.attendance.slope).toBeCloseTo(-3, 9);
    expect(CS_44.artifactScore).toBe(71);
    expect(CS_44.cohortArtifactP75).toBe(66);
    expect(e.personas[0].reasons.join(" ")).toMatch(/62%/);
  });
  it("does not set the attendance-critical flag, because the persona fired instead", () => {
    expect(e.attendanceCriticalFlag).toBe(false);
  });
  it("below the artifact condition a student gets the attendance flag and no persona (§7.3)", () => {
    const low = evaluate({ ...CS_44, artifactScore: 40 }, policy);
    expect(low.primaryPersona).toBeNull();
    expect(low.attendanceCriticalFlag).toBe(true);
    expect(low.routes.map((r) => r.routeKey)).toEqual(["attendance_critical"]);
  });
});

describe("Appendix D, record by record", () => {
  const byId = Object.fromEntries(SEED_RECORDS.map((r) => [r.facts.studentId, evaluate(r.facts, policy)]));
  it.each([
    ["SYN-01", "false_positive_high_flyer", "MODERATE"],
    ["SYN-02", null, "LOW"],
    ["SYN-03", "detention_threat_builder", "CRITICAL"],
    ["SYN-04", null, "MODERATE"],
  ] as const)("%s → %s with index %s", (id, persona, index) => {
    expect(byId[id].primaryPersona).toBe(persona);
    expect(byId[id].aegIndex).toBe(index);
  });
  it.each(["SYN-05", "SYN-06", "SYN-07"])("%s carries a MODERATE floor at least (the gap may raise it)", (id) => {
    expect(levelRank(byId[id].aegIndex)).toBeGreaterThanOrEqual(levelRank("MODERATE"));
    expect(byId[id].personas[0].floor).toBe("MODERATE");
  });
  it("SYN-02 gets no coding penalty: its score uses Commerce items only", () => {
    const gaps = byId["SYN-02"].trackScore.dataGaps.join(" ").toLowerCase();
    expect(gaps).not.toMatch(/coding|deployed|repository/);
    expect(byId["SYN-02"].trackScore.dataGaps.join(" ")).toMatch(/Statutory taxation/);
  });
  it("SYN-04 lists the pending GCP module as a data gap", () => {
    expect(byId["SYN-04"].trackScore.dataGaps.join(" ")).toMatch(/Good Clinical Practice/);
  });
  it("SYN-06 has no declared track, so the passport score is not shown", () => {
    expect(byId["SYN-06"].scoreShown).toBe(false);
  });
  it("routes follow precedence: one primary route, the rest queued (§7.4)", () => {
    const both = evaluate(
      {
        ...EE_12,
        attendancePct: 60,
        artifactScore: 90,
        cohortArtifactP75: 66,
        year: 3,
        aspiration: { ...EE_12.aspiration, targetType: "abroad" },
        activeBacklogs: 3,
        monthsToDeadline: 8,
      },
      policy,
    );
    expect(both.personas.map((p) => p.persona).sort()).toEqual([
      "aspiration_mismatch",
      "detention_threat_builder",
      "false_positive_high_flyer",
    ]);
    expect(both.routes.map((r) => [r.routeKey, r.queued])).toEqual([
      ["detention_threat_builder", false],
      ["aspiration_mismatch", true],
      ["false_positive_high_flyer", true],
    ]);
  });
});

describe("Appendix D seed records (§20, Appendix D)", () => {
  const byId = Object.fromEntries(SEED_RECORDS.map((r) => [r.facts.studentId, r]));

  it("SYN-01: False-Positive High Flyer with 5-working-day placement officer route", () => {
    const syn01 = byId["SYN-01"];
    const e = evaluate(syn01.facts, policy);
    expect(e.primaryPersona).toBe("false_positive_high_flyer");
    expect(e.aegIndex).toBe("MODERATE");
    expect(levelRank(e.aegIndex)).toBeGreaterThanOrEqual(levelRank("MODERATE"));
    expect(e.routes[0]).toMatchObject({
      routeKey: "false_positive_high_flyer",
      recipientRole: "placement_officer",
      slaWorkingDays: 5,
    });

    // Friday Oct 9, 2026 + 5 working days -> Friday Oct 16, 2026
    const evalDate = new Date(2026, 9, 9);
    const due = addWorkingDays(evalDate, e.routes[0].slaWorkingDays, policy.calendar.holidays);
    expect(toDateKey(due)).toBe("2026-10-16");
  });

  it("SYN-02: Balanced commerce student has no persona and healthy index", () => {
    const syn02 = byId["SYN-02"];
    const e = evaluate(syn02.facts, policy);
    expect(e.primaryPersona).toBeNull();
    expect(e.personas).toHaveLength(0);
    expect(e.aegIndex).toBe("LOW");
    expect(e.routes).toHaveLength(0);
  });

  it("SYN-03: Detention Threat Builder with 2-working-day SLA and E-Cell copy", () => {
    const syn03 = byId["SYN-03"];
    const e = evaluate(syn03.facts, policy);
    expect(e.primaryPersona).toBe("detention_threat_builder");
    expect(e.aegIndex).toBe("CRITICAL");
    expect(e.trend.overall).toBe("WORSENING");
    expect(e.routes[0]).toMatchObject({
      routeKey: "detention_threat_builder",
      recipientRole: "class_advisor",
      slaWorkingDays: 2,
      copyRoles: ["ecell_coordinator"],
    });

    // Friday Oct 9, 2026 + 2 working days -> Tuesday Oct 13, 2026
    const evalDate = new Date(2026, 9, 9);
    const due = addWorkingDays(evalDate, e.routes[0].slaWorkingDays, policy.calendar.holidays);
    expect(toDateKey(due)).toBe("2026-10-13");
  });

  it("SYN-04: Biotech student without emergency flags", () => {
    const syn04 = byId["SYN-04"];
    const e = evaluate(syn04.facts, policy);
    expect(e.primaryPersona).toBeNull();
    expect(e.personas).toHaveLength(0);
    expect(e.routes).toHaveLength(0);
  });

  it("SYN-05: Aspiration Mismatch (abroad with backlogs) routed to mentor within 5 working days", () => {
    const syn05 = byId["SYN-05"];
    const e = evaluate(syn05.facts, policy);
    expect(e.primaryPersona).toBe("aspiration_mismatch");
    expect(levelRank(e.aegIndex)).toBeGreaterThanOrEqual(levelRank("MODERATE"));
    expect(e.routes[0]).toMatchObject({
      routeKey: "aspiration_mismatch",
      recipientRole: "faculty_mentor",
      slaWorkingDays: 5,
    });
  });

  it("SYN-06: Drifting Student (year 3 undeclared) routed to mentor within 7 working days", () => {
    const syn06 = byId["SYN-06"];
    const e = evaluate(syn06.facts, policy);
    expect(e.primaryPersona).toBe("drifting_student");
    expect(levelRank(e.aegIndex)).toBeGreaterThanOrEqual(levelRank("MODERATE"));
    expect(e.routes[0]).toMatchObject({
      routeKey: "drifting_student",
      recipientRole: "faculty_mentor",
      slaWorkingDays: 7,
    });

    // Friday Oct 9, 2026 + 7 working days with Oct 20 holiday (2026.10-v1):
    // Week 1: Oct 12, 13, 14, 15, 16 (5 days)
    // Week 2: Oct 19 (day 6), Oct 20 (holiday skipped!), Oct 21 (day 7) -> Oct 21, 2026
    const evalDate = new Date(2026, 9, 9);
    const due = addWorkingDays(evalDate, e.routes[0].slaWorkingDays, policy.calendar.holidays);
    expect(toDateKey(due)).toBe("2026-10-21");
  });

  it("SYN-07: Aspiration Mismatch (public service zero mocks) routed to mentor within 5 working days", () => {
    const syn07 = byId["SYN-07"];
    const e = evaluate(syn07.facts, policy);
    expect(e.primaryPersona).toBe("aspiration_mismatch");
    expect(levelRank(e.aegIndex)).toBeGreaterThanOrEqual(levelRank("MODERATE"));
    expect(e.routes[0]).toMatchObject({
      routeKey: "aspiration_mismatch",
      recipientRole: "faculty_mentor",
      slaWorkingDays: 5,
    });
  });

  it("all seed records satisfy their expected persona and floor bounds", () => {
    for (const r of SEED_RECORDS) {
      const e = evaluate(r.facts, policy);
      expect(e.primaryPersona).toBe(r.expectedPersona);
      if (r.expectedFloor) {
        expect(levelRank(e.aegIndex)).toBeGreaterThanOrEqual(levelRank(r.expectedFloor));
      }
    }
  });
});
