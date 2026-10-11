/**
 * Crossref DOI verification (§6.2). Looks up publications via the Crossref
 * REST API and matches author names against the student profile.
 *
 * Name variants that don't match cleanly are routed to mentor review
 * rather than being automatically rejected.
 */
import { env } from "../env";

/* ────────────────── Types ────────────────── */

export interface CrossrefResult {
  verified: boolean;
  needsReview: boolean;
  reason: string;
  metadata?: {
    doi: string;
    title: string;
    authors: string[];
    publishedDate?: string;
    publisher?: string;
  };
  nameMatch?: {
    matched: boolean;
    bestMatchScore: number;
    matchedAuthor?: string;
    candidateAuthors: string[];
  };
  retryable: boolean;
  errorCategory?: "not_found" | "rate_limit" | "network" | "malformed" | "server";
}

/* ────────────────── DOI normalization ────────────────── */

/**
 * Normalizes a DOI from various input forms:
 * - https://doi.org/10.1234/example
 * - https://dx.doi.org/10.1234/example
 * - http://doi.org/10.1234/example
 * - doi:10.1234/example
 * - 10.1234/example (bare)
 *
 * Returns null if the input is not a valid DOI.
 */
export function normalizeDoi(input: string): string | null {
  const trimmed = input.trim();

  // Remove URL prefix forms
  let doi = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "")
    .trim();

  // Remove tracking parameters (anything after ?)
  const qIdx = doi.indexOf("?");
  if (qIdx > 0) doi = doi.slice(0, qIdx);

  // Basic DOI format validation: must start with "10." and contain a "/"
  if (!doi.startsWith("10.") || !doi.includes("/")) {
    return null;
  }

  // Must have content after the "/"
  const slashIdx = doi.indexOf("/");
  if (slashIdx >= doi.length - 1) return null;

  return doi;
}

/* ────────────────── Name matching ────────────────── */

/**
 * Normalizes a name for comparison: lowercase, trim, collapse whitespace,
 * remove accents/diacritics where possible.
 */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Strip diacritics
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:'"]/g, "");
}

/**
 * Computes a match score between two names. Returns 0–1.
 * - 1.0: exact match (after normalization)
 * - 0.8+: family name matches and given name initial matches
 * - 0.6+: family name matches only
 * - 0.0: no match
 */
export function nameMatchScore(studentName: string, authorName: string): number {
  const sNorm = normalizeName(studentName);
  const aNorm = normalizeName(authorName);

  // Exact match
  if (sNorm === aNorm) return 1.0;

  // Split into parts
  const sParts = sNorm.split(" ").filter(Boolean);
  const aParts = aNorm.split(" ").filter(Boolean);

  if (sParts.length === 0 || aParts.length === 0) return 0;

  // Check family name match (last part)
  const sFamilyName = sParts[sParts.length - 1];
  const aFamilyName = aParts[aParts.length - 1];

  if (sFamilyName !== aFamilyName) {
    // Try reversed order (some cultures put family name first)
    const sFirstAsFamily = sParts[0];
    const aFirstAsFamily = aParts[0];

    if (sFirstAsFamily === aFamilyName || sFamilyName === aFirstAsFamily) {
      // One name uses reversed order; check initials
      return 0.7;
    }

    return 0;
  }

  // Family name matches — check given name
  if (sParts.length >= 2 && aParts.length >= 2) {
    const sGiven = sParts.slice(0, -1);
    const aGiven = aParts.slice(0, -1);

    // Full given name match
    if (sGiven.join(" ") === aGiven.join(" ")) return 1.0;

    // Initial match (e.g., "J" matches "John")
    const sInitial = sGiven[0][0];
    const aInitial = aGiven[0][0];
    if (sInitial === aInitial) return 0.85;

    // Check if given name is just an initial
    if (sGiven[0].length === 1 || aGiven[0].length === 1) return 0.8;

    return 0.65; // Family matched but given names different
  }

  // Only family name available on one side
  return 0.6;
}

const REVIEW_THRESHOLD = 0.8; // Below this, route to mentor review
const REJECT_THRESHOLD = 0.3; // Below this, definitely not a match

/* ────────────────── Crossref API lookup ────────────────── */

interface CrossrefWork {
  DOI: string;
  title?: string[];
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
  }>;
  "published-print"?: { "date-parts": number[][] };
  "published-online"?: { "date-parts": number[][] };
  publisher?: string;
  "container-title"?: string[];
  URL?: string;
}

interface CrossrefResponse {
  status: string;
  message: CrossrefWork;
}

/**
 * Looks up a DOI via the Crossref REST API and checks author-name match.
 */
