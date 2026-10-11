/**
 * Session timeout policy (§13.2). Pure: the numbers come from env and are
 * passed in, so this module is unit-testable and safe for the client bundle.
 *
 * - Staff: idle timeout + absolute lifetime; never "trusted" (shared office PCs).
 * - Students: same short policy by default; "Keep me signed in on this device"
 *   gives a trusted session that lasts SESSION_STUDENT_TRUSTED_DAYS.
 */
export interface SessionPolicyConfig {
  staffIdleMinutes: number;
  staffMaxHours: number;
  studentIdleMinutes: number;
  studentMaxHours: number;
  studentTrustedDays: number;
  warningSeconds: number;
}

export interface SessionPolicy {
  /** Sign out after this many seconds without a request. */
  idleSeconds: number;
  /** Absolute session lifetime in seconds, regardless of activity. */
  absoluteSeconds: number;
  /** Show the "you'll be signed out" warning this many seconds before idle timeout. */
  warningSeconds: number;
  trusted: boolean;
}

export function sessionPolicyFor(role: string, wantsTrusted: boolean, c: SessionPolicyConfig): SessionPolicy {
  if (role === "student" && wantsTrusted) {
    const s = c.studentTrustedDays * 86_400;
    return { idleSeconds: s, absoluteSeconds: s, warningSeconds: c.warningSeconds, trusted: true };
  }
  if (role === "student") {
    return {
      idleSeconds: c.studentIdleMinutes * 60,
      absoluteSeconds: c.studentMaxHours * 3_600,
      warningSeconds: c.warningSeconds,
      trusted: false,
    };
  }
  return {
    idleSeconds: c.staffIdleMinutes * 60,
    absoluteSeconds: c.staffMaxHours * 3_600,
    warningSeconds: c.warningSeconds,
    trusted: false,
  };
}
