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

const route = z.object({
  label: z.string(),
  recipient_role: z.string(),
  approver_role: z.string(),
  copy_roles: z.array(z.string()),
  sla_working_days: z.number().int().positive(),
  escalate_to: z.string(),
  escalate_after_working_days: z.number().int().positive().nullable(),
  closure: z.string(),
});

export const policySchema = z.object({
  policy_version: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
  status_note: z.string().optional(),
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
  readiness_default: z.number().min(0).max(100),
  aeg_bands: z
    .object({
      moderate_from: z.number().min(0).max(1),
      critical_from: z.number().min(0).max(1),
    })
    .refine((b) => b.critical_from > b.moderate_from, {
      message: "critical_from must be greater than moderate_from (§7.2)",
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
  streak: z.object({
    target_days: z.number(),
    min_items_per_credit: z.number(),
    daily_credit_cap: z.number(),
  }),
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
  leaderboard: z.object({ default_opt_in: z.boolean() }),
  tracks: z.record(trackId, track),
  department_standards: z.record(
    z.string(),
    z.object({
      name: z.string(),
      items: z.record(z.string(), z.object({ label: z.string(), weight: z.number().positive() })),
    }),
  ),
  routes: z.record(z.string(), route),
  counseling: z.object({
    columns: z.array(z.string()),
    wip_limit_per_mentor: z.number().int().positive(),
    inactivity_amber_days: z.number().int().positive(),
  }),
  wellbeing: z.record(z.string(), z.number()),
});

export type Policy = z.infer<typeof policySchema>;
export type RouteRule = z.infer<typeof route>;

export function parsePolicy(raw: unknown): Policy {
  return policySchema.parse(raw);
}