export async function verifyCrossref(doiInput: string, studentName: string): Promise<CrossrefResult> {
  const doi = normalizeDoi(doiInput);
  if (!doi) {
    return { verified: false, needsReview: false, reason: "Invalid DOI format", retryable: false };
  }

  // Build the API URL with mailto for polite pool
  const mailto = env.CROSSREF_MAILTO ? `?mailto=${encodeURIComponent(env.CROSSREF_MAILTO)}` : "";
  const apiUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}${mailto}`;

  let res: Response;
  try {
    res = await fetch(apiUrl, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return {
        verified: false,
        needsReview: false,
        reason: "Crossref API request timed out",
        retryable: true,
        errorCategory: "network",
      };
    }
    return {
      verified: false,
      needsReview: false,
      reason: "Network error reaching Crossref API",
      retryable: true,
      errorCategory: "network",
    };
  }

  if (res.status === 404) {
    return {
      verified: false,
      needsReview: false,
      reason: "DOI not found in Crossref",
      retryable: false,
      errorCategory: "not_found",
    };
  }
  if (res.status === 429) {
    return {
      verified: false,
      needsReview: false,
      reason: "Crossref API rate limit reached",
      retryable: true,
      errorCategory: "rate_limit",
    };
  }
  if (res.status >= 500) {
    return {
      verified: false,
      needsReview: false,
      reason: `Crossref server error (${res.status})`,
      retryable: true,
      errorCategory: "server",
    };
  }
  if (!res.ok) {
    return {
      verified: false,
      needsReview: false,
      reason: `Crossref API error (${res.status})`,
      retryable: false,
      errorCategory: "malformed",
    };
  }

  let body: CrossrefResponse;
  try {
    body = (await res.json()) as CrossrefResponse;
  } catch {
    return {
      verified: false,
      needsReview: false,
      reason: "Malformed Crossref response",
      retryable: true,
      errorCategory: "malformed",
    };
  }

  const work = body.message;
  if (!work) {
    return {
      verified: false,
      needsReview: false,
      reason: "Empty Crossref response",
      retryable: false,
      errorCategory: "malformed",
    };
  }

  // Extract metadata
  const title = work.title?.[0] ?? "";
  const authors = (work.author ?? []).map((a) => {
    if (a.name) return a.name;
    return [a.given, a.family].filter(Boolean).join(" ");
  });

  const dateParts = work["published-print"]?.["date-parts"]?.[0] ?? work["published-online"]?.["date-parts"]?.[0];
  const publishedDate = dateParts ? dateParts.filter(Boolean).join("-") : undefined;

  const metadata: CrossrefResult["metadata"] = {
    doi,
    title,
    authors,
    publishedDate,
    publisher: work.publisher,
  };

  // Author name matching
  if (!work.author || work.author.length === 0) {
    return {
      verified: false,
      needsReview: true,
      reason: "Publication found but no author metadata available; needs mentor review",
      metadata,
      retryable: false,
    };
  }

  let bestScore = 0;
  let bestMatch = "";

  for (const author of work.author) {
    const authorFullName = author.name ?? [author.given, author.family].filter(Boolean).join(" ");
    if (!authorFullName) continue;

    const score = nameMatchScore(studentName, authorFullName);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = authorFullName;
    }

    // Also try matching just the family name
    if (author.family) {
      const familyScore = nameMatchScore(studentName, author.family);
      if (familyScore > bestScore) {
        bestScore = familyScore;
        bestMatch = authorFullName;
      }
    }
  }

  const nameMatch: CrossrefResult["nameMatch"] = {
    matched: bestScore >= REVIEW_THRESHOLD,
    bestMatchScore: bestScore,
    matchedAuthor: bestMatch || undefined,
    candidateAuthors: authors,
  };

  if (bestScore >= REVIEW_THRESHOLD) {
    return {
      verified: true,
      needsReview: false,
      reason: `DOI verified; author "${bestMatch}" matches student name (score: ${bestScore.toFixed(2)})`,
      metadata,
      nameMatch,
      retryable: false,
    };
  }

  if (bestScore >= REJECT_THRESHOLD) {
    return {
      verified: false,
      needsReview: true,
      reason: `Name variant detected: best match "${bestMatch}" (score: ${bestScore.toFixed(2)}); flagged for mentor review`,
      metadata,
      nameMatch,
      retryable: false,
    };
  }

  return {
    verified: false,
    needsReview: true,
    reason: `Author name not matched in publication authors; flagged for mentor review`,
    metadata,
    nameMatch,
    retryable: false,
  };
}
