/**
 * The policy in force (§3.1, §3.3): the ACTIVE row of `policy_versions` whose
 * effective date has started, Zod-validated; when the table has no such row (a
 * fresh install) or the database is unreachable, the file named by POLICY_FILE.
 * Every evaluation records the version it used, so a change never rewrites history.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { policyVersions } from "../db/schema";
import { logger } from "../logger";
import { loadPolicyFile } from "./file";
import { inForce } from "./lifecycle";
import { type Policy, parsePolicy } from "./schema";

export interface PolicyInfo {
  policy: Policy;
  /** Where the policy came from: the database row in force, or the bundled file. */
  source: "database" | "file";
}

/** Short cache: a policy change reaches other processes (workers) within this window. */
const TTL_MS = 30_000;
const FAILURE_TTL_MS = 5_000;

const g = globalThis as unknown as { policyCache?: { until: number; info: PolicyInfo } };

export function invalidatePolicyCache() {
  g.policyCache = undefined;
}

export async function getActivePolicyInfo(now = new Date()): Promise<PolicyInfo> {
  const hit = g.policyCache;
  if (hit && hit.until > Date.now()) return hit.info;

  let info: PolicyInfo | null = null;
  let ttl = TTL_MS;
  try {
    const rows = await db.select().from(policyVersions).where(eq(policyVersions.status, "ACTIVE"));
    const row = inForce(rows, now);
    if (row) {
      try {
        // The row's own columns win over whatever status the stored document carries.
        const policy = parsePolicy({
          ...(row.document as object),
          policy_version: row.version,
          status: row.status,
          effective_from: row.effectiveFrom.toISOString().slice(0, 10),
        });
        info = { policy, source: "database" };
      } catch (err) {
        logger.error({ version: row.version, err: String(err) }, "active policy failed validation; using the file");
        ttl = FAILURE_TTL_MS;
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "policy table unavailable; using the file");
    ttl = FAILURE_TTL_MS;
  }
  info ??= { policy: loadPolicyFile(), source: "file" };
  g.policyCache = { until: Date.now() + ttl, info };
  return info;
}

export async function getActivePolicy(): Promise<Policy> {
  return (await getActivePolicyInfo()).policy;
}
