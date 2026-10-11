/**
 * Loads the active policy. Phase 0: reads the JSON file named by POLICY_FILE
 * from the `policy/` folder. Phase 1 adds the `policy_versions` table as the
 * primary source (§3.3).
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Policy, parsePolicy } from "./schema";

const cache = new Map<string, Policy>();

export function loadPolicyFile(file = process.env.POLICY_FILE ?? "policy/2026.10-v1.json"): Policy {
  // Scoped to policy/ so the server bundle traces only that folder.
  const path = join(process.cwd(), "policy", basename(file));
  const hit = cache.get(path);
  if (hit) return hit;
  const policy = parsePolicy(JSON.parse(readFileSync(path, "utf8")));
  cache.set(path, policy);
  return policy;
}

export function getActivePolicy(): Policy {
  return loadPolicyFile();
}
