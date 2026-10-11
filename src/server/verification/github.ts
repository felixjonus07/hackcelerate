/**
 * GitHub repository verification (§6.2).
 *
 * Checks: repository existence, ownership, creation date, fork status,
 * commit authorship, and rate limits. Uses the authenticated GitHub API
 * when a token is available.
 *
 * Never logs OAuth tokens or access keys.
 */
import { env } from "../env";
import { logger } from "../logger";

/* ────────────────── Types ────────────────── */

export interface GitHubVerificationResult {
  /** Whether the verification succeeded overall. */
  verified: boolean;
  /** Whether the result is inconclusive and needs human review. */
  needsReview: boolean;
  /** Safe explanation of the outcome. */
  reason: string;
  /** Verified repository metadata (if accessible). */
  metadata?: {
    owner: string;
    name: string;
    createdAt: string;
    isFork: boolean;
    defaultBranch: string;
    parentOwner?: string;
  };
  /** Commit authorship check results. */
  authorship?: {
    totalCommits: number;
    authoredCommits: number;
    authorshipRatio: number;
    matched: boolean;
  };
  /** Whether the failure is retryable. */
  retryable: boolean;
  /** Error category for operational logging. */
  errorCategory?: "rate_limit" | "auth" | "not_found" | "network" | "server" | "malformed" | "private";
}

/* ────────────────── URL parsing ────────────────── */

const GITHUB_REPO_RE = /^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/;

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.match(GITHUB_REPO_RE);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/* ────────────────── API helpers ────────────────── */

function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }
  return h;
}

async function githubFetch(path: string, signal?: AbortSignal): Promise<Response> {
  // Construct URL from validated path, never from user input directly
  const url = `https://api.github.com${path}`;
  return fetch(url, {
    headers: apiHeaders(),
    signal: signal ?? AbortSignal.timeout(15_000),
  });
}

interface RateLimitInfo {
  remaining: number;
  resetAt: Date;
}

function parseRateLimit(res: Response): RateLimitInfo {
  return {
    remaining: Number(res.headers.get("x-ratelimit-remaining") ?? 0),
    resetAt: new Date(Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000),
  };
}

/* ────────────────── Repository check ────────────────── */

interface RepoResponse {
  owner: { login: string };
  name: string;
  created_at: string;
  fork: boolean;
  default_branch: string;
  parent?: { owner: { login: string }; name: string };
  private: boolean;
}

