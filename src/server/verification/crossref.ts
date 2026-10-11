/** DOI check via the Crossref works lookup, with an author-name match (§6.2). */
import type { VerificationStatus } from "../policy/schema";
import type { Fetcher } from "./http";

export interface WorkReport {
  state: "found" | "not_found" | "error";
  httpStatus: number;
  title?: string;
  authors: { family?: string; given?: string }[];
}

export async function fetchWork(doi: string, opts: { mailto?: string; fetcher?: Fetcher } = {}): Promise<WorkReport> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}${opts.mailto ? `?mailto=${encodeURIComponent(opts.mailto)}` : ""}`;
  const res = await fetcher(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "AspirEdge-verification/1.0" },
  });
  if (res.status === 404) return { state: "not_found", httpStatus: 404, authors: [] };
  if (!res.ok) return { state: "error", httpStatus: res.status, authors: [] };
  const body = (await res.json()) as { message: { title?: string[]; author?: { family?: string; given?: string }[] } };
  return { state: "found", httpStatus: 200, title: body.message.title?.[0], authors: body.message.author ?? [] };
}

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Split "Given Family" (the display name on file) into parts. */
export function splitName(displayName: string): { given: string; family: string } {
  const parts = displayName.trim().split(/\s+/);
  return { given: parts.slice(0, -1).join(" "), family: parts.at(-1) ?? "" };
}

export type NameMatch = "match" | "variant" | "none";

/**
 * Compare the DOI's authors with the student's name. An exact family name with a matching given
 * initial is a match; a near family name, or a different given name, is a variant for mentor review.
 */
export function matchAuthor(authors: WorkReport["authors"], student: { given: string; family: string }): NameMatch {
  const fam = fold(student.family);
  const initial = fold(student.given)[0] ?? "";
  let best: NameMatch = "none";
  for (const a of authors) {
    const f = fold(a.family ?? "");
    if (!f || !fam) continue;
    const gi = fold(a.given ?? "")[0] ?? "";
    const sameInitial = !initial || !gi || initial === gi;
    if (f === fam && sameInitial) return "match";
    const close = distance(f, fam) <= (fam.length > 6 ? 2 : 1);
    if ((f === fam || close) && best === "none") best = "variant";
  }
  return best;
}

export function decideDoi(
  report: WorkReport,
  student: { given: string; family: string },
): { status: VerificationStatus; reason: string; nameVariant: boolean } {
  if (report.state === "not_found")
    return { status: "UNVERIFIED", reason: "The DOI was not found in Crossref", nameVariant: false };
  const m = matchAuthor(report.authors, student);
  if (m === "match")
    return { status: "VERIFIED", reason: "Crossref lists you as an author of this work", nameVariant: false };
  if (m === "variant")
    return {
      status: "SELF_REPORTED",
      reason: "An author name is close to yours but not identical; a mentor will review it",
      nameVariant: true,
    };
  return {
    status: "UNVERIFIED",
    reason: "Your name is not among the authors Crossref lists for this DOI",
    nameVariant: false,
  };
}
