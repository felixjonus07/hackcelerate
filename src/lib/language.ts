/**
 * Language standards for student-facing text (§14.3). One list, used by the prompt's policy layer, the
 * contract-metrics tone measure and the linter test, so they cannot drift apart. Persona names are
 * used internally and never shown to students.
 */
export const LANGUAGE_AVOID = [
  "Drifting student",
  "At risk",
  "Detention threat",
  "Failing",
  "Weak in aptitude",
  "Lazy",
  "No effort",
  "Your chances are zero",
  "You must",
  "Top student",
  "Topper",
] as const;

export const LANGUAGE_PREFER = [
  "A student who has not yet chosen a direction",
  "Attendance needs attention this term",
  "Not yet evidenced; building toward the target",
  "Activity has been low over the last 60 days",
  "The current plan leaves a large gap to the target date",
  "One option is to",
  "Strong academic record",
] as const;

/** Internal persona names and labels that must never reach a student (§14.3, §21). */
export const PERSONA_TERMS = [
  "high flyer",
  "false-positive",
  "false positive",
  "detention threat",
  "aspiration mismatch",
  "drifting",
  "persona",
] as const;

/** Phrases a student-facing string must not contain (case-insensitive), as regular expressions. */
export const STUDENT_BANNED: RegExp[] = [
  /\bdrifting\b/i,
  /\bat[- ]risk\b/i,
  /\bdetention threat\b/i,
  /\bfailing\b/i,
  /\bfailure\b/i,
  /\blazy\b/i,
  /\bno effort\b/i,
  /\byou must\b/i,
  /\btopper\b/i,
  /\btop student\b/i,
  /\bchances are zero\b/i,
  /\bweak in\b/i,
  /\bhigh[- ]flyer\b/i,
  /\bfalse[- ]positive\b/i,
  /\baspiration mismatch\b/i,
];
