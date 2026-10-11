/**
 * Audit logging (§13.6). Every read of a student record, policy change,
 * approval or export writes one append-only event (Appendix E shape).
 */
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { logger } from "../logger";
import { getActivePolicy } from "../policy/load";

export interface AuditInput {
  actorUserId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  purpose: string;
  /** Why the action happened, in words (for example why an evidence status changed). */
  reason?: string;
  fieldsAccessed?: string[];
  sourceIp?: string | null;
  result: "allowed" | "denied" | "error";
}

export async function audit(e: AuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      ...e,
      fieldsAccessed: e.fieldsAccessed ?? [],
      sourceIp: e.sourceIp ?? null,
      policyVersion: (await getActivePolicy()).policy_version,
    });
  } catch (err) {
    // An audit failure must be visible; never swallow silently.
    logger.error({ err, action: e.action, entityType: e.entityType }, "audit write failed");
    throw err;
  }
}

/** Many events in one insert, for list views that read several students at once (§13.6). */
export async function auditMany(events: AuditInput[]): Promise<void> {
  if (events.length === 0) return;
  const policyVersion = (await getActivePolicy()).policy_version;
  try {
    await db.insert(auditEvents).values(
      events.map((e) => ({
        ...e,
        fieldsAccessed: e.fieldsAccessed ?? [],
        sourceIp: e.sourceIp ?? null,
        policyVersion,
      })),
    );
  } catch (err) {
    logger.error({ err, count: events.length }, "audit batch write failed");
    throw err;
  }
}