export async function checkRepository(
  url: string,
  expectedLogin?: string,
): Promise<GitHubVerificationResult> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return { verified: false, needsReview: false, reason: "Not a valid GitHub repository URL", retryable: false };
  }

  let res: Response;
  try {
    res = await githubFetch(`/repos/${parsed.owner}/${parsed.repo}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return { verified: false, needsReview: false, reason: "GitHub API request timed out", retryable: true, errorCategory: "network" };
    }
    return { verified: false, needsReview: false, reason: "Network error reaching GitHub API", retryable: true, errorCategory: "network" };
  }

  // Handle error responses
  if (res.status === 404) {
    return { verified: false, needsReview: false, reason: "Repository not found or private", retryable: false, errorCategory: "not_found" };
  }
  if (res.status === 401) {
    return { verified: false, needsReview: false, reason: "GitHub API authentication failed", retryable: false, errorCategory: "auth" };
  }
  if (res.status === 403) {
    const rl = parseRateLimit(res);
    if (rl.remaining === 0) {
      logger.warn({ resetAt: rl.resetAt.toISOString() }, "GitHub API rate limit reached");
      return { verified: false, needsReview: false, reason: "GitHub API rate limit reached", retryable: true, errorCategory: "rate_limit" };
    }
    return { verified: false, needsReview: false, reason: "GitHub API access denied", retryable: false, errorCategory: "auth" };
  }
  if (res.status === 429) {
    return { verified: false, needsReview: false, reason: "GitHub API secondary rate limit", retryable: true, errorCategory: "rate_limit" };
  }
  if (res.status >= 500) {
    return { verified: false, needsReview: false, reason: `GitHub API server error (${res.status})`, retryable: true, errorCategory: "server" };
  }
  if (!res.ok) {
    return { verified: false, needsReview: false, reason: `GitHub API error (${res.status})`, retryable: false, errorCategory: "malformed" };
  }

  let repo: RepoResponse;
  try {
    repo = (await res.json()) as RepoResponse;
  } catch {
    return { verified: false, needsReview: false, reason: "Malformed GitHub API response", retryable: true, errorCategory: "malformed" };
  }

  const metadata: GitHubVerificationResult["metadata"] = {
    owner: repo.owner.login,
    name: repo.name,
    createdAt: repo.created_at,
    isFork: repo.fork,
    defaultBranch: repo.default_branch,
    parentOwner: repo.parent?.owner.login,
  };

  // Fork check: if the repo is a fork, we need substantial own commits
  if (repo.fork) {
    if (!expectedLogin) {
      return {
        verified: false,
        needsReview: true,
        reason: "Repository is a fork; ownership and contribution need manual review",
        metadata,
        retryable: false,
      };
    }
  }

  // Ownership check
  if (expectedLogin) {
    const ownerMatches = repo.owner.login.toLowerCase() === expectedLogin.toLowerCase();
    if (!ownerMatches) {
      return {
        verified: false,
        needsReview: true,
        reason: `Repository owner "${repo.owner.login}" does not match expected "${expectedLogin}"`,
        metadata,
        retryable: false,
      };
    }
  }

  return {
    verified: true,
    needsReview: false,
    reason: "Repository exists and ownership confirmed",
    metadata,
    retryable: false,
  };
}

/* ────────────────── Commit authorship check ────────────────── */

interface CommitResponse {
  sha: string;
  commit: {
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string };
  };
  author?: { login: string } | null;
  committer?: { login: string } | null;
}

/**
 * Checks commit authorship for a repository.
 * Uses the GitHub commits API to verify the student authored commits.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param expectedLogin - The GitHub login to check for authorship
 * @param expectedEmail - Optional email to check against git commit author
 */
export async function checkCommitAuthorship(
  owner: string,
  repo: string,
  expectedLogin: string,
  expectedEmail?: string,
): Promise<GitHubVerificationResult["authorship"] & { reason: string; retryable: boolean }> {
  let res: Response;
  try {
    // Get up to 100 recent commits
    res = await githubFetch(`/repos/${owner}/${repo}/commits?per_page=100`);
  } catch (err) {
    return {
      totalCommits: 0,
      authoredCommits: 0,
      authorshipRatio: 0,
      matched: false,
      reason: "Network error checking commit authorship",
      retryable: true,
    };
  }

  if (!res.ok) {
    return {
      totalCommits: 0,
      authoredCommits: 0,
      authorshipRatio: 0,
      matched: false,
      reason: `GitHub commits API error (${res.status})`,
      retryable: res.status >= 500 || res.status === 429,
    };
  }

  let commits: CommitResponse[];
  try {
    commits = (await res.json()) as CommitResponse[];
  } catch {
    return {
      totalCommits: 0,
      authoredCommits: 0,
      authorshipRatio: 0,
      matched: false,
      reason: "Malformed commits response",
      retryable: true,
    };
  }

  if (!Array.isArray(commits) || commits.length === 0) {
    return {
      totalCommits: 0,
      authoredCommits: 0,
      authorshipRatio: 0,
      matched: false,
      reason: "Repository has no commits",
      retryable: false,
    };
  }

  const loginLower = expectedLogin.toLowerCase();
  const emailLower = expectedEmail?.toLowerCase();

  let authoredCount = 0;
  for (const c of commits) {
    // Check GitHub linked author identity (most reliable)
    if (c.author?.login?.toLowerCase() === loginLower) {
      authoredCount++;
      continue;
    }
    // Check git commit email
    if (emailLower && c.commit.author.email.toLowerCase() === emailLower) {
      authoredCount++;
      continue;
    }
  }

  const ratio = commits.length > 0 ? authoredCount / commits.length : 0;

  return {
    totalCommits: commits.length,
    authoredCommits: authoredCount,
    authorshipRatio: ratio,
    matched: authoredCount > 0,
    reason:
      authoredCount > 0
        ? `${authoredCount}/${commits.length} commits authored by ${expectedLogin}`
        : `No commits found authored by ${expectedLogin}`,
    retryable: false,
  };
}

/* ──────── Full verification: repo + authorship + fork ──────── */

/**
 * Performs a complete GitHub verification: repository check, commit authorship,
 * and fork analysis. Returns a composite result.
 */
export async function verifyGitHub(
  url: string,
  expectedLogin?: string,
  expectedEmail?: string,
): Promise<GitHubVerificationResult> {
  // 1. Check repository existence and ownership
  const repoResult = await checkRepository(url, expectedLogin);
  if (!repoResult.verified && !repoResult.needsReview) {
    return repoResult;
  }

  // 2. Check commit authorship (if we have an expected login and the repo exists)
  if (expectedLogin && repoResult.metadata) {
    const authorship = await checkCommitAuthorship(
      repoResult.metadata.owner,
      repoResult.metadata.name,
      expectedLogin,
      expectedEmail,
    );

    const result: GitHubVerificationResult = {
      ...repoResult,
      authorship: {
        totalCommits: authorship.totalCommits,
        authoredCommits: authorship.authoredCommits,
        authorshipRatio: authorship.authorshipRatio,
        matched: authorship.matched,
      },
    };

    // Fork with substantial own commits is ok; fork with no own commits needs review
    if (repoResult.metadata.isFork) {
      if (authorship.authoredCommits === 0) {
        return {
          ...result,
          verified: false,
          needsReview: true,
          reason: "Fork with no authored commits; needs manual review",
        };
      }
      // Fork with own commits: still needs review per spec (forks need substantial own commits)
      if (authorship.authorshipRatio < 0.1) {
        return {
          ...result,
          verified: false,
          needsReview: true,
          reason: `Fork with only ${authorship.authoredCommits} authored commits (${(authorship.authorshipRatio * 100).toFixed(0)}%); needs review`,
        };
      }
    }

    // No authored commits at all
    if (!authorship.matched) {
      return {
        ...result,
        verified: false,
        needsReview: true,
        reason: authorship.reason,
      };
    }

    return {
      ...result,
      verified: true,
      needsReview: false,
      reason: `Repository verified: ${authorship.reason}`,
    };
  }

  return repoResult;
}
