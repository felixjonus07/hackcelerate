/** Data-quality rules (§4.3) as pure functions. */
export type QualityResult = { ok: true } | { ok: false; reason: string };

export function checkCgpa(cgpa: number | null, scaleMax: number): QualityResult {
  if (cgpa == null || Number.isNaN(cgpa)) return { ok: false, reason: "CGPA missing" };
  return cgpa >= 0 && cgpa <= scaleMax ? { ok: true } : { ok: false, reason: `CGPA ${cgpa} outside 0–${scaleMax}` };
}

export function checkAttendanceWeek(held: number, attended: number): QualityResult {
  if (held <= 0) return { ok: false, reason: "Classes held must be greater than 0" };
  return attended <= held ? { ok: true } : { ok: false, reason: "Attended exceeds held" };
}

export function checkRollNumber(roll: string, pattern = /^[A-Z]{2,5}\d{4,8}$/): QualityResult {
  return pattern.test(roll)
    ? { ok: true }
    : {
        ok: false,
        reason: `Roll number ${roll} does not match the ERP format`,
      };
}
