#!/usr/bin/env node
/**
 * Vercel Ignored Build Step script (ignoreCommand in vercel.json)
 *
 * NOTE: Vercel's ignoreCommand exit-code convention is the INVERSE of
 *       standard Unix conventions:
 *
 *   Exit 1 → BUILD   (Vercel: "yes, deploy this")
 *   Exit 0 → SKIP    (Vercel: "nothing to deploy, cancel")
 *
 * Skips builds when ONLY these paths changed (docs, config, markdown, etc.)
 * Always builds when src/, public/, package.json, next.config.ts, etc. change.
 */

import { execSync } from "node:child_process";

const SKIP_PATTERNS = [
  /^README\.md$/,
  /^PLAN\.md$/,
  /^PRODUCT\.md$/,
  /^DESIGN\.md$/,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^docs\//,
  /^\.playwright\//,
  /^\.impeccable\//,
  /^e2e\//,
  /^\.claude\//,
  /^biome\.json$/,
  /^playwright\.config\.ts$/,
  /^vitest\.config\.mts$/,
];

function getChangedFiles() {
  try {
    // VERCEL_GIT_PREVIOUS_SHA is set by Vercel for the previous deployed commit
    const base = process.env.VERCEL_GIT_PREVIOUS_SHA;
    const head = process.env.VERCEL_GIT_COMMIT_SHA || "HEAD";

    if (!base) {
      // No previous deploy found — always build (e.g. first deploy or redeployment)
      console.log("No previous SHA found — proceeding with build.");
      process.exit(1); // exit 1 = BUILD
    }

    const diff = execSync(`git diff --name-only ${base} ${head}`, {
      encoding: "utf8",
    }).trim();

    if (!diff) {
      console.log("No changed files detected — skipping build.");
      process.exit(0); // exit 0 = SKIP
    }

    return diff.split("\n").filter(Boolean);
  } catch (err) {
    // If git diff fails for any reason, be safe and build
    console.error("git diff failed:", err.message);
    process.exit(1); // exit 1 = BUILD (safe fallback)
  }
}

const changed = getChangedFiles();
console.log(`Changed files (${changed.length}):\n${changed.join("\n")}`);

const allSkippable = changed.every((file) => SKIP_PATTERNS.some((pattern) => pattern.test(file)));

if (allSkippable) {
  console.log("All changes are in non-app files — skipping build. ✓");
  process.exit(0); // exit 0 = SKIP
} else {
  console.log("App files changed — proceeding with build. ✓");
  process.exit(1); // exit 1 = BUILD
}

