/** Policy schema (§3.1): weights must sum to 100, and cross-field rules reject incoherent files. */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../file";
import { parsePolicy } from "../schema";

// A mutable copy for tests to break on purpose; the type is loose because the cases corrupt it.
// biome-ignore lint/suspicious/noExplicitAny: tests edit arbitrary nested fields
const base = () => structuredClone(loadPolicyFile()) as any;

describe("policy file", () => {
  it("loads and validates the bundled file", () => {
    expect(loadPolicyFile().policy_version).toBe("2026.10-v1");
  });

  it("rejects a track whose component weights do not sum to 100", () => {
    const doc = base();
    doc.tracks.corporate_placement.components.aptitude = 26;
    expect(() => parsePolicy(doc)).toThrow(/sum to 100/);
  });

  it("accepts weights that sum to 100 in a different split", () => {
    const doc = base();
    doc.tracks.corporate_placement.components.aptitude = 20;
    doc.tracks.corporate_placement.components.academic_baseline = 20;
    expect(() => parsePolicy(doc)).not.toThrow();
  });

  it("rejects a persona missing from the precedence list", () => {
    const doc = base();
    doc.persona_precedence = ["detention_threat_builder"];
    expect(() => parsePolicy(doc)).toThrow(/persona_precedence/);
  });

  it("rejects bands that overlap and a floor above the requirement", () => {
    const a = base();
    a.aeg_bands = { moderate_from: 0.4, critical_from: 0.35 };
    expect(() => parsePolicy(a)).toThrow(/moderate_from/);
    const b = base();
    b.attendance.condonation_floor_pct = 80;
    expect(() => parsePolicy(b)).toThrow(/condonation/);
  });

  it("rejects an ERP mapping that omits the roll number", () => {
    const doc = base();
    delete doc.ingestion.erp_columns.roll_number;
    expect(() => parsePolicy(doc)).toThrow(/roll_number/);
  });

  it("rejects an invalid roll number pattern", () => {
    const doc = base();
    doc.data_quality.roll_number_pattern = "([";
    expect(() => parsePolicy(doc)).toThrow(/regular expression/);
  });
});
