/**
 * Student- and staff-facing labels. Student copy follows the language
 * standards (§14.3): persona names are never shown to students.
 */
export const TRACK_LABELS: Record<string, string> = {
  corporate_placement: "Corporate Placement",
  higher_studies: "Higher Studies and Research",
  entrepreneurship: "Entrepreneurship and Startups",
  public_service: "Public Service and Government Exams",
  freelance_creator: "Freelance and Creator Economy",
  sports_defense_ncc: "Sports, Defense and NCC",
};

export const TRACK_SHORT: Record<string, string> = {
  corporate_placement: "Placement",
  higher_studies: "Higher studies",
  entrepreneurship: "Entrepreneurship",
  public_service: "Public service",
  freelance_creator: "Freelance",
  sports_defense_ncc: "Sports & NCC",
};

export type GapLevel = "LOW" | "MODERATE" | "CRITICAL";

export const GAP_STUDENT: Record<GapLevel, string> = {
  LOW: "Small gap",
  MODERATE: "Moderate gap",
  CRITICAL: "Large gap",
};
export const GAP_STAFF: Record<GapLevel, string> = {
  LOW: "Low",
  MODERATE: "Moderate",
  CRITICAL: "Critical",
};

export const TREND_STUDENT: Record<string, string> = {
  IMPROVING: "Improving over the last four weeks",
  STABLE: "Steady over the last four weeks",
  WORSENING: "Slipping over the last four weeks",
  INSUFFICIENT_DATA: "Not enough weeks of data for a trend yet",
};
export const TREND_SHORT: Record<string, string> = {
  IMPROVING: "Improving",
  STABLE: "Steady",
  WORSENING: "Slipping",
  INSUFFICIENT_DATA: "Too early",
};

export const VERIFICATION_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  UNDER_CHECK: "Being checked",
  VERIFIED: "Verified",
  ATTESTED: "Attested",
  LIVE_UNVERIFIED: "Live, owner not confirmed",
  SELF_REPORTED: "Self-reported",
  UNVERIFIED: "Not verified",
  REJECTED: "Not accepted",
  STALE: "Needs a re-check",
};

/** Staff-only names for internal personas (never rendered on student routes). */
export const PERSONA_STAFF: Record<string, string> = {
  detention_threat_builder: "Attendance below floor, strong builder",
  aspiration_mismatch: "Timeline mismatch",
  false_positive_high_flyer: "Strong record, aptitude not yet evidenced",
  drifting_student: "Direction not yet chosen",
};

export const ROUTE_LABELS: Record<string, string> = {
  detention_threat_builder: "Attendance support",
  aspiration_mismatch: "Timeline review",
  false_positive_high_flyer: "Aptitude and project plan",
  drifting_student: "Mapping conversation",
  attendance_critical: "Attendance critical",
  integrity_flag: "Evidence review",
};

export const COLUMN_LABELS: Record<string, string> = {
  REFERRED: "Referred",
  SCHEDULED: "Scheduled",
  IN_CONVERSATION: "In conversation",
  PLAN_ACTIVE: "Plan active",
  FOLLOW_UP_DUE: "Follow-up due",
  CLOSED: "Closed",
};

export const CONFIDENCE_NOTE: Record<string, string> = {
  HIGH: "High confidence: every item is verified",
  MEDIUM: "Medium confidence: some items are missing or count at reduced weight",
  LOW: "Low confidence: several items are missing",
};

export const REASON_CODES = [
  { value: "scheduled_mentoring", label: "Scheduled mentoring" },
  { value: "approval_decision", label: "Approval decision" },
  { value: "audit_request", label: "Audit request" },
  { value: "other", label: "Other (add a note)" },
] as const;

/** Strip [ev:ID] markers for student-facing text. */
export const stripRefs = (s: string) =>
  s
    .replace(/\s*\[ev:[^\]]+\]/g, "")
    .replace(/\s+([.,;])/g, "$1")
    .trim();

/** Recovery nudges (§14.2): the pattern is named in plain words, never a label for the student. */
export const NUDGE_TITLE: Record<string, string> = {
  late_night: "A lot of late-night work lately",
  volume_spike: "A sudden jump in how much you've been doing",
  activity_stop: "A quiet stretch after a busy one",
};
