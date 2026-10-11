/**
 * Portfolio / live-link verification (§6.2).
 *
 * Validates URLs, protects against SSRF, checks liveness, and performs
 * basic owner-name matching on the page content. Login-wall pages
 * result in LIVE_UNVERIFIED per the reference plan.
 */
import { logger } from "../logger";

/* ────────────────── Types ────────────────── */

export interface LinkVerificationResult {
  live: boolean;
  ownerMatched: boolean;
  loginWall: boolean;
  reason: string;
  httpStatus?: number;
  retryable: boolean;
  errorCategory?: "ssrf" | "network" | "timeout" | "tls" | "content" | "redirect" | "blocked";
}

/* ────────────────── SSRF Protection ────────────────── */

/**
 * Blocked IP ranges for SSRF protection.
 * Includes localhost, private networks, link-local, cloud metadata endpoints.
 */
const BLOCKED_PATTERNS = [
  // IPv4 private / loopback / link-local
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  // IPv6 loopback and link-local
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  // Mapped IPv4
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i,
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
  "169.254.169.254", // AWS/GCP metadata
  "metadata",
  "[::1]",
]);

/**
 * Validates a URL for safety against SSRF attacks.
 * Returns a safe URL string or null if blocked.
 */
export function validateUrl(urlStr: string): { safe: boolean; reason: string; url?: URL } {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { safe: false, reason: "Malformed URL" };
  }

  // Only allow HTTP(S)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { safe: false, reason: `Unsupported protocol: ${url.protocol}` };
  }

  // Block empty hostname
  if (!url.hostname) {
    return { safe: false, reason: "Empty hostname" };
  }

  // Block known dangerous hostnames
  const hostLower = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostLower)) {
    return { safe: false, reason: "Blocked hostname (internal/metadata)" };
  }

  // Block IPs in private ranges
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(url.hostname)) {
      return { safe: false, reason: "Blocked IP range (private/loopback)" };
    }
  }

  // Block credentials in URL
  if (url.username || url.password) {
    return { safe: false, reason: "URL contains credentials" };
  }

  return { safe: true, reason: "URL is safe", url };
}

/**
 * Validates a redirect destination for SSRF safety.
 */
function isRedirectSafe(location: string, originalUrl: string): boolean {
  const result = validateUrl(location);
  if (!result.safe) return false;

  // Additional check: don't follow redirects to different schemes
  try {
    const orig = new URL(originalUrl);
    const dest = new URL(location);
    // Allow http → https upgrade but not https → http
    if (orig.protocol === "https:" && dest.protocol === "http:") return false;
  } catch {
    return false;
  }

  return true;
}

/* ────────────────── Login wall detection ────────────────── */

const LOGIN_WALL_PATTERNS = [
  /sign[\s_-]?in/i,
  /log[\s_-]?in/i,
  /authentication[\s_-]?required/i,
  /please[\s_]+(sign|log)[\s_]?in/i,
  /access[\s_-]?denied/i,
  /403[\s_-]?forbidden/i,
  /unauthorized/i,
  /<form[^>]*(?:login|signin|auth)/i,
  /oauth/i,
  /sso[\s_-]?redirect/i,
];

function detectLoginWall(html: string, status: number): boolean {
  // Status codes that typically indicate auth required
  if (status === 401 || status === 403) return true;

  // Check body content for login patterns (first 50k chars)
  const sample = html.slice(0, 50_000).toLowerCase();
  let matchCount = 0;
  for (const pattern of LOGIN_WALL_PATTERNS) {
    if (pattern.test(sample)) matchCount++;
    if (matchCount >= 2) return true; // Need at least 2 signals
  }

  return false;
}

/* ────────────────── Owner name matching ────────────────── */

/**
 * Checks whether the page content contains evidence of the claimed owner.
 * Does NOT bypass any authentication or CAPTCHA.
 */
function checkOwnerName(html: string, ownerName: string): boolean {
  if (!ownerName || ownerName.trim().length < 2) return false;

  const sample = html.slice(0, 200_000).toLowerCase();
  const nameLower = ownerName.toLowerCase().trim();

  // Check for full name
  if (sample.includes(nameLower)) return true;

  // Check for parts of the name (first and last)
  const parts = nameLower.split(/\s+/).filter((p) => p.length > 2);
  if (parts.length >= 2) {
    const allPartsFound = parts.every((part) => sample.includes(part));
    if (allPartsFound) return true;
  }

  return false;
}

/* ────────────────── Link check ────────────────── */

const MAX_RESPONSE_BYTES = 1_000_000; // 1MB
const MAX_REDIRECTS = 5;

/**
 * Verifies a portfolio or external link.
 * - Validates URL against SSRF
 * - Checks liveness
 * - Detects login walls → LIVE_UNVERIFIED
 * - Checks owner name on accessible pages
 */
