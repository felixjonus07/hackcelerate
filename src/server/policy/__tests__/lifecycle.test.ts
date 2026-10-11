/** Policy lifecycle (§3.3): two approvals for persona changes, no retroactive activation. */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../file";
import {
  approvalsRequired,
  canonical,
  changedSections,
  checkApprover,
  inForce,
  isFullyApproved,
  personaSectionsChanged,
  retroactiveActivation,
} from "../lifecycle";
import type { Policy } from "../schema";

const current = loadPolicyFile();
const clone = (): Policy => structuredClone(current);

describe("diffing versions", () => {
  it("ignores key order and identity fields", () => {
    const next = clone();
    next.policy_version = "2026.11-v2";
    next.effective_from = "2026-11-01";
    expect(changedSections(current, next)).toEqual([]);
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });

  it("names the sections that changed", () => {
    const next = clone();
    next.attendance.requirement_pct = 80;
    next.leaderboard.default_opt_in = true;
    expect(changedSections(current, next)).toEqual(["attendance", "leaderboard"]);
  });

  it("treats every section as changed when nothing was in force before", () => {
    expect(changedSections(null, current)).toContain("personas");
  });
});

describe("approvals required", () => {
  it("needs two approvals when a persona trigger changes", () => {
    const next = clone();
    next.personas.detention_threat_builder.attendance_below_pct = 60;
    expect(personaSectionsChanged(current, next)).toBe(true);
    expect(approvalsRequired(current, next)).toBe(2);
  });

  it("needs two approvals when a persona floor or the precedence changes", () => {
    const floor = clone();
    floor.personas.false_positive_high_flyer.floor = "CRITICAL";
    expect(approvalsRequired(current, floor)).toBe(2);
    const order = clone();
    order.persona_precedence = [...order.persona_precedence].reverse();
    expect(approvalsRequired(current, order)).toBe(2);
  });

  it("needs one approval for other changes", () => {
    const next = clone();
    next.attendance.requirement_pct = 80;
    expect(approvalsRequired(current, next)).toBe(1);
  });

  it("needs two approvals for the first version ever activated", () => {
    expect(approvalsRequired(null, current)).toBe(2);
  });
});

describe("who may approve", () => {
  const registrar = { id: "u1", role: "registrar" };
  const dean = { id: "u2", role: "dean" };
  const at = "2026-10-11T00:00:00Z";

  it("accepts only the registrar or the dean", () => {
    expect(checkApprover([], { id: "u3", role: "faculty_mentor" }, 1)).toMatchObject({ ok: false, code: "role" });
    expect(checkApprover([], registrar, 1).ok).toBe(true);
  });

  it("rejects the same person twice", () => {
    expect(checkApprover([{ userId: "u1", role: "registrar", at }], registrar, 2)).toMatchObject({
      ok: false,
      code: "duplicate",
    });
  });

  it("needs different offices for a persona change", () => {
    expect(checkApprover([{ userId: "u1", role: "registrar", at }], { id: "u9", role: "registrar" }, 2)).toMatchObject({
      ok: false,
      code: "same_role",
    });
    expect(checkApprover([{ userId: "u1", role: "registrar", at }], dean, 2).ok).toBe(true);
  });

  it("counts approvals against what the change requires", () => {
    const one = [{ userId: "u1", role: "registrar", at }];
    expect(isFullyApproved(one, 1)).toBe(true);
    expect(isFullyApproved(one, 2)).toBe(false);
  });
});

describe("retroactive activation", () => {
  it("blocks a version that starts inside a reported period", () => {
    expect(retroactiveActivation("2026-10-01", "2026-10-05")).toBe(true);
    expect(retroactiveActivation("2026-10-05", "2026-10-05")).toBe(true);
  });
  it("allows a version that starts after the last report, or when nothing was reported", () => {
    expect(retroactiveActivation("2026-10-06", "2026-10-05")).toBe(false);
    expect(retroactiveActivation("2026-10-01", null)).toBe(false);
  });
});

describe("the version in force", () => {
  const rows = [
    { version: "a", status: "ACTIVE" as const, effectiveFrom: new Date("2026-01-01") },
    { version: "b", status: "ACTIVE" as const, effectiveFrom: new Date("2026-06-01") },
    { version: "c", status: "ACTIVE" as const, effectiveFrom: new Date("2027-01-01") },
    { version: "d", status: "DRAFT" as const, effectiveFrom: new Date("2026-07-01") },
    { version: "e", status: "RETIRED" as const, effectiveFrom: new Date("2026-08-01") },
  ];
  it("picks the latest active version that has started", () => {
    expect(inForce(rows, new Date("2026-10-11"))?.version).toBe("b");
    expect(inForce(rows, new Date("2027-02-01"))?.version).toBe("c");
  });
  it("breaks a tie on the effective date by the activation time", () => {
    const same = [
      {
        version: "x",
        status: "ACTIVE" as const,
        effectiveFrom: new Date("2026-06-01"),
        activatedAt: new Date("2026-05-01"),
      },
      {
        version: "y",
        status: "ACTIVE" as const,
        effectiveFrom: new Date("2026-06-01"),
        activatedAt: new Date("2026-05-02"),
      },
    ];
    expect(inForce(same, new Date("2026-10-11"))?.version).toBe("y");
  });
  it("returns null before any active version has started", () => {
    expect(inForce(rows, new Date("2025-12-31"))).toBeNull();
  });
});
