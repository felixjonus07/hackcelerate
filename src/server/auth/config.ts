/** Session policy config resolved from the validated environment. */
import { env } from "../env";
import type { SessionPolicyConfig } from "./session-policy";

export const sessionPolicyConfig: SessionPolicyConfig = {
  staffIdleMinutes: env.SESSION_STAFF_IDLE_MINUTES,
  staffMaxHours: env.SESSION_STAFF_MAX_HOURS,
  studentIdleMinutes: env.SESSION_STUDENT_IDLE_MINUTES,
  studentMaxHours: env.SESSION_STUDENT_MAX_HOURS,
  studentTrustedDays: env.SESSION_STUDENT_TRUSTED_DAYS,
  warningSeconds: env.SESSION_WARNING_SECONDS,
};

/** Longest possible session; used as the cookie/storage ceiling. */
export const MAX_SESSION_SECONDS = Math.max(
  env.SESSION_STAFF_MAX_HOURS * 3_600,
  env.SESSION_STUDENT_MAX_HOURS * 3_600,
  env.SESSION_STUDENT_TRUSTED_DAYS * 86_400,
);
