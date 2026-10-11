/**
 * Institution policy file schema (§3.1). Every threshold, weight and band the
 * rules engine uses comes from a validated Policy object — never from code.
 */
import { z } from "zod";

export const AEG_LEVELS = ["LOW", "MODERATE", "CRITICAL"] as const;
export const aegLevel = z.enum(AEG_LEVELS);
export type AegLevel = z.infer<typeof aegLevel>;

export const TRACK_IDS = [
  "corporate_placement",
  "higher_studies",
  "entrepreneurship",
  "public_service",
  "freelance_creator",
  "sports_defense_ncc",
] as const;
export const trackId = z.enum(TRACK_IDS);
export type TrackId = z.infer<typeof trackId>;

export const PERSONA_IDS = [
  "detention_threat_builder",
  "aspiration_mismatch",
  "false_positive_high_flyer",
  "drifting_student",
] as const;
export const personaId = z.enum(PERSONA_IDS);
export type PersonaId = z.infer<typeof personaId>;

export const VERIFICATION_STATUSES = [
  "SUBMITTED",
  "UNDER_CHECK",
  "VERIFIED",
  "ATTESTED",
  "LIVE_UNVERIFIED",
  "SELF_REPORTED",
  "UNVERIFIED",
  "REJECTED",
  "STALE",
] as const;
export const verificationStatus = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof verificationStatus>;

const slopeRule = z.object({
  worsening_slope_max: z.number(),
  improving_slope_min: z.number(),
});

const num = z.number();
const requiredWeights = z.record(z.string(), z.number().positive());

/** Parameters each track's rubric reads. Typed, so a missing or misspelled number fails when the policy loads. */
export const TRACK_PARAMS = {
  corporate_placement: z.object({
    internship_hours_full: z.number().positive(),
    mock_interview_window: z.number().int().positive(),
  }),
  higher_studies: z.object({
    sop_reviews_full: z.number().positive(),
    entrance_test_type: z.string(),
    entrance_window: z.number().int().positive(),
    /** Share (0–1) of the entrance component taken by the speed score; 0 shows speed as a sub-measure only. */
    entrance_speed_share: z.number().min(0).max(1),
    required_weights: requiredWeights,
  }),
  entrepreneurship: z.object({
    customer_interviews_full: z.number().positive(),
    customer_rating_window: z.number().int().positive(),
    required_weights: requiredWeights,
  }),
  public_service: z.object({
    gs_mock_window: z.number().int().positive(),
    gs_test_type: z.string(),
    quant_test_type: z.string(),
    weekly_test_type: z.string(),
    current_affairs_window_days: z.number().int().positive(),
    answer_writing_window: z.number().int().positive(),
  }),
  freelance_creator: z.object({ required_weights: requiredWeights }),
  sports_defense_ncc: z.object({
    competition_points: z.object({ university: num, state: num, national: num }),
    competition_required_points: z.number().positive(),
    cooper_bands: z.array(z.object({ min_metres: num.nonnegative(), score: num.min(0).max(100) })).min(1),
    bmi_band_scores: z.object({ in_range: num, borderline: num, out_of_range: num }),
    psychometric_window: z.number().int().positive(),
    min_credits: z.number().nonnegative(),
  }),
} as const;

const track = z
  .object({
    name: z.string(),
    assumed: z.boolean().optional(),
    rubric_version: z.string(),
    components: z.record(z.string(), z.number().nonnegative()),
    params: z.record(z.string(), z.unknown()),
    gate: z.string().nullable(),
  })
  .refine((t) => Math.abs(Object.values(t.components).reduce((a, b) => a + b, 0) - 100) < 1e-9, {
    message: "Track component weights must sum to 100 (§5.3)",
  });

const isoDate = z.iso.date();

