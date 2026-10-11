import { describe, expect, it } from "vitest";
import {
  checkArtifactUrl,
  checkAttendanceSeries,
  checkAttendanceWeek,
  checkCgpa,
  checkDateOfBirth,
  checkMockAttempt,
  checkRollNumber,
} from "../quality";

describe("§4.3 Data Quality Rules", () => {
  describe("checkCgpa", () => {
    it("accepts valid CGPA within 0 to scaleMax", () => {
      expect(checkCgpa(7.5, 10)).toEqual({ ok: true });
      expect(checkCgpa(0, 10)).toEqual({ ok: true });
      expect(checkCgpa(10, 10)).toEqual({ ok: true });
    });

    it("rejects missing, null or NaN CGPA", () => {
      expect(checkCgpa(null, 10)).toEqual({ ok: false, reason: "CGPA missing" });
      expect(checkCgpa(undefined, 10)).toEqual({ ok: false, reason: "CGPA missing" });
      expect(checkCgpa(Number.NaN, 10)).toEqual({ ok: false, reason: "CGPA missing" });
    });

    it("rejects CGPA outside scale boundaries", () => {
      expect(checkCgpa(-0.5, 10).ok).toBe(false);
      expect(checkCgpa(10.5, 10).ok).toBe(false);
      expect(checkCgpa(4.5, 4).ok).toBe(false);
    });
  });

  describe("checkAttendanceWeek", () => {
    it("accepts valid attendance numbers", () => {
      expect(checkAttendanceWeek(20, 18)).toEqual({ ok: true });
      expect(checkAttendanceWeek(10, 10)).toEqual({ ok: true });
      expect(checkAttendanceWeek(15, 0)).toEqual({ ok: true });
    });

    it("rejects invalid classes held", () => {
      expect(checkAttendanceWeek(0, 0)).toEqual({
        ok: false,
        reason: "Classes held must be greater than 0",
      });
      expect(checkAttendanceWeek(-5, 0)).toEqual({
        ok: false,
        reason: "Classes held must be greater than 0",
      });
    });

    it("rejects attended greater than held or negative attended", () => {
      expect(checkAttendanceWeek(10, 12)).toEqual({
        ok: false,
        reason: "Attended exceeds held",
      });
      expect(checkAttendanceWeek(10, -2)).toEqual({
        ok: false,
        reason: "Classes attended cannot be negative",
      });
    });
  });

  describe("checkAttendanceSeries (§4.3 confidence degradation)", () => {
    it("maintains HIGH confidence when 0-2 weeks are missing", () => {
      const weeks = Array.from({ length: 15 }, (_, i) => ({
        weekStart: `2026-08-${String(i + 1).padStart(2, "0")}`,
        held: 20,
        attended: 18,
      }));
      const res = checkAttendanceSeries(weeks, 16);
      expect(res.missingCount).toBe(1);
      expect(res.confidenceCeiling).toBe("HIGH");
    });

    it("degrades confidence to MEDIUM when 3-4 weeks are missing", () => {
      const weeks = Array.from({ length: 13 }, (_, i) => ({
        weekStart: `2026-08-${String(i + 1).padStart(2, "0")}`,
        held: 20,
        attended: 18,
      }));
      const res = checkAttendanceSeries(weeks, 16);
      expect(res.missingCount).toBe(3);
      expect(res.confidenceCeiling).toBe("MEDIUM");
    });

    it("degrades confidence to LOW when more than 4 weeks are missing", () => {
      const weeks = Array.from({ length: 10 }, (_, i) => ({
        weekStart: `2026-08-${String(i + 1).padStart(2, "0")}`,
        held: 20,
        attended: 18,
      }));
      const res = checkAttendanceSeries(weeks, 16);
      expect(res.missingCount).toBe(6);
      expect(res.confidenceCeiling).toBe("LOW");
    });
  });

  describe("checkMockAttempt", () => {
    it("accepts score in range with valid speed", () => {
      const res = checkMockAttempt(78, [0, 100], 45);
      expect(res.ok).toBe(true);
      expect(res.excludeFromPercentile).toBe(false);
      expect(res.flagForReview).toBe(false);
    });

    it("flags and excludes score outside range", () => {
      const res = checkMockAttempt(105, [0, 100], 45);
      expect(res.ok).toBe(false);
      expect(res.excludeFromPercentile).toBe(true);
      expect(res.flagForReview).toBe(true);
    });

    it("flags and excludes attempt with missing or zero speed", () => {
      const res = checkMockAttempt(80, [0, 100], 0);
      expect(res.ok).toBe(false);
      expect(res.excludeFromPercentile).toBe(true);
      expect(res.flagForReview).toBe(true);
    });
  });

  describe("checkArtifactUrl", () => {
    it("accepts valid http and https URLs", () => {
      expect(checkArtifactUrl("https://github.com/org/repo").ok).toBe(true);
      expect(checkArtifactUrl("http://example.com/project").ok).toBe(true);
    });

    it("rejects non-web schemes and malformed URLs", () => {
      expect(checkArtifactUrl("ftp://files.example.com").ok).toBe(false);
      expect(checkArtifactUrl("file:///C:/local/file.pdf").ok).toBe(false);
      expect(checkArtifactUrl("not-a-url").ok).toBe(false);
    });

    it("flags status UNVERIFIED when reachability window > 14 days", () => {
      const submittedAt = new Date("2026-09-01");
      const asOf = new Date("2026-09-20"); // 19 days later
      const res = checkArtifactUrl("https://github.com/student/repo", { submittedAt, asOf });
      expect(res.ok).toBe(false);
      expect(res.statusIfFailed).toBe("UNVERIFIED");
      expect(res.reason).toContain("exceeded 14 days");
    });
  });

  describe("checkRollNumber", () => {
    it("accepts valid institution roll numbers", () => {
      expect(checkRollNumber("ME20260412").ok).toBe(true);
      expect(checkRollNumber("CS2601").ok).toBe(true);
      expect(checkRollNumber("SYN26001").ok).toBe(true);
    });

    it("rejects invalid or missing roll numbers", () => {
      expect(checkRollNumber("").ok).toBe(false);
      expect(checkRollNumber(null).ok).toBe(false);
      expect(checkRollNumber("12345").ok).toBe(false);
      expect(checkRollNumber("INVALID!ROLL#").ok).toBe(false);
    });
  });

  describe("checkDateOfBirth (§4.3 and §13.4 parental consent)", () => {
    const asOf = new Date("2026-10-11");

    it("identifies under-18 student and flags parental consent required", () => {
      // 17 years old
      const dob = "2009-05-15";
      const res = checkDateOfBirth(dob, 1, asOf);
      expect(res.ok).toBe(true);
      expect(res.ageYears).toBe(17);
      expect(res.isUnder18).toBe(true);
      expect(res.parentalConsentRequired).toBe(true);
    });

    it("accepts adult student without parental consent flag", () => {
      // 20 years old in Year 2
      const dob = "2006-03-10";
      const res = checkDateOfBirth(dob, 2, asOf);
      expect(res.ok).toBe(true);
      expect(res.ageYears).toBe(20);
      expect(res.isUnder18).toBe(false);
      expect(res.parentalConsentRequired).toBe(false);
    });

    it("rejects future date or missing date", () => {
      expect(checkDateOfBirth(null, 1, asOf).ok).toBe(false);
      expect(checkDateOfBirth("2027-01-01", 1, asOf).ok).toBe(false);
    });

    it("rejects age inconsistent with year of study", () => {
      // Age 17 in Year 4 (expected min age is 19)
      const res = checkDateOfBirth("2009-05-01", 4, asOf);
      expect(res.ok).toBe(false);
      expect(res.reason).toContain("inconsistent with year 4 of study");
    });
  });
});
