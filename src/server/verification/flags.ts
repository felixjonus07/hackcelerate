/**
 * Integrity flags (§6.3): a flag asks a mentor to look; it never changes a score or a status by itself.
 * Every check here only raises a flag (once per subject, thanks to the dedupe key).
 */
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "../db";
import { artifacts, integrityFlags, mockAttempts } from "../db/schema";
import { getActivePolicy } from "../policy/load";
import { implausibleSpeed } from "../rules/integrity";

export type FlagCheck = "implausible_speed" | "burst_commits" | "duplicate_claim" | "reused_text" | "doi_name_variant";

export async function raiseFlag(f: {
  studentId: string;
  check: FlagCheck;
  subjectId: string;
  detail: string;
}): Promise<boolean> {
  const rows = await db
    .insert(integrityFlags)
    .values({ ...f, dedupeKey: `${f.check}:${f.subjectId}:${f.studentId}` })
    .onConflictDoNothing()
    .returning({ id: integrityFlags.id });
  return rows.length > 0;
}

/**
 * The same repository, DOI or certificate id claimed by two students flags both claims; both keep
 * their current status until a mentor reviews them (§6.3).
 */
export async function flagDuplicateClaim(artifactId: string): Promise<number> {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!a?.claimKey) return 0;
  const others = await db
    .select({ id: artifacts.id, studentId: artifacts.studentId })
    .from(artifacts)
    .where(and(eq(artifacts.claimKey, a.claimKey), ne(artifacts.studentId, a.studentId)));
  let raised = 0;
  for (const o of others) {
    const detail =
      "The same repository, DOI or certificate was claimed by another student; both claims are queued for review";
    if (await raiseFlag({ studentId: a.studentId, check: "duplicate_claim", subjectId: a.id, detail })) raised++;
    if (await raiseFlag({ studentId: o.studentId, check: "duplicate_claim", subjectId: o.id, detail })) raised++;
  }
  return raised;
}

/** Identical project descriptions in two students' artifacts (§6.3); students are told it was reviewed, not accused. */
export async function flagReusedText(artifactId: string): Promise<number> {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!a?.textHash) return 0;
  const others = await db
    .select({ id: artifacts.id, studentId: artifacts.studentId })
    .from(artifacts)
    .where(
      and(eq(artifacts.textHash, a.textHash), ne(artifacts.studentId, a.studentId), isNotNull(artifacts.textHash)),
    );
  let raised = 0;
  for (const o of others) {
    const detail = "A project description is identical to one in another student's evidence";
    if (await raiseFlag({ studentId: a.studentId, check: "reused_text", subjectId: a.id, detail })) raised++;
    if (await raiseFlag({ studentId: o.studentId, check: "reused_text", subjectId: o.id, detail })) raised++;
  }
  return raised;
}

/** Median seconds per item below the thresholds (§6.3): a flag, with the mock left at its current status. */
export async function flagImplausibleSpeed(studentId: string): Promise<number> {
  const policy = await getActivePolicy();
  const rows = await db.select().from(mockAttempts).where(eq(mockAttempts.studentId, studentId));
  const flags = implausibleSpeed(
    rows.map((m) => ({
      id: m.id,
      testType: m.testType,
      date: m.takenAt.toISOString().slice(0, 10),
      items: m.items,
      percentile: m.percentile,
      avgSecondsPerItem: m.avgSecondsPerItem,
      itemKind: (m.itemKind as "mcq" | "numerical" | null) ?? undefined,
      status: m.status,
    })),
    policy,
  );
  let raised = 0;
  for (const f of flags)
    if (await raiseFlag({ studentId, check: f.check, subjectId: f.subjectId, detail: f.detail })) raised++;
  return raised;
}

export async function openFlagsFor(studentId: string) {
  return db
    .select()
    .from(integrityFlags)
    .where(and(eq(integrityFlags.studentId, studentId), eq(integrityFlags.status, "OPEN")));
}
