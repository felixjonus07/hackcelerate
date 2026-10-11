/**
 * GitHub repository check (§6.2): owner, creation date, fork status. Commit
 * authorship and OAuth ownership proof are Phase 3.
 */
import { env } from "../env";

export interface RepoCheck {
  ok: boolean;
  owner?: string;
  createdAt?: string;
  fork?: boolean;
  reason?: string;
}

export async function checkRepository(url: string, expectedLogin?: string): Promise<RepoCheck> {
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!m) return { ok: false, reason: "Not a GitHub repository URL" };
  const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, "")}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(env.GITHUB_TOKEN ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return { ok: false, reason: "Repository not found or private" };
  if (!res.ok) return { ok: false, reason: `GitHub API ${res.status}` };
  const r = (await res.json()) as {
    owner: { login: string };
    created_at: string;
    fork: boolean;
  };
  const ownerMatches = !expectedLogin || r.owner.login.toLowerCase() === expectedLogin.toLowerCase();
  return {
    ok: ownerMatches,
    owner: r.owner.login,
    createdAt: r.created_at,
    fork: r.fork,
    reason: ownerMatches ? undefined : "Owner does not match the student's linked account",
  };
}
