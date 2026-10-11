/**
 * Data-quality rules (§4.3) as pure functions.
 * Validates ERP imports, mock attempts, artifact URLs and student demographics.
 */

export type QualityResult = { ok: true } | { ok: false; reason: string };

/**
 * CGPA: Between 0 and scale maximum.
 * If it fails: Excluded from scoring; data gap recorded (§4.3).
 */
export function checkCgpa(cgpa: number | null | undefined, scaleMax: number): QualityResult {
  if (cgpa == null || Number.isNaN(cgpa)) {
    return { ok: false, reason: "CGPA missing" };
  }
  if (cgpa < 0 || cgpa > scaleMax) {
    return { ok: false, reason: `CGPA ${cgpa} outside 0–${scaleMax}` };
  }
  return { ok: true };
}

/**
 * Attendance week: Classes attended no greater than classes held; held greater than 0.
 * If it fails: Week excluded (§4.3).
 */
export function checkAttendanceWeek(held: number, attended: number): QualityResult {
  if (held <= 0) {
    return { ok: false, reason: "Classes held must be greater than 0" };
  }
  if (attended < 0) {
    return { ok: false, reason: "Classes attended cannot be negative" };
  }
  if (attended > held) {
    return { ok: false, reason: "Attended exceeds held" };
  }
  return { ok: true };
}

/**
 * Attendance history evaluation (§4.3):
 * If more than two weeks are missing / invalid, confidence drops to MEDIUM or LOW.
 */
export interface AttendanceSeriesResult {
  validWeeks: { weekStart: string; held: number; attended: number }[];
  invalidWeeks: { weekStart: string; held: number; attended: number; reason: string }[];
  missingCount: number;
  confidenceCeiling: "HIGH" | "MEDIUM" | "LOW";
}

export function checkAttendanceSeries(
  weeks: { weekStart: string; held: number; attended: number }[],
  expectedTotalWeeks = 16,
): AttendanceSeriesResult {
  const validWeeks: AttendanceSeriesResult["validWeeks"] = [];
  const invalidWeeks: AttendanceSeriesResult["invalidWeeks"] = [];

  for (const w of weeks) {
    const res = checkAttendanceWeek(w.held, w.attended);
    if (res.ok) {
      validWeeks.push(w);
    } else {
      invalidWeeks.push({ ...w, reason: res.reason });
    }
  }

  const missingCount = Math.max(0, expectedTotalWeeks - validWeeks.length);
  let confidenceCeiling: "HIGH" | "MEDIUM" | "LOW" = "HIGH";
  if (missingCount > 4) {
    confidenceCeiling = "LOW";
  } else if (missingCount > 2) {
    confidenceCeiling = "MEDIUM";
  }

  return { validWeeks, invalidWeeks, missingCount, confidenceCeiling };
}

/**
 * Mock attempt: Score within test range; seconds per item present and positive.
 * If it fails: Stored but flagged; excluded from percentile (§4.3).
 */
export interface MockQualityResult {
  ok: boolean;
  reason?: string;
  excludeFromPercentile: boolean;
  flagForReview: boolean;
}

export function checkMockAttempt(
  score: number | null | undefined,
  scoreRange: [number, number],
  avgSecondsPerItem: number | null | undefined,
): MockQualityResult {
  const [minScore, maxScore] = scoreRange;
  if (score == null || Number.isNaN(score)) {
    return {
      ok: false,
      reason: "Mock score missing",
      excludeFromPercentile: true,
      flagForReview: true,
    };
  }
  if (score < minScore || score > maxScore) {
    return {
      ok: false,
      reason: `Mock score ${score} outside valid range [${minScore}, ${maxScore}]`,
      excludeFromPercentile: true,
      flagForReview: true,
    };
  }
  if (avgSecondsPerItem == null || Number.isNaN(avgSecondsPerItem) || avgSecondsPerItem <= 0) {
    return {
      ok: false,
      reason: "Seconds per item must be present and greater than 0",
      excludeFromPercentile: true,
      flagForReview: true,
    };
  }
  return {
    ok: true,
    excludeFromPercentile: false,
    flagForReview: false,
  };
}

/**
 * Artifact URL: Valid scheme; reachable within 14 days of submission.
 * If it fails: Status UNVERIFIED with the reason recorded (§4.3).
 */
