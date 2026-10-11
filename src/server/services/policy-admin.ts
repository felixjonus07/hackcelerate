/**
 * Policy administration (§3.3, §11): draft a version, collect approvals, activate.
 * The rules live in `policy/lifecycle.ts`; this module applies them to the
 * `policy_versions` table inside one transaction and writes the audit trail.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { auditEvents, policyVersions } from "../db/schema";
import {
  approvalsRequired,
  changedSections,
  checkApprover,
  inForce,
  isFullyApproved,
  type PolicyApproval,
  retroactiveActivation,
} from "../policy/lifecycle";
import { getActivePolicyInfo, invalidatePolicyCache } from "../policy/load";
import { type Policy, policySchema } from "../policy/schema";
import { enqueueReevaluation } from "./reevaluation";

export type PolicyErrorCode = "not_found" | "not_draft" | "exists" | "approver" | "retroactive";

export class PolicyError extends Error {
  constructor(
    readonly code: PolicyErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Actor = { id: string; role: string };

/** The last day covered by an audit report that was exported to the auditors, or null. */
export async function reportedThrough(): Promise<string | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${auditEvents.at})` })
    .from(auditEvents)
    .where(eq(auditEvents.action, "audit_report.export"));
  return row?.at ? new Date(row.at).toISOString().slice(0, 10) : null;
}

export async function listPolicyVersions() {
  return db
    .select({
      version: policyVersions.version,
      status: policyVersions.status,
      effectiveFrom: policyVersions.effectiveFrom,
      approvals: policyVersions.approvals,
      requiresTwoApprovals: policyVersions.requiresTwoApprovals,
      changedSections: policyVersions.changedSections,
      supersedes: policyVersions.supersedes,
      activatedAt: policyVersions.activatedAt,
      createdAt: policyVersions.createdAt,
    })
    .from(policyVersions)
    .orderBy(desc(policyVersions.effectiveFrom), desc(policyVersions.createdAt));
}

export async function getPolicyDocument(version: string): Promise<Policy | null> {
  const [row] = await db.select().from(policyVersions).where(eq(policyVersions.version, version)).limit(1);
  return row ? policySchema.parse(row.document) : null;
}

/**
 * Retire every ACTIVE version that a newer ACTIVE version has superseded, once that newer
 * version's effective date has arrived. Activation does it for versions already in effect;
 * the daily maintenance job does it for versions that were activated ahead of their date.
 */
export async function rolloverPolicies(now = new Date()): Promise<string[]> {
  const active = await db.select().from(policyVersions).where(eq(policyVersions.status, "ACTIVE"));
  const current = inForce(active, now);
  if (!current) return [];
  const old = active.filter((r) => r.version !== current.version && r.effectiveFrom <= current.effectiveFrom);
  if (old.length === 0) return [];
  await db
    .update(policyVersions)
    .set({ status: "RETIRED", retiredAt: now })
    .where(
      inArray(
        policyVersions.version,
        old.map((r) => r.version),
      ),
    );
  invalidatePolicyCache();
  return old.map((r) => r.version);
}

/** Create a DRAFT. `doc` is validated against the policy schema (ZodError on failure). */
export async function createDraft(user: Actor, doc: unknown, sourceIp?: string | null) {
  const next = policySchema.parse(doc);
  const [existing] = await db
    .select({ v: policyVersions.version })
    .from(policyVersions)
    .where(eq(policyVersions.version, next.policy_version))
    .limit(1);
  if (existing) throw new PolicyError("exists", `Version ${next.policy_version} already exists`);

  const inForce = (await getActivePolicyInfo()).policy;
  const required = approvalsRequired(inForce, next);
  const sections = changedSections(inForce, next);
  await db.insert(policyVersions).values({
    version: next.policy_version,
    status: "DRAFT",
    effectiveFrom: new Date(next.effective_from),
    document: { ...next, status: "DRAFT" },
    createdBy: user.id,
    requiresTwoApprovals: required === 2,
    changedSections: sections,
    supersedes: inForce.policy_version,
  });
  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "policy.create",
    entityType: "policy",
    entityId: next.policy_version,
    purpose: "policy_change",
    fieldsAccessed: sections,
    sourceIp,
    result: "allowed",
  });
  return {
    version: next.policy_version,
    status: "DRAFT" as const,
    approvalsRequired: required,
    changedSections: sections,
  };
}

/**
 * Record one approval. The version becomes ACTIVE when it has the approvals its
 * change requires (two for persona changes), and the previous version is retired.
 */
export async function approveVersion(user: Actor, version: string, sourceIp?: string | null) {
  const reported = await reportedThrough();
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(policyVersions).where(eq(policyVersions.version, version)).for("update");
    if (!row) throw new PolicyError("not_found", "Policy version not found");
    if (row.status !== "DRAFT") throw new PolicyError("not_draft", `Version is ${row.status}`);
    const required: 1 | 2 = row.requiresTwoApprovals ? 2 : 1;

    const check = checkApprover(row.approvals, user, required);
    if (!check.ok) throw new PolicyError("approver", check.message);
    // §3.3: a version cannot take effect inside a period already reported to the auditors.
    if (retroactiveActivation(row.effectiveFrom.toISOString(), reported))
      throw new PolicyError(
        "retroactive",
        `This version starts on ${row.effectiveFrom.toISOString().slice(0, 10)}, inside a period already reported to the auditors (through ${reported}). Draft a new version with a later effective date.`,
      );

    const approvals: PolicyApproval[] = [
      ...row.approvals,
      { userId: user.id, role: user.role, at: new Date().toISOString() },
    ];
    const activate = isFullyApproved(approvals, required);
    const now = new Date();
    if (activate) {
      await tx
        .update(policyVersions)
        .set({
          approvals,
          status: "ACTIVE",
          activatedAt: now,
          document: { ...(row.document as object), status: "ACTIVE" },
        })
        .where(eq(policyVersions.version, version));
    } else {
      await tx.update(policyVersions).set({ approvals }).where(eq(policyVersions.version, version));
    }
    return { approvals: approvals.length, required, activated: activate, sections: row.changedSections };
  });

  await audit({
    actorUserId: user.id,
    actorRole: user.role,
    action: result.activated ? "policy.activate" : "policy.approve",
    entityType: "policy",
    entityId: version,
    purpose: "policy_change",
    fieldsAccessed: result.sections,
    sourceIp,
    result: "allowed",
  });
  if (result.activated) {
    invalidatePolicyCache();
    await rolloverPolicies();
    // §3.3: affected students are flagged for re-evaluation under the new version.
    await enqueueReevaluation(version, user.id);
  }
  return {
    status: result.activated ? ("ACTIVE" as const) : ("DRAFT" as const),
    approvals: result.approvals,
    required: result.required,
  };
}
