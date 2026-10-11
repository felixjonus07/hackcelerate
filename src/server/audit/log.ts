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
      policyVersion: getActivePolicy().policy_version,
    });
  } catch (err) {
    // An audit failure must be visible; never swallow silently.
    logger.error({ err, action: e.action, entityType: e.entityType }, "audit write failed");
    throw err;
  }
}
