/**
 * Reads a policy file from `policy/` (no database). Used by tests, scripts and as
 * the fallback when no ACTIVE version exists in the `policy_versions` table.
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Policy, parsePolicy } from "./schema";

const cache = new Map<string, Policy>();

export const DEFAULT_POLICY_FILE = "policy/2026.10-v1.json";

export function loadPolicyFile(file = process.env.POLICY_FILE ?? DEFAULT_POLICY_FILE): Policy {
  // Scoped to policy/ so the server bundle traces only that folder.
  const path = join(process.cwd(), "policy", basename(file));
  const hit = cache.get(path);
  if (hit) return hit;
  const policy = parsePolicy(JSON.parse(readFileSync(path, "utf8")));
  cache.set(path, policy);
  return policy;
}