export async function checkLink(
  url: string,
  ownerName?: string,
): Promise<LinkVerificationResult> {
  // 1. SSRF validation
  const validation = validateUrl(url);
  if (!validation.safe) {
    return {
      live: false,
      ownerMatched: false,
      loginWall: false,
      reason: validation.reason,
      retryable: false,
      errorCategory: "ssrf",
    };
  }

  // 2. Fetch with manual redirect handling for SSRF safety
  let currentUrl = url;
  let redirectCount = 0;
  let res: Response;

  try {
    // Follow redirects manually to validate each destination
    while (redirectCount < MAX_REDIRECTS) {
      res = await fetch(currentUrl, {
        redirect: "manual", // Don't auto-follow
        signal: AbortSignal.timeout(15_000),
        headers: {
          "User-Agent": "AspirEdge-Verification/1.0",
          Accept: "text/html,application/xhtml+xml,*/*",
        },
      });

      // Check for redirects
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) break;

        // Resolve relative redirects
        const absLocation = new URL(location, currentUrl).toString();

        if (!isRedirectSafe(absLocation, url)) {
          return {
            live: false,
            ownerMatched: false,
            loginWall: false,
            reason: "Redirect to blocked destination (SSRF protection)",
            retryable: false,
            errorCategory: "redirect",
          };
        }

        currentUrl = absLocation;
        redirectCount++;
        continue;
      }

      break; // Not a redirect, process the response
    }

    if (redirectCount >= MAX_REDIRECTS) {
      return {
        live: false,
        ownerMatched: false,
        loginWall: false,
        reason: "Too many redirects",
        retryable: false,
        errorCategory: "redirect",
      };
    }

    // @ts-expect-error -- res is guaranteed assigned if we reach here
    const finalRes: Response = res;

    // 3. Check HTTP status
    if (finalRes.status === 404) {
      return {
        live: false,
        ownerMatched: false,
        loginWall: false,
        reason: "Page not found (404)",
        httpStatus: 404,
        retryable: false,
      };
    }

    if (finalRes.status === 429) {
      return {
        live: false,
        ownerMatched: false,
        loginWall: false,
        reason: "Rate limited by target site",
        httpStatus: 429,
        retryable: true,
      };
    }

    if (finalRes.status >= 500) {
      return {
        live: false,
        ownerMatched: false,
        loginWall: false,
        reason: `Server error (${finalRes.status})`,
        httpStatus: finalRes.status,
        retryable: true,
      };
    }

    // 4. Read body (limited)
    const contentType = finalRes.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html") || contentType.includes("xhtml");

    let body = "";
    if (isHtml) {
      try {
        // Read limited amount
        const reader = finalRes.body?.getReader();
        if (reader) {
          let totalBytes = 0;
          const chunks: Uint8Array[] = [];
          while (totalBytes < MAX_RESPONSE_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalBytes += value.length;
          }
          reader.cancel().catch(() => {});
          body = new TextDecoder().decode(Buffer.concat(chunks));
        } else {
          body = (await finalRes.text()).slice(0, MAX_RESPONSE_BYTES);
        }
      } catch {
        body = "";
      }
    }

    // 5. Login wall detection
    const isLoginWall = detectLoginWall(body, finalRes.status);
    if (isLoginWall) {
      return {
        live: true,
        ownerMatched: false,
        loginWall: true,
        reason: "Page requires authentication; marked as LIVE_UNVERIFIED",
        httpStatus: finalRes.status,
        retryable: false,
      };
    }

    // Non-success status
    if (!finalRes.ok) {
      return {
        live: false,
        ownerMatched: false,
        loginWall: false,
        reason: `HTTP ${finalRes.status}`,
        httpStatus: finalRes.status,
        retryable: false,
      };
    }

    // 6. Owner name check
    const ownerMatched = ownerName ? checkOwnerName(body, ownerName) : false;

    return {
      live: true,
      ownerMatched,
      loginWall: false,
      reason: ownerMatched
        ? "Link is live and owner name found on page"
        : ownerName
          ? "Link is live but owner name not found on page"
          : "Link is live",
      httpStatus: finalRes.status,
      retryable: false,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes("abort") || msg.includes("timeout") || msg.includes("TimeoutError")) {
      return {
        live: false,
        ownerMatched: false,
        loginWall: false,
        reason: "Request timed out",
        retryable: true,
        errorCategory: "timeout",
      };
    }

    if (msg.includes("CERT") || msg.includes("SSL") || msg.includes("TLS") || msg.includes("certificate")) {
      return {
        live: false,
        ownerMatched: false,
        loginWall: false,
        reason: "TLS certificate error",
        retryable: false,
        errorCategory: "tls",
      };
    }

    return {
      live: false,
      ownerMatched: false,
      loginWall: false,
      reason: "Network error",
      retryable: true,
      errorCategory: "network",
    };
  }
}
