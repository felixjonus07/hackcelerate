/**
 * Role-based access matrix (§13.1), encoded as data so authorization tests can
 * check it automatically (§15.1). "consented" means allowed only when the
 * student's latest consent record grants that recipient + category.
 */
import type { Role } from "../db/schema/enums";

export const DATA_CATEGORIES = [
  "identity_contact",
  "academic_baseline",
  "mock_scores",
  "artifacts_evidence",
  "persona_aeg",
  "evaluation_narrative",
  "intervention_history",
  "wellbeing_nudges",
  "policy_configuration",
  "audit_log",
] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

export type Access =
  | "own"
  | "own_with_reason"
  | "own_access_log"
  | "assigned"
  | "name"
  | "name_roll"
  | "aggregate"
  | "consented"
  | "full"
  | "view"
  | "edit_two_person"
  | "sample_with_reason"
  | "soft_note"
  | "no";

type Row = Partial<Record<Role, Access>>;

/** Table 13.1. Roles not listed for a category have no access. */
export const ACCESS_MATRIX: Record<DataCategory, Row> = {
  identity_contact: {
    student: "own",
    faculty_mentor: "name_roll",
    class_advisor: "name_roll",
    hod: "name",
    dean: "name",
    placement_officer: "consented",
    ecell_coordinator: "consented",
    sports_officer: "consented",
    registrar: "full",
    auditor: "no",
  },
  academic_baseline: {
    student: "own",
    faculty_mentor: "assigned",
    class_advisor: "assigned",
    hod: "aggregate",
    dean: "aggregate",
    placement_officer: "consented",
    ecell_coordinator: "no",
    sports_officer: "consented",
    registrar: "full",
    auditor: "aggregate",
  },
  mock_scores: {
    student: "own",
    faculty_mentor: "assigned",
    hod: "aggregate",
    dean: "aggregate",
    placement_officer: "consented",
    ecell_coordinator: "no",
    registrar: "no",
    auditor: "aggregate",
  },
  artifacts_evidence: {
    student: "own",
    faculty_mentor: "assigned",
    hod: "aggregate",
    dean: "aggregate",
    placement_officer: "consented",
    ecell_coordinator: "consented",
    sports_officer: "consented",
    registrar: "no",
    auditor: "sample_with_reason",
  },
  persona_aeg: {
    student: "own",
    faculty_mentor: "assigned",
    class_advisor: "assigned",
    hod: "aggregate",
    dean: "aggregate",
    placement_officer: "consented",
    ecell_coordinator: "no",
    registrar: "no",
    auditor: "aggregate",
  },
  evaluation_narrative: {
    student: "own",
    faculty_mentor: "assigned",
    hod: "no",
    dean: "no",
    placement_officer: "no",
    ecell_coordinator: "no",
    registrar: "no",
    auditor: "no",
  },
  intervention_history: {
    student: "own",
    faculty_mentor: "assigned",
    class_advisor: "assigned",
    hod: "aggregate",
    dean: "aggregate",
    placement_officer: "no",
    ecell_coordinator: "no",
    registrar: "no",
    auditor: "aggregate",
  },
  wellbeing_nudges: {
    student: "own_with_reason",
    faculty_mentor: "soft_note",
    hod: "no",
    dean: "no",
    placement_officer: "no",
    ecell_coordinator: "no",
    registrar: "no",
    auditor: "no",
  },
  policy_configuration: {
    student: "no",
    faculty_mentor: "no",
    hod: "view",
    dean: "view",
    placement_officer: "no",
    ecell_coordinator: "no",
    registrar: "edit_two_person",
    auditor: "view",
  },
  audit_log: {
    student: "own_access_log",
    faculty_mentor: "no",
    hod: "no",
    dean: "no",
    placement_officer: "no",
    ecell_coordinator: "no",
    registrar: "view",
    auditor: "view",
  },
};

/** Consent categories the student controls in the consent center (§12.1 card 2). */
export const CONSENTABLE: Partial<Record<DataCategory, string>> = {
  identity_contact: "Name and contact details",
  academic_baseline: "CGPA and attendance",
  mock_scores: "Mock and test scores",
  artifacts_evidence: "Projects, certificates and evidence",
  persona_aeg: "Gap index and support flags",
};
export const CONSENT_RECIPIENTS = ["placement_officer", "ecell_coordinator", "sports_officer"] as const;

export interface AccessRequest {
  role: Role;
  category: DataCategory;
  /** The record belongs to the caller. */
  isSelf?: boolean;
  /** The caller is assigned to this student (mentor / class advisor). */
  isAssigned?: boolean;
  /** Latest consent record grants this recipient + category. */
  consented?: boolean;
  /** Asking for one individual's record (vs. an aggregate). */
  individual?: boolean;
  /** A logged reason code accompanies the request (§13.2). */
  reasonCode?: string;
}

export interface AccessDecision {
  allowed: boolean;
  access: Access;
  scope: "individual" | "aggregate" | "none";
  reason: string;
}

export function decideAccess(req: AccessRequest): AccessDecision {
  const access = ACCESS_MATRIX[req.category][req.role] ?? "no";
  const individual = req.individual ?? true;
  const deny = (reason: string): AccessDecision => ({
    allowed: false,
    access,
    scope: "none",
    reason,
  });
  const allow = (scope: AccessDecision["scope"], reason: string): AccessDecision => ({
    allowed: true,
    access,
    scope,
    reason,
  });

  switch (access) {
    case "no":
      return deny(`${req.role} has no access to ${req.category}`);
    case "own":
    case "own_with_reason":
    case "own_access_log":
      return req.isSelf ? allow("individual", "own record") : deny("students see only their own record");
    case "assigned":
    case "name_roll":
    case "soft_note":
      if (!individual) return allow("aggregate", "aggregate of assigned students");
      if (req.isAssigned) return allow("individual", "assigned student");
      // §21 default: non-assigned access allowed with a logged reason.
      return req.reasonCode
        ? allow("individual", `non-assigned, reason ${req.reasonCode}`)
        : deny("not an assigned student; a reason code is required");
    case "name":
      return allow(individual ? "individual" : "aggregate", "name only");
    case "aggregate":
      return individual ? deny("aggregates only for this role") : allow("aggregate", "aggregate view");
    case "consented":
      if (!individual) return deny("consented access is per student");
      return req.consented
        ? allow("individual", "student consent on record")
        : deny("the student has not consented to share this");
    case "sample_with_reason":
      return req.reasonCode
        ? allow("individual", `sampled record, reason ${req.reasonCode}`)
        : deny("sampled records need a logged reason");
    case "full":
    case "view":
    case "edit_two_person":
      return allow(individual ? "individual" : "aggregate", access);
  }
}
