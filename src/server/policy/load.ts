/**
 * Loads the active policy.
 * Primary source: policy_versions table with status 'ACTIVE' (§3.3).
 * Falls back to the versioned policy JSON file on disk when database is unseeded
 * or during pure offline testing.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { policyVersions } from "../db/schema";
import { type Policy, parsePolicy } from "./schema";

let cachedActivePolicy: Policy | null = null;
const fileCache = new Map<string, Policy>();

export function clearPolicyCache(): void {
  cachedActivePolicy = null;
  fileCache.clear();
}

export function loadPolicyFile(file = process.env.POLICY_FILE ?? "policy/2026.10-v1.json"): Policy {
  const path = join(process.cwd(), "policy", basename(file));
  const hit = fileCache.get(path);
  if (hit) return hit;
  const policy = parsePolicy(JSON.parse(readFileSync(path, "utf8")));
  fileCache.set(path, policy);
  return policy;
}

/**
 * Load active policy from the database. Caches in-memory;
 * falls back to policy file if database has no active version or is offline.
 */
export async function loadActivePolicyFromDb(): Promise<Policy> {
  try {
    const [row] = await db.select().from(policyVersions).where(eq(policyVersions.status, "ACTIVE")).limit(1);

    if (row?.document) {
      const parsed = parsePolicy(row.document);
      cachedActivePolicy = parsed;
      return parsed;
    }
  } catch {
    // Fall back to file if DB connection is unavailable
  }
  const fallback = loadPolicyFile();
  cachedActivePolicy = fallback;
  return fallback;
}

export function getActivePolicy(): Policy {
  if (cachedActivePolicy) return cachedActivePolicy;
  return loadPolicyFile();
}

export function setActivePolicy(policy: Policy): void {
  cachedActivePolicy = policy;
}
