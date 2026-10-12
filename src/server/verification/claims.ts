/** Normalised identities of what a student claims, for duplicate-claim and reused-text checks (§6.3). */
import { createHash } from "node:crypto";

/** Repository, DOI or certificate id in canonical form, or null if the evidence names none of them. */
export function claimKeyFor(input: { url?: string | null; details?: Record<string, unknown> | null }): string | null {
  const url = input.url?.trim();
  if (url) {
    const gh = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+)/i);
    if (gh) return `github:${gh[1].toLowerCase()}/${gh[2].replace(/\.git$/i, "").toLowerCase()}`;
    const doi = url.match(/(10\.\d{4,9}\/[^\s?#]+)/i);
    if (doi && /doi\.org|doi:/i.test(url)) return `doi:${decodeURIComponent(doi[1]).toLowerCase()}`;
  }
  const cert = input.details?.certificateId;
  if (typeof cert === "string" && cert.trim()) {
    const issuer = String(input.details?.issuer ?? "")
      .trim()
      .toLowerCase();
    return `cert:${issuer}:${cert.trim().toLowerCase()}`;
  }
  return null;
}

/** DOI from a doi.org URL, a "doi:" string or a bare DOI. */
export function doiFrom(value: string): string | null {
  const m = value.match(/(10\.\d{4,9}\/[^\s?#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Hash of a description with case, spacing and punctuation removed. Short texts return null,
 * because two students writing "Final year project" is not a signal.
 */
export function textHashFor(description: string | null | undefined, minLength = 40): string | null {
  const norm = (description ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return norm.length < minLength ? null : createHash("sha256").update(norm).digest("hex");
}
