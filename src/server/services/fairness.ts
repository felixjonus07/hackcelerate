/**
 * Fairness report (§14.1). Demographic fields are collected only with the student's consent, held in a separate
 * table, and used only here: the rules engine never reads them (a test enforces it). For each persona the report
 * gives the flag rate by group; for each rubric component, the score distribution by group.
 */
import { eq, sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { demographicProfiles } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { getActivePolicy } from "../policy/load";
import { PERSONA_IDS } from "../policy/schema";
import { distributions, flagRates } from "../rules/fairness";

type Dim = "medium_of_instruction" | "first_generation" | "home_region" | "gender" | "device_access";
const COLUMN: Record<Dim, keyof typeof demographicProfiles.$inferSelect> = {
  medium_of_instruction: "mediumOfInstruction",
  first_generation: "firstGeneration",
  home_region: "homeRegion",
  gender: "gender",
  device_access: "deviceAccess",
};

export interface DemographicInput {
  mediumOfInstruction?: string | null;
  firstGeneration?: boolean | null;
  homeRegion?: string | null;
  gender?: string | null;
  deviceAccess?: string | null;
}

/** The student chooses to take part; they can withdraw, which deletes the row. */
export async function setDemographics(studentId: string, input: DemographicInput | null) {
  if (input === null) {
    await db.delete(demographicProfiles).where(eq(demographicProfiles.studentId, studentId));
    return;
  }
  await db
    .insert(demographicProfiles)
    .values({ studentId, ...input })
    .onConflictDoUpdate({ target: demographicProfiles.studentId, set: { ...input, consentedAt: new Date() } });
}

export async function demographicsOf(studentId: string) {
  const [row] = await db
    .select()
    .from(demographicProfiles)
    .where(eq(demographicProfiles.studentId, studentId))
    .limit(1);
  return row ?? null;
}

export async function fairnessReport(user?: { id: string; role: Role }) {
  const policy = await getActivePolicy();
  const profiles = await db.select().from(demographicProfiles);
  const latest = await db.execute<{
    student_id: string;
    primary_persona: string | null;
    aeg_index: string;
    result: { trackScore: { components: { key: string; score: number }[] } };
  }>(sql`
    select distinct on (student_id) student_id, primary_persona, aeg_index, result from evaluations order by student_id, created_at desc`);
  const byStudent = new Map(latest.map((e) => [e.student_id, e]));
  const opts = { minGroup: policy.fairness.min_group_size, band: policy.fairness.ratio_band };

  const dimensions = policy.fairness.dimensions.map((dim: Dim) => {
    const rows = profiles
      .map((p) => ({ group: String(p[COLUMN[dim]] ?? "").trim(), ev: byStudent.get(p.studentId) }))
      .filter((r) => r.group !== "" && r.ev);
    const sizes = new Map<string, number>();
    for (const r of rows) sizes.set(r.group, (sizes.get(r.group) ?? 0) + 1);
    const flagFor = (test: (e: NonNullable<(typeof rows)[number]["ev"]>) => boolean) =>
      flagRates(
        [...sizes].map(([group, n]) => ({
          group,
          n,
          flagged: rows.filter((r) => r.group === group && r.ev && test(r.ev)).length,
        })),
        opts,
      );
    const components = new Map<string, { group: string; score: number }[]>();
    for (const r of rows)
      for (const c of r.ev?.result.trackScore.components ?? [])
        components.set(c.key, [...(components.get(c.key) ?? []), { group: r.group, score: c.score }]);
    return {
      dimension: dim,
      students: rows.length,
      personas: PERSONA_IDS.map((persona) => ({ persona, ...flagFor((e) => e.primary_persona === persona) })),
      critical: flagFor((e) => e.aeg_index === "CRITICAL"),
      components: [...components].map(([component, vals]) => ({ component, ...distributions(vals, opts.minGroup) })),
    };
  });
  if (user)
    await audit({
      actorUserId: user.id,
      actorRole: user.role,
      action: "fairness_report.view",
      entityType: "report",
      entityId: policy.policy_version,
      purpose: "audit_request",
      result: "allowed",
    });
  return {
    policyVersion: policy.policy_version,
    minGroup: opts.minGroup,
    band: opts.band,
    participants: profiles.length,
    dimensions,
    note: "A ratio outside the band asks the governance committee to review the component and its threshold. It never changes a rubric by itself.",
  };
}
