/**
 * Golden rubric tests (§15.1): the worked examples in §20 must reproduce to
 * one decimal place. If one of these fails, the engine — not the test — is wrong.
 */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/load";
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
});

describe("Appendix D seed records", () => {
  for (const r of SEED_RECORDS) {
    it(`${r.facts.studentId} → ${r.expectedPersona ?? "no persona"}`, () => {
      const e = evaluate(r.facts, policy);
      expect(e.primaryPersona).toBe(r.expectedPersona);
      if (r.expectedFloor) expect(levelRank(e.aegIndex)).toBeGreaterThanOrEqual(levelRank(r.expectedFloor));
    });
  }
});
