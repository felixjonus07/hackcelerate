/** One block per row of the §4.3 data-quality table. */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import {
  assessAttendance,
  checkArtifactUrl,
  checkAttendanceWeek,
  checkCgpa,
  checkDateOfBirth,
  checkMockAttempt,
  checkRollNumber,
  isMinor,
  reachabilityWindowExpired,
  termAttendancePct,
} from "../quality";

const policy = loadPolicyFile();
const week = (weekStart: string, held = 20, attended = 18) => ({ weekStart, held, attended });

describe("§4.3 CGPA: between 0 and the scale maximum", () => {
  it("accepts the boundaries and anything between", () => {
    for (const v of [0, 5.5, 10]) expect(checkCgpa(v, 10).ok).toBe(true);
  });
  it("rejects values outside the scale, and missing values", () => {
    expect(checkCgpa(10.01, 10)).toMatchObject({ ok: false });
    expect(checkCgpa(-0.1, 10)).toMatchObject({ ok: false });
    expect(checkCgpa(null, 10)).toEqual({ ok: false, reason: "CGPA missing" });
    expect(checkCgpa(Number.NaN, 10).ok).toBe(false);
  });
  it("respects another scale", () => {
    expect(checkCgpa(3.9, 4).ok).toBe(true);
    expect(checkCgpa(4.5, 4).ok).toBe(false);
  });
});

describe("§4.3 Attendance: attended ≤ held, held > 0", () => {
  it("accepts a full and a partial week", () => {
    expect(checkAttendanceWeek(20, 20).ok).toBe(true);
    expect(checkAttendanceWeek(20, 0).ok).toBe(true);
  });
  it("rejects zero held, attended above held, and impossible counts", () => {
    expect(checkAttendanceWeek(0, 0)).toMatchObject({ ok: false });
    expect(checkAttendanceWeek(10, 11)).toMatchObject({ ok: false });
    expect(checkAttendanceWeek(10, -1).ok).toBe(false);
    expect(checkAttendanceWeek(10.5, 5).ok).toBe(false);
  });

  describe("missing weeks lower confidence", () => {
    const asOf = "2026-10-12"; // a Monday, 11 weeks into the term
    const full = [
      "2026-08-24",
      "2026-08-31",
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
      "2026-10-05",
      "2026-10-12",
    ];

    it("no cap when every week in the window has a valid record", () => {
      const q = assessAttendance(
        full.map((w) => week(w)),
        asOf,
        policy,
      );
      expect(q.missingWeeks).toBe(0);
      expect(q.cap).toBe("NONE");
    });
    it("two missing weeks are tolerated", () => {
      const q = assessAttendance(
        full.slice(2).map((w) => week(w)),
        asOf,
        policy,
      );
      expect(q.missingWeeks).toBe(2);
      expect(q.cap).toBe("NONE");
    });
    it("more than two missing weeks cap confidence at MEDIUM", () => {
      const q = assessAttendance(
        full.slice(3).map((w) => week(w)),
        asOf,
        policy,
      );
      expect(q.missingWeeks).toBe(3);
      expect(q.cap).toBe("MEDIUM");
    });
    it("more than four missing weeks cap confidence at LOW", () => {
      const q = assessAttendance(
        full.slice(5).map((w) => week(w)),
        asOf,
        policy,
      );
      expect(q.missingWeeks).toBe(5);
      expect(q.cap).toBe("LOW");
    });
    it("excludes an invalid week and counts it as missing", () => {
      const rows = full.map((w) => week(w));
      rows[7] = week("2026-10-12", 10, 12);
      const q = assessAttendance(rows, asOf, policy);
      expect(q.excluded).toEqual([{ weekStart: "2026-10-12", reason: "Classes attended exceed classes held" }]);
      expect(q.missingWeeks).toBe(1);
    });
    it("sums a week's courses and ignores weeks outside the term", () => {
      const q = assessAttendance(
        [week("2026-10-05", 10, 9), { weekStart: "2026-10-07", held: 10, attended: 5 }, week("2026-06-01")],
        asOf,
        policy,
      );
      expect(q.weeks).toEqual([{ weekStart: "2026-10-05", held: 20, attended: 14 }]);
    });
    it("does not count weeks before the term started as missing", () => {
      // The window reaches back into June, but only 27 Jul and 3 Aug are inside the term; 27 Jul has no record.
      const early = assessAttendance([week("2026-08-03")], "2026-08-03", policy);
      expect(early.missingWeeks).toBe(1);
    });
  });

  it("computes term attendance as attended over held", () => {
    expect(
      termAttendancePct([
        { held: 20, attended: 15 },
        { held: 20, attended: 10 },
      ]),
    ).toBe(62.5);
    expect(termAttendancePct([])).toBeNull();
  });
});

