/**
 * GitHub repository check (§6.2): owner, creation date, commit authorship and fork status. Ownership
 * is proven by the student's OAuth-linked login; a repository whose owner we cannot tie to the
 * student stays LIVE_UNVERIFIED. Private repositories are never readable without consent.
 */

import type { Policy, VerificationStatus } from "../policy/schema";
import { burstCommits, type IntegrityFlag } from "../rules/integrity";
import type { Fetcher } from "./http";

const API = "https://api.github.com";

export interface RepoReport {
  state: "found" | "not_found" | "error";
  httpStatus: number;
  fullName?: string;
  ownerLogin?: string;
  fork?: boolean;
  createdAt?: string;
  /** Author dates of the student's own commits (up to 100). */
  commitTimes: string[];
}

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+)/i);
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/i, "") } : null;
}

export async function fetchRepoReport(
  url: string,
  opts: { login?: string | null; token?: string; fetcher?: Fetcher } = {},
): Promise<RepoReport> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const parsed = parseRepoUrl(url);
  if (!parsed) return { state: "not_found", httpStatus: 0, commitTimes: [] };
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AspirEdge-verification/1.0",
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
  };
  const get = (path: string) => fetcher(`${API}${path}`, { headers, signal: AbortSignal.timeout(10_000) });

  const res = await get(`/repos/${parsed.owner}/${parsed.repo}`);
  if (res.status === 404) return { state: "not_found", httpStatus: 404, commitTimes: [] };
  // Rate limits and outages are not a verdict about the repository: let the job retry.
  if (!res.ok) return { state: "error", httpStatus: res.status, commitTimes: [] };
  const repo = (await res.json()) as { full_name: string; owner: { login: string }; fork: boolean; created_at: string };
  const report: RepoReport = {
    state: "found",
    httpStatus: 200,
    fullName: repo.full_name,
    ownerLogin: repo.owner.login,
    fork: repo.fork,
    createdAt: repo.created_at,
    commitTimes: [],
  };
  if (opts.login) {
    const commits = await get(
      `/repos/${parsed.owner}/${parsed.repo}/commits?author=${encodeURIComponent(opts.login)}&per_page=100`,
    );
    if (commits.ok) {
      const list = (await commits.json()) as { commit: { author: { date: string } } }[];
      report.commitTimes = list.map((c) => c.commit.author.date);
    } else if (commits.status !== 404 && commits.status !== 409) {
      return { ...report, state: "error", httpStatus: commits.status };
    }
  }
  return report;
}

/** Commit pattern used by the burst-commit check (§6.3). */
export function commitPattern(times: string[]): {
  peakPerMinute: number;
  share24h: number;
  hadEarlierActivity: boolean;
} {
  const t = times
    .map((x) => Date.parse(x))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (t.length === 0) return { peakPerMinute: 0, share24h: 0, hadEarlierActivity: false };
  let peak = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[i] - t[j] >= 60_000) j++;
    peak = Math.max(peak, i - j + 1);
  }
  let best = 0;
  let bestStart = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[i] - t[j] > 86_400_000) j++;
    if (i - j + 1 > best) {
      best = i - j + 1;
      bestStart = t[j];
    }
  }
  return { peakPerMinute: peak, share24h: best / t.length, hadEarlierActivity: t.some((x) => x < bestStart) };
}

export interface RepoDecision {
  status: VerificationStatus;
  reason: string;
  flags: IntegrityFlag[];
}

export function decideRepository(
  report: RepoReport,
  student: { verifiedLogin: string | null },
  repoId: string,
  policy: Pick<Policy, "verification" | "integrity">,
): RepoDecision {
  if (report.state === "not_found")
    return {
      status: "UNVERIFIED",
      reason: "Repository not found, or it is private (private repositories are not readable without consent)",
      flags: [],
    };
  const login = student.verifiedLogin?.toLowerCase() ?? null;
  const owns = login != null && report.ownerLogin?.toLowerCase() === login;
  const own = report.commitTimes.length;
  const minOwn = report.fork ? policy.verification.github.fork_min_own_commits : 1;
  const flags = (() => {
    const p = commitPattern(report.commitTimes);
    return burstCommits(p.peakPerMinute, p.share24h, p.hadEarlierActivity, repoId, policy as Policy);
  })();

  if (report.fork && !(login != null && own >= minOwn))
    return {
      status: login ? "UNVERIFIED" : "LIVE_UNVERIFIED",
      reason: login
        ? `A fork counts only with at least ${minOwn} commits of your own; found ${own}`
        : "A fork counts only with commits of your own, which need your linked GitHub account to confirm",
      flags,
    };
  if (owns || (login != null && own >= minOwn))
    return {
      status: "VERIFIED",
      reason: owns
        ? "GitHub API confirmed the repository belongs to your linked account"
        : `GitHub API confirmed ${own} commits authored by your linked account`,
      flags,
    };
  if (login)
    return {
      status: "UNVERIFIED",
      reason: `The repository belongs to ${report.ownerLogin}, not your linked account, and has no commits by you`,
      flags,
    };
  return {
    status: "LIVE_UNVERIFIED",
    reason: "The repository exists but ownership is not confirmed; link your GitHub account to confirm it",
    flags,
  };
}
