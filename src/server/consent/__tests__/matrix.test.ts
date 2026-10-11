import { describe, expect, it } from "vitest";
import { ACCESS_MATRIX, DATA_CATEGORIES, decideAccess } from "../matrix";

describe("§13.1 access matrix", () => {
  it("covers every data category", () => {
    for (const c of DATA_CATEGORIES) expect(ACCESS_MATRIX[c]).toBeDefined();
  });

  it("students see only their own record", () => {
    expect(decideAccess({ role: "student", category: "persona_aeg", isSelf: true }).allowed).toBe(true);
    expect(decideAccess({ role: "student", category: "persona_aeg", isSelf: false }).allowed).toBe(false);
  });

  it("placement sees persona flags only with consent", () => {
    expect(
      decideAccess({
        role: "placement_officer",
        category: "persona_aeg",
        consented: false,
      }).allowed,
    ).toBe(false);
    expect(
      decideAccess({
        role: "placement_officer",
        category: "persona_aeg",
        consented: true,
      }).allowed,
    ).toBe(true);
  });

  it("deans get aggregates, never an individual narrative", () => {
    expect(
      decideAccess({
        role: "dean",
        category: "academic_baseline",
        individual: true,
      }).allowed,
    ).toBe(false);
    expect(
      decideAccess({
        role: "dean",
        category: "academic_baseline",
        individual: false,
      }).scope,
    ).toBe("aggregate");
    expect(decideAccess({ role: "dean", category: "evaluation_narrative" }).allowed).toBe(false);
  });

  it("mentors need a reason code for non-assigned students", () => {
    expect(
      decideAccess({
        role: "faculty_mentor",
        category: "artifacts_evidence",
        isAssigned: false,
      }).allowed,
    ).toBe(false);
    expect(
      decideAccess({
        role: "faculty_mentor",
        category: "artifacts_evidence",
        isAssigned: false,
        reasonCode: "audit_request",
      }).allowed,
    ).toBe(true);
  });

  it("E-Cell never sees attendance (CS-44 receives traction only)", () => {
    expect(
      decideAccess({
        role: "ecell_coordinator",
        category: "academic_baseline",
        consented: true,
      }).allowed,
    ).toBe(false);
    expect(
      decideAccess({
        role: "ecell_coordinator",
        category: "artifacts_evidence",
        consented: true,
      }).allowed,
    ).toBe(true);
  });

  it("auditors see sampled evidence only with a reason", () => {
    expect(decideAccess({ role: "auditor", category: "artifacts_evidence" }).allowed).toBe(false);
    expect(
      decideAccess({
        role: "auditor",
        category: "artifacts_evidence",
        reasonCode: "naac_sample",
      }).allowed,
    ).toBe(true);
  });

  it("registrar has no personal scores by default", () => {
    expect(decideAccess({ role: "registrar", category: "mock_scores" }).allowed).toBe(false);
    expect(decideAccess({ role: "registrar", category: "persona_aeg" }).allowed).toBe(false);
  });

  describe("§8.1 and §13.1 Phase 6 exit gate: dispatch without consent is impossible", () => {
    it("denies dispatch access to placement_officer when consent is missing", () => {
      const decision = decideAccess({
        role: "placement_officer",
        category: "persona_aeg",
        consented: false,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toMatch(/student has not consented/i);
    });

    it("allows dispatch access to placement_officer when consent is granted", () => {
      const decision = decideAccess({
        role: "placement_officer",
        category: "persona_aeg",
        consented: true,
      });
      expect(decision.allowed).toBe(true);
    });

    it("denies dispatch access to ecell_coordinator for academic/persona data regardless of consent", () => {
      const decision = decideAccess({
        role: "ecell_coordinator",
        category: "persona_aeg",
        consented: true,
      });
      expect(decision.allowed).toBe(false);
    });

    it("allows assigned faculty mentor access by academic relationship without external consent record", () => {
      const decision = decideAccess({
        role: "faculty_mentor",
        category: "intervention_history",
        isAssigned: true,
      });
      expect(decision.allowed).toBe(true);
    });
  });
});