describe("§4.3 Mock attempt: score within the test range, seconds per item present", () => {
  const ok = { score: 40, maxScore: 100, avgSecondsPerItem: 30 };
  it("accepts a valid attempt and the range ends", () => {
    expect(checkMockAttempt(ok).ok).toBe(true);
    expect(checkMockAttempt({ ...ok, score: 0 }).ok).toBe(true);
    expect(checkMockAttempt({ ...ok, score: 100 }).ok).toBe(true);
  });
  it("flags a score outside the range", () => {
    expect(checkMockAttempt({ ...ok, score: 101 })).toMatchObject({ ok: false });
    expect(checkMockAttempt({ ...ok, score: -1 })).toMatchObject({ ok: false });
  });
  it("flags missing score or seconds per item", () => {
    expect(checkMockAttempt({ ...ok, score: null }).ok).toBe(false);
    expect(checkMockAttempt({ ...ok, avgSecondsPerItem: null }).ok).toBe(false);
    expect(checkMockAttempt({ ...ok, avgSecondsPerItem: 0 }).ok).toBe(false);
  });
});

describe("§4.3 Artifact URL: valid scheme, reachable within 14 days", () => {
  it("accepts http and https links", () => {
    expect(checkArtifactUrl("https://github.com/a/b", policy).ok).toBe(true);
    expect(checkArtifactUrl("http://example.org", policy).ok).toBe(true);
  });
  it("rejects other schemes and non-URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "ftp://x.org/a",
      "file:///etc/passwd",
      "data:text/html,hi",
      "not a url",
      "",
    ])
      expect(checkArtifactUrl(bad, policy).ok, bad).toBe(false);
  });
  it("closes the reachability window after 14 days", () => {
    expect(reachabilityWindowExpired("2026-10-01", "2026-10-15", policy)).toBe(false);
    expect(reachabilityWindowExpired("2026-10-01", "2026-10-16", policy)).toBe(true);
  });
});

describe("§4.3 Student ID: matches the ERP roll number format", () => {
  const pattern = policy.data_quality.roll_number_pattern;
  it("accepts well-formed roll numbers", () => {
    for (const r of ["SYN26000", "ME21001", "CSE20240123"]) expect(checkRollNumber(r, pattern).ok, r).toBe(true);
  });
  it("rejects malformed ones", () => {
    for (const r of ["", "123", "me21001", "ME-21001", "ME21", "ME210011223", "ME21001 "])
      expect(checkRollNumber(r, pattern).ok, r).toBe(false);
  });
});

describe("§4.3 Date of birth: present, consistent with year of study, minors flagged", () => {
  const asOf = "2026-10-11";
  it("accepts a typical third-year student and reports they are an adult", () => {
    expect(checkDateOfBirth("2005-03-02", 3, asOf, policy)).toMatchObject({ ok: true, minor: false, age: 21 });
  });
  it("routes anyone under 18 to the parental consent check", () => {
    expect(checkDateOfBirth("2009-01-01", 1, asOf, policy)).toMatchObject({ ok: true, minor: true, age: 17 });
    expect(isMinor("2009-01-01", asOf, policy)).toBe(true);
    expect(isMinor("2008-10-11", asOf, policy)).toBe(false); // turns 18 today
    expect(isMinor("2008-10-12", asOf, policy)).toBe(true); // turns 18 tomorrow
  });
  it("rejects a missing, malformed or future date", () => {
    expect(checkDateOfBirth(null, 2, asOf, policy)).toMatchObject({ ok: false });
    expect(checkDateOfBirth("11/10/2005", 2, asOf, policy)).toMatchObject({ ok: false });
    expect(checkDateOfBirth("2030-01-01", 2, asOf, policy)).toMatchObject({ ok: false });
  });
  it("rejects an age that does not fit the year of study", () => {
    expect(checkDateOfBirth("2013-01-01", 1, asOf, policy)).toMatchObject({ ok: false });
    expect(checkDateOfBirth("1970-01-01", 2, asOf, policy)).toMatchObject({ ok: false });
    // A first-year of 16 is allowed, a second-year of 16 is not.
    expect(checkDateOfBirth("2010-06-01", 1, asOf, policy).ok).toBe(true);
    expect(checkDateOfBirth("2010-06-01", 2, asOf, policy).ok).toBe(false);
  });
  it("does not treat a missing or invalid date as a minor", () => {
    expect(isMinor(null, asOf, policy)).toBe(false);
    expect(isMinor("garbage", asOf, policy)).toBe(false);
  });
});