/** Weekends, holidays and the academic term (§3.2, §8.1 working-day SLAs, §4.3 current-term attendance). */
const calendar = z.object({
  weekend_days: z.array(z.number().int().min(0).max(6)),
  holidays: z.array(isoDate),
  /** Minutes east of UTC for the institution's local day (IST = 330). */
  utc_offset_minutes: z.number().int().min(-720).max(840),
  term: z.object({ start: isoDate, end: isoDate }),
});

/** Data-quality rules (§4.3). */
const dataQuality = z.object({
  roll_number_pattern: z.string().refine((p) => {
    try {
      new RegExp(p);
      return true;
    } catch {
      return false;
    }
  }, "roll_number_pattern must be a valid regular expression"),
  attendance_window_weeks: z.number().int().positive(),
  attendance_missing_weeks_medium_over: z.number().int().nonnegative(),
  attendance_missing_weeks_low_over: z.number().int().nonnegative(),
  artifact_url_schemes: z.array(z.string()).min(1),
  artifact_reachable_within_days: z.number().int().positive(),
  minor_age_years: z.number().int().positive(),
  year1_age_range_years: z.tuple([z.number().int(), z.number().int()]),
});

/** ERP import (§6.2): header aliases per field, so only mapped columns are ever read (§13.4 minimization). */
const ingestion = z.object({
  erp_columns: z.record(z.string(), z.array(z.string()).min(1)),
  stale_after_hours: z.number().positive(),
});

export const ESCALATION_CONDITIONS = ["no_decision", "no_quest_started", "no_meeting", "unresolved"] as const;

const route = z.object({
  label: z.string(),
  recipient_role: z.string(),
  approver_role: z.string(),
  copy_roles: z.array(z.string()),
  sla_working_days: z.number().int().positive(),
  escalate_to: z.string(),
  escalate_after_working_days: z.number().int().positive().nullable(),
  closure: z.string(),
  /**
   * Consent categories this route shares with the recipient and copy roles beyond the approver (§8.1):
   * a role that needs consent (placement, E-Cell, sports) is sent nothing unless the student granted every one.
   */
  shares: z.array(z.string()),
  /** What must still be true after `escalate_after_working_days` for the route to escalate (§8.1). */
  escalation_condition: z.enum(ESCALATION_CONDITIONS),
});

