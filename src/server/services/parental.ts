/**
 * Parental consent for students under 18 (§4.3, §13.4). The date of birth is checked against the age of
 * majority in the policy; until a registrar records verifiable consent, nothing is processed for that student:
 * no evaluation runs and nothing is dispatched.
 */
import { eq } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { parentalConsents, students } from "../db/schema";
import type { Role } from "../db/schema/enums";
import { isMinor } from "../ingestion/quality";
import { notify } from "../notifications";
import { getActivePolicy } from "../policy/load";
import { localDate } from "../rules/calendar";

export class ParentalConsentRequired extends Error {
  constructor() {
    super("This student is under 18 and verifiable parental consent has not been recorded");
  }
}

export interface ParentalState {
  minor: boolean;
  status: "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "REVOKED";
}

export async function parentalState(studentId: string, now = new Date()): Promise<ParentalState> {
  const policy = await getActivePolicy();
  const [s] = await db.select({ dob: students.dateOfBirth }).from(students).where(eq(students.id, studentId)).limit(1);
  if (!isMinor(s?.dob, localDate(now, policy.calendar), policy)) return { minor: false, status: "NOT_REQUIRED" };
  const [c] = await db.select().from(parentalConsents).where(eq(parentalConsents.studentId, studentId)).limit(1);
  return { minor: true, status: (c?.status as ParentalState["status"]) ?? "PENDING" };
}

/** Throws unless processing is allowed. Called before an evaluation or a dispatch. */
export async function assertMayProcess(studentId: string, now = new Date()) {
  const st = await parentalState(studentId, now);
  if (st.minor && st.status !== "VERIFIED") throw new ParentalConsentRequired();
}

/** The registrar records (or revokes) verifiable consent from the guardian (§13.4: "Registrar and legal"). */
export async function recordParentalConsent(
  registrar: { id: string; role: Role },
  studentId: string,
  decision: "verify" | "revoke",
  method: string,
  now = new Date(),
) {
  if (registrar.role !== "registrar") throw new Error("Only the registrar records parental consent");
  if (decision === "verify" && !method.trim()) throw new Error("Say how the guardian was verified");
  const status = decision === "verify" ? "VERIFIED" : "REVOKED";
  await db
    .insert(parentalConsents)
    .values({ studentId, status, method, verifiedBy: registrar.id, verifiedAt: now })
    .onConflictDoUpdate({
      target: parentalConsents.studentId,
      set: { status, method, verifiedBy: registrar.id, verifiedAt: now },
    });
  const [s] = await db.select({ p: students.pseudonymousId }).from(students).where(eq(students.id, studentId)).limit(1);
  await audit({
    actorUserId: registrar.id,
    actorRole: registrar.role,
    action: `parental_consent.${decision}`,
    entityType: "student",
    entityId: s?.p ?? studentId,
    purpose: "children_data",
    reason: method,
    result: "allowed",
  });
  if (decision === "verify")
    await notify({ to: { role: "student" }, studentId, template: "parental_consent_verified" });
}

/** Minors waiting for consent, for the registrar's queue. */
export async function minorsAwaitingConsent(now = new Date()) {
  const policy = await getActivePolicy();
  const asOf = localDate(now, policy.calendar);
  const all = await db
    .select({
      id: students.id,
      handle: students.pseudonymousId,
      dob: students.dateOfBirth,
      dept: students.departmentCode,
      year: students.year,
    })
    .from(students);
  const minors = all.filter((s) => isMinor(s.dob, asOf, policy));
  const consents = await db.select().from(parentalConsents);
  return minors
    .map((m) => ({ ...m, status: consents.find((c) => c.studentId === m.id)?.status ?? "PENDING" }))
    .filter((m) => m.status !== "VERIFIED");
}
