/** Consent center reads/writes (§12.1 card 2, §13.4). History is append-only. */
import { and, desc, eq } from "drizzle-orm";
import { CONSENT_RECIPIENTS, CONSENTABLE } from "../consent/matrix";
import { db } from "../db";
import { consentRecords } from "../db/schema";
import type { ConsentCategory, Role } from "../db/schema/enums";

export type ConsentState = Record<string, Record<string, boolean>>;

/** Latest record per (category, recipient). Default: mentor only, nothing else shared. */
export async function currentConsents(studentId: string): Promise<ConsentState> {
  const rows = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.studentId, studentId))
    .orderBy(desc(consentRecords.changedAt));
  const state: ConsentState = {};
  for (const category of Object.keys(CONSENTABLE)) {
    state[category] = {};
    for (const r of CONSENT_RECIPIENTS) state[category][r] = false;
  }
  const seen = new Set<string>();
  for (const r of rows) {
    const k = `${r.category}:${r.recipientRole}`;
    if (seen.has(k) || !state[r.category]) continue;
    seen.add(k);
    state[r.category][r.recipientRole] = r.granted;
  }
  return state;
}

export async function hasConsent(studentId: string, category: ConsentCategory, recipient: Role): Promise<boolean> {
  const [row] = await db
    .select({ granted: consentRecords.granted })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.studentId, studentId),
        eq(consentRecords.category, category),
        eq(consentRecords.recipientRole, recipient),
      ),
    )
    .orderBy(desc(consentRecords.changedAt))
    .limit(1);
  return row?.granted ?? false;
}

export async function setConsent(
  studentId: string,
  category: ConsentCategory,
  recipient: Role,
  granted: boolean,
  changedBy: string,
) {
  await db.insert(consentRecords).values({
    studentId,
    category,
    recipientRole: recipient,
    granted,
    changedBy,
  });
}
