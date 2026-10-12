/**
 * Wording for every notification (§10.1, §14.3). Student-facing templates follow the language standards:
 * warm, specific, no persona names, no "at risk", no "you must". Staff templates are neutral and evidence-first.
 * `renderNotice` is pure so the same notice reads the same in the app, in a digest and in a test.
 */
type Vars = Record<string, string | number>;
export interface Notice {
  title: string;
  body: string;
}

const s = (v: Vars, k: string) => String(v[k] ?? "");

const PATTERN_WORD: Record<string, string> = {
  late_night: "late-night study sessions",
  volume_spike: "a jump in practice volume",
  activity_stop: "a quiet couple of weeks",
};

export const TEMPLATES: Record<string, (v: Vars) => Notice> = {
  // ── For students
  intervention_message: (v) => ({ title: "A message from your mentor team", body: s(v, "message") }),
  quest_expired_student: (v) => ({
    title: "One of your quests has passed its date",
    body: `“${s(v, "quest")}” reached its date. That's fine: pick it up again with a fresh date whenever you're ready.`,
  }),
  evidence_reviewed: () => ({
    title: "Your evidence was reviewed",
    body: "A mentor looked at some of your evidence. Nothing is wrong; we just check that each piece is clearly yours.",
  }),
  rights_resolved: (v) => ({
    title: "Your request has an answer",
    body: `Your ${s(v, "kind")} request has been handled. Open Sharing to read the outcome.`,
  }),
  parental_consent_verified: () => ({
    title: "Your guardian's consent is on record",
    body: "Thank you. Your passport will be ready after the next refresh.",
  }),
  weekly_passport: () => ({
    title: "Your weekly passport",
    body: "Your passport has been refreshed. Open it to see your next step.",
  }),
  // ── For staff
  intervention_for_you: (v) => ({
    title: `${s(v, "route")}: approved and sent`,
    body: "The proposal was approved and has been sent. It is on your counseling board.",
  }),
  intervention_copy: (v) => ({
    title: `${s(v, "route")}: summary shared with you`,
    body: `The student has agreed to share: ${s(v, "shared")}. Nothing beyond that is included.`,
  }),
  dispatch_blocked: (v) => ({
    title: `${s(v, "route")}: approved, not yet sent`,
    body: "The student has not shared what this route carries with the office it goes to. Open the proposal to see what is missing.",
  }),
  route_escalated: (v) => ({
    title: `${s(v, "route")}: waiting ${s(v, "workingDays")} working days`,
    body: `A proposal in ${s(v, "department")} has passed its response time. Please check that it is being handled.`,
  }),
  quest_expired: (v) => ({
    title: "A quest reached its date",
    body: `“${s(v, "quest")}” reached its date without evidence. The card is now in Follow-up due. This is not recorded against the student.`,
  }),
  wellbeing_soft_note: (v) => ({
    title: "A recovery nudge was sent",
    body: `The student received a gentle note about ${PATTERN_WORD[s(v, "pattern")] ?? "recent activity"}, with campus counselling contacts. This is a soft note, not a label.`,
  }),
  mock_report_mismatch: () => ({
    title: "A sampled score report did not match",
    body: "A sampled external score report did not match the test body, so it was set aside. Please talk with the student.",
  }),
  flag_escalated: (v) => ({
    title: "An evidence review is still open",
    body: `An integrity check (${s(v, "check").replace("_", " ")}) has waited past its response time.`,
  }),
  rights_request: (v) => ({
    title: `A ${s(v, "kind")} request needs you`,
    body: "A student has raised a request about their data. It has a response deadline; open Requests to handle it.",
  }),
  weekly_digest: (v) => ({
    title: "Your weekly digest",
    body: s(v, "summary"),
  }),
};

export function renderNotice(template: string, vars: Vars): Notice {
  return (TEMPLATES[template] ?? (() => ({ title: "Notification", body: "" })))(vars);
}

/** Templates pre-approved with the WhatsApp Business provider (§10.1); each carries no personal detail. */
export const WHATSAPP_TEMPLATES: Record<string, { name: string; language: string; variables: string[] }> = {
  weekly_passport: { name: "aspiredge_weekly_passport", language: "en", variables: [] },
  weekly_digest: { name: "aspiredge_weekly_digest", language: "en", variables: ["count"] },
};
