import { describe, expect, it } from "vitest";
import { clearPolicyCache, getActivePolicy, loadPolicyFile } from "../load";
import { parsePolicy } from "../schema";

describe("§3 Institutional Policy & Governance", () => {
  it("successfully loads and parses the default policy file", () => {
    const policy = loadPolicyFile();
    expect(policy.policy_version).toBe("2026.10-v1");
    expect(policy.academic.cgpa_scale_max).toBe(10);
    expect(policy.attendance.requirement_pct).toBe(75);
    expect(policy.tracks.corporate_placement).toBeDefined();
  });

  it("caches loaded policy file and allows clearing cache", () => {
    clearPolicyCache();
    const p1 = getActivePolicy();
    const p2 = getActivePolicy();
    expect(p1).toBe(p2);
  });

  it("rejects policy when track component weights do not sum to 100 (§5.3)", () => {
    const raw = JSON.parse(JSON.stringify(loadPolicyFile()));
    // Alter Corporate Placement components so sum = 95 instead of 100
    raw.tracks.corporate_placement.components.academic_baseline = 10; // was 15

    expect(() => parsePolicy(raw)).toThrowError(/Track component weights must sum to 100/);
  });

  it("rejects policy when weights exceed 100", () => {
    const raw = JSON.parse(JSON.stringify(loadPolicyFile()));
    // Alter Corporate Placement components so sum = 105 instead of 100
    raw.tracks.corporate_placement.components.academic_baseline = 20; // was 15

    expect(() => parsePolicy(raw)).toThrowError(/Track component weights must sum to 100/);
  });

  it("enforces valid persona and AEG band definitions", () => {
    const raw = JSON.parse(JSON.stringify(loadPolicyFile()));
    raw.aeg_bands.critical_from = -0.5; // invalid
    expect(() => parsePolicy(raw)).toThrow();
  });

  it("parses and validates institution holiday calendar (§8.1)", () => {
    const policy = loadPolicyFile();
    expect(policy.calendar).toBeDefined();
    expect(Array.isArray(policy.calendar.holidays)).toBe(true);
    expect(policy.calendar.holidays).toContain("2026-10-20");
  });
});