export const policySchema = z
  .object({
    policy_version: z.string(),
    status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
    status_note: z.string().optional(),
    /** Paths of values the reference plan does not specify; shown to the registrar until the institution confirms them. */
    provisional: z.array(z.string()).default([]),
    effective_from: z.string(),
    academic: z.object({
      cgpa_scale_max: z.number().positive(),
      eligibility_cgpa_above: z.number(),
      scoring_range: z.tuple([z.number(), z.number()]),
    }),
    attendance: z.object({
      requirement_pct: z.number(),
      condonation_floor_pct: z.number(),
      watch_band_pct: z.tuple([z.number(), z.number()]),
    }),
    calendar,
    data_quality: dataQuality,
    ingestion,
    readiness_default: z.number().min(0).max(100),
    aeg_bands: z.object({
      moderate_from: z.number(),
      critical_from: z.number(),
    }),
    personas: z.object({
      false_positive_high_flyer: z.object({
        cgpa_min: z.number(),
        aptitude_below_pct: z.number(),
        verified_projects_min: z.number(),
        floor: aegLevel,
      }),
      detention_threat_builder: z.object({
        attendance_below_pct: z.number(),
        artifact_score_percentile_min: z.number(),
        floor: aegLevel,
      }),
      aspiration_mismatch: z.object({
        abroad: z.object({
          backlogs_min: z.number(),
          deadline_within_months: z.number(),
        }),
        public_service: z.object({
          mocks_last_60d_max: z.number(),
          exam_within_months: z.number(),
        }),
        floor: aegLevel,
      }),
      drifting_student: z.object({
        min_year: z.number(),
        cgpa_avg_max: z.number(),
        activity_last_60d_max: z.number(),
        floor: aegLevel,
      }),
    }),
    persona_precedence: z.array(personaId),
    trend: z.object({
      window_weeks: z.number().int().positive(),
      min_observations: z.number().int().positive(),
      attendance: slopeRule,
      mock_percentile: slopeRule,
      streak_gap_note_days: z.number(),
      streak_window_days: z.number(),
    }),
    pivot: z.object({
      score_advantage_min: z.number(),
      min_gap_index: aegLevel,
    }),
    /**
     * Cohort statistics for the "verified artifact score" (§7.3): an artifact score of 100 needs this
     * much counted evidence weight, and the Detention Threat Builder compares against the cohort percentile.
     */
    cohort: z.object({
      artifact_score_full_weight: z.number().positive(),
      percentile: z.number().min(1).max(99),
    }),
    streak: z.object({
      target_days: z.number(),
      min_items_per_credit: z.number(),
      daily_credit_cap: z.number(),
    }),
    verification: z.object({
      github: z.object({
        /** A fork counts only with at least this many commits by the student (§6.2). */
        fork_min_own_commits: z.number().int().nonnegative(),
        recheck_days: z.number().int().positive(),
      }),
      portfolio_recheck_days: z.number().int().positive(),
      /** An attestation lapses to STALE after this review period (§6.1). */
      attested_review_days: z.number().int().positive(),
      /** Share of external score reports checked against the test body each term (§6.2). */
      external_mock_sample_rate: z.number().min(0).max(1),
      upload: z.object({
        max_bytes: z.number().int().positive(),
        allowed_types: z.array(z.string()).min(1),
        /** Signed links expire within minutes (§13.3). */
        signed_url_max_seconds: z.number().int().positive().max(900),
      }),
    }),
    /** How each kind of evidence a quest can name is submitted and who confirms it (§8.3, §6.2). */
    evidence_types: z.record(
      z.string(),
      z.object({
        label: z.string(),
        /** link: a URL checked by the system; upload: a file a reviewer attests; platform: recorded by the campus platform; reviewer: entered by staff. */
        mode: z.enum(["link", "upload", "platform", "reviewer"]),
        verifier: z.enum(["github", "crossref", "link", "certificate"]).optional(),
        reviewer_role: z.string().optional(),
        /** Weight of the artifact in the evidence score. */
        weight: z.number().positive(),
      }),
    ),
    integrity: z.object({
      min_seconds_per_mcq: z.number(),
      min_seconds_per_numerical: z.number(),
      burst_commits_per_minute: z.number(),
      burst_share_24h: z.number(),
    }),
    verification_multipliers: z.record(verificationStatus, z.number().min(0).max(1)),
    confidence: z.object({
      medium_max_gaps: z.number().int(),
      source_failure_window_days: z.number(),
    }),
    llm: z.object({
      free_text_max_chars: z.number().int().positive(),
      target_days_range: z.tuple([z.number().int(), z.number().int()]),
      max_action_steps: z.number().int().positive(),
    }),
    leaderboard: z.object({
      default_opt_in: z.boolean(),
      /** Days of streak that earn a badge on the board (§12.3). */
      streak_badge_days: z.number().int().positive(),
      min_entries: z.number().int().nonnegative(),
    }),
    /** Fairness testing protocol (§14.1): groups below the minimum size are never reported. */
    fairness: z.object({
      min_group_size: z.number().int().positive(),
      ratio_band: z.tuple([z.number().positive(), z.number().positive()]),
      dimensions: z
        .array(z.enum(["medium_of_instruction", "first_generation", "home_region", "gender", "device_access"]))
        .min(1),
    }),
    /** Version of the plain-language notice a student acknowledges at onboarding (§13.4). */
    notice: z.object({ version: z.string() }),
    privacy: z.object({
      /** Days to answer a rights request; the compliance officer sets it from the Act and its rules (§13.7). */
      rights_response_days: z.number().int().positive(),
    }),
    /** Contacts shown to students: counselling, emergency (§14.2) and the grievance officer (§13.4). */
    institution: z.object({
      name: z.string(),
      counseling: z.object({ name: z.string(), phone: z.string(), email: z.string(), hours: z.string() }),
      emergency: z.object({ name: z.string(), phone: z.string(), note: z.string() }),
      grievance_officer: z.object({ name: z.string(), email: z.string(), phone: z.string() }),
    }),
    /** Retention schedule (§13.5). Every period needs legal and registrar review. */
    retention: z.object({
      erp_copies: z.object({ academic_years_after: z.number().int().nonnegative(), erasable_on_request: z.boolean() }),
      artifact_files: z.object({
        days_after_verification: z.number().int().positive(),
        erasable_on_request: z.boolean(),
      }),
      evaluations: z.object({
        months_after_graduation: z.number().int().nonnegative(),
        erasable_on_request: z.boolean(),
      }),
      interventions: z.object({
        years_after_closure: z.number().int().positive(),
        erasable_on_request: z.boolean(),
        legal_reason: z.string().optional(),
      }),
      mock_raw_answers: z.object({ months: z.number().int().positive(), erasable_on_request: z.boolean() }),
      consent_history: z.object({
        life_of_record: z.boolean(),
        erasable_on_request: z.boolean(),
        legal_reason: z.string().optional(),
      }),
      audit_events: z.object({
        years: z.number().int().positive(),
        erasable_on_request: z.boolean(),
        legal_reason: z.string().optional(),
      }),
    }),
    tracks: z.record(trackId, track),
    department_standards: z.record(
      z.string(),
      z.object({
        name: z.string(),
        items: z.record(z.string(), z.object({ label: z.string(), weight: z.number().positive() })),
      }),
    ),
    routes: z.record(z.string(), route),
    quests: z.object({
      /** A deferred proposal reappears after this many days (§12.1 "accept, edit or defer"). */
      defer_days: z.number().int().positive(),
      max_open_per_student: z.number().int().positive(),
    }),
    counseling: z.object({
      columns: z.array(z.string()),
      wip_limit_per_mentor: z.number().int().positive(),
      inactivity_amber_days: z.number().int().positive(),
    }),
    wellbeing: z.record(z.string(), z.number()),
  })
  .superRefine((p, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    for (const id of PERSONA_IDS)
      if (!p.persona_precedence.includes(id)) add(["persona_precedence"], `persona_precedence is missing ${id}`);
    for (const field of ERP_REQUIRED_FIELDS)
      if (!p.ingestion.erp_columns[field]) add(["ingestion", "erp_columns", field], `ERP mapping needs ${field}`);
    if (p.aeg_bands.moderate_from >= p.aeg_bands.critical_from)
      add(["aeg_bands"], "moderate_from must be below critical_from");
    if (p.attendance.condonation_floor_pct >= p.attendance.requirement_pct)
      add(["attendance"], "condonation floor must be below the attendance requirement");
    if (p.calendar.term.start >= p.calendar.term.end) add(["calendar", "term"], "term start must precede term end");
    if (p.data_quality.attendance_missing_weeks_low_over < p.data_quality.attendance_missing_weeks_medium_over)
      add(["data_quality"], "the LOW missing-weeks limit cannot be below the MEDIUM limit");
  });

/** Header fields the ERP import cannot run without (§4.3). */
export const ERP_REQUIRED_FIELDS = ["roll_number", "cgpa"] as const;

export type Policy = z.infer<typeof policySchema>;

/** The typed parameters of one track (validated when the policy loads). */
export function trackParams<T extends TrackId>(policy: Policy, track: T): z.infer<(typeof TRACK_PARAMS)[T]> {
  return TRACK_PARAMS[track].parse(policy.tracks[track]?.params) as z.infer<(typeof TRACK_PARAMS)[T]>;
}
export type RouteRule = z.infer<typeof route>;

export function parsePolicy(raw: unknown): Policy {
  return policySchema.parse(raw);
}
