#!/usr/bin/env node
/**
 * Vercel Ignore Build Script
 * Exit 0 → proceed with build
 * Exit 1 → skip build (saves free-plan build minutes)
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
      // No previous deploy found — always build (e.g. first deploy)
      console.log("No previous SHA found — proceeding with build.");
      process.exit(0);
    }

    const diff = execSync(`git diff --name-only ${base} ${head}`, {
      encoding: "utf8",
    }).trim();

    if (!diff) {
      console.log("No changed files detected — skipping build.");
      process.exit(1);
    }

    return diff.split("\n").filter(Boolean);
  } catch (err) {
    // If git diff fails for any reason, be safe and build
    console.error("git diff failed:", err.message);
    process.exit(0);
  }
}

const changed = getChangedFiles();
console.log(`Changed files (${changed.length}):\n${changed.join("\n")}`);

const allSkippable = changed.every((file) =>
  SKIP_PATTERNS.some((pattern) => pattern.test(file))
);

if (allSkippable) {
  console.log("All changes are in non-app files — skipping build. ✓");
  process.exit(1); // Tell Vercel: skip this build
} else {
  console.log("App files changed — proceeding with build. ✓");
  process.exit(0); // Tell Vercel: build it
}
