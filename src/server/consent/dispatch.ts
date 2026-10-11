/**
 * Consent at dispatch (§8.1, §13.1): an approved intervention reaches a placement, E-Cell or sports
 * officer only if the student has shared every category the route carries with that office. Staff
 * assigned to the student (mentor, class advisor) need no consent. Pure; the service supplies the consents.
 */
import type { RouteRule } from "../policy/schema";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "./matrix";

export interface ConsentGap {
  role: string;
  category: string;
  label: string;
}

type Consents = Record<string, Record<string, boolean>>;

export function consentGaps(
  route: Pick<RouteRule, "recipient_role" | "copy_roles" | "shares">,
  consents: Consents,
): ConsentGap[] {
  const roles = [...new Set([route.recipient_role, ...route.copy_roles])].filter((r) =>
    (CONSENT_RECIPIENTS as readonly string[]).includes(r),
  );
  return roles.flatMap((role) =>
    route.shares
      .filter((category) => !consents[category]?.[role])
      .map((category) => ({ role, category, label: CONSENTABLE[category as keyof typeof CONSENTABLE] ?? category })),
  );
}

const ROLE_NAME: Record<string, string> = {
  placement_officer: "the placement cell",
  ecell_coordinator: "the E-Cell",
  sports_officer: "the sports and NCC office",
};

/** What the approver is told when dispatch is blocked. */
export function explainGaps(gaps: ConsentGap[]): string {
  if (gaps.length === 0) return "";
  const parts = gaps.map((g) => `“${g.label}” with ${ROLE_NAME[g.role] ?? g.role}`);
  return `The student has not shared ${parts.join("; ")}. Your approval is recorded, but nothing was sent. It goes out automatically if the student shares it; until then it stays with you.`;
}
