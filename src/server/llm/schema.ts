/** Output schema (Appendix B) as Zod. */
import { z } from "zod";

export const actionStep = z
  .object({
    step_number: z.number().int().min(1).max(3),
    title: z.string().max(80),
    action: z.string().max(400),
    target_days: z.number().int().min(7).max(90),
    evidence_refs: z.array(z.string()).min(1),
  })
  .strict();

export const narrativeSchema = z
  .object({
    evaluation_id: z.string(),
    risk_summary: z.string().max(800),
    department_context_analysis: z.string().max(1200),
    prescriptive_action_plan: z.array(actionStep).min(1).max(3),
    career_pivot_advisory: z.object({ reasoning: z.string().max(600) }).strict(),
  })
  .strict();

export type Narrative = z.infer<typeof narrativeSchema>;

export const NARRATIVE_JSON_SCHEMA = z.toJSONSchema(narrativeSchema);
