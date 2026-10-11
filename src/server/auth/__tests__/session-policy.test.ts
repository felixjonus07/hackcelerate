import { describe, expect, it } from "vitest";
import { sessionPolicyFor } from "../session-policy";

const config = {
  staffIdleMinutes: 30,
  staffMaxHours: 8,
  studentIdleMinutes: 30,
  studentMaxHours: 12,
  studentTrustedDays: 30,
  warningSeconds: 120,
};

describe("session policy (§13.2)", () => {
  it("staff get a short idle timeout and an 8-hour ceiling", () => {
    expect(sessionPolicyFor("faculty_mentor", false, config)).toEqual({
      idleSeconds: 1800,
      absoluteSeconds: 28_800,
      warningSeconds: 120,
      trusted: false,
    });
  });

  it("staff can never be trusted, even if they tick 'keep me signed in'", () => {
    for (const role of ["dean", "registrar", "class_advisor", "auditor"]) {
      const p = sessionPolicyFor(role, true, config);
      expect(p.trusted).toBe(false);
      expect(p.absoluteSeconds).toBe(28_800);
    }
  });

  it("students default to the short policy", () => {
    expect(sessionPolicyFor("student", false, config)).toMatchObject({
      idleSeconds: 1800,
      absoluteSeconds: 43_200,
      trusted: false,
    });
  });

  it("students on a trusted device stay signed in for 30 days", () => {
    expect(sessionPolicyFor("student", true, config)).toMatchObject({
      idleSeconds: 2_592_000,
      absoluteSeconds: 2_592_000,
      trusted: true,
    });
  });

  it("unknown roles fall back to the strict staff policy", () => {
    expect(sessionPolicyFor("something_else", true, config).trusted).toBe(false);
  });
});