export interface ArtifactUrlResult {
  ok: boolean;
  reason?: string;
  statusIfFailed: "UNVERIFIED";
}

export function checkArtifactUrl(
  url: string | null | undefined,
  options?: {
    submittedAt?: Date | string | null;
    asOf?: Date;
    maxDaysReachable?: number;
  },
): ArtifactUrlResult {
  if (!url || typeof url !== "string" || !url.trim()) {
    return {
      ok: false,
      reason: "URL is empty or missing",
      statusIfFailed: "UNVERIFIED",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return {
      ok: false,
      reason: "Malformed URL syntax",
      statusIfFailed: "UNVERIFIED",
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `Invalid protocol '${parsed.protocol}'; only http: and https: are allowed`,
      statusIfFailed: "UNVERIFIED",
    };
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return {
      ok: false,
      reason: "URL must contain a valid domain name",
      statusIfFailed: "UNVERIFIED",
    };
  }

  // 14 days reachability window check from submission time
  if (options?.submittedAt) {
    const subDate = new Date(options.submittedAt);
    const asOf = options.asOf ?? new Date();
    const maxDays = options.maxDaysReachable ?? 14;
    const diffDays = (asOf.getTime() - subDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > maxDays) {
      return {
        ok: false,
        reason: `Artifact submission exceeded ${maxDays} days without verification confirmation`,
        statusIfFailed: "UNVERIFIED",
      };
    }
  }

  return {
    ok: true,
    statusIfFailed: "UNVERIFIED",
  };
}

/**
 * Student ID: Matches the ERP roll number format.
 * If it fails: Row rejected at import and logged for the registrar (§4.3).
 */
export function checkRollNumber(
  roll: string | null | undefined,
  pattern = /^(?:[A-Z]{2,5}\d{4,8}|SYN\d{5})$/,
): QualityResult {
  if (!roll || typeof roll !== "string") {
    return { ok: false, reason: "Roll number is missing" };
  }
  return pattern.test(roll.trim())
    ? { ok: true }
    : {
        ok: false,
        reason: `Roll number ${roll} does not match the ERP format`,
      };
}

/**
 * Date of birth: Present and consistent with year of study.
 * Any student under 18 is routed to the parental consent check (§4.3, §13.4).
 */
export interface DobQualityResult {
  ok: boolean;
  reason?: string;
  ageYears?: number;
  isUnder18: boolean;
  parentalConsentRequired: boolean;
}

export function checkDateOfBirth(
  dob: string | Date | null | undefined,
  yearOfStudy: number,
  asOf = new Date(),
): DobQualityResult {
  if (!dob) {
    return {
      ok: false,
      reason: "Date of birth is missing",
      isUnder18: false,
      parentalConsentRequired: false,
    };
  }

  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) {
    return {
      ok: false,
      reason: "Date of birth is invalid",
      isUnder18: false,
      parentalConsentRequired: false,
    };
  }

  if (birthDate > asOf) {
    return {
      ok: false,
      reason: "Date of birth cannot be in the future",
      isUnder18: false,
      parentalConsentRequired: false,
    };
  }

  // Calculate age precisely
  let age = asOf.getFullYear() - birthDate.getFullYear();
  const m = asOf.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age < 15 || age > 70) {
    return {
      ok: false,
      reason: `Age ${age} is outside plausible university student range (15–70)`,
      ageYears: age,
      isUnder18: age < 18,
      parentalConsentRequired: age < 18,
    };
  }

  // Consistency with year of study (assuming undergraduate 1-4)
  const minExpectedAge = 15 + yearOfStudy; // e.g. Year 1 >= 16
  const maxExpectedAge = 25 + yearOfStudy; // e.g. Year 1 <= 26
  if (age < minExpectedAge || age > maxExpectedAge) {
    return {
      ok: false,
      reason: `Age ${age} is inconsistent with year ${yearOfStudy} of study (expected ${minExpectedAge}–${maxExpectedAge})`,
      ageYears: age,
      isUnder18: age < 18,
      parentalConsentRequired: age < 18,
    };
  }

  const isUnder18 = age < 18;
  return {
    ok: true,
    ageYears: age,
    isUnder18,
    parentalConsentRequired: isUnder18,
  };
}
