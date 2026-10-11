/** Portfolio / live link check (§6.2): live status, then an owner-name match on the public page. */
import type { VerificationStatus } from "../policy/schema";
import { type Fetcher, safeFetch } from "./http";
import { type Resolver, UnsafeUrlError } from "./ssrf";

export interface LinkReport {
  state: "live" | "login_wall" | "dead" | "unsafe" | "error";
  httpStatus?: number;
  ownerMatched: boolean;
  detail?: string;
}

const LOGIN_PATH = /(^|\/)(log-?in|sign-?in|signin|sso|auth|accounts?\/login)(\/|$|\?)/i;

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Both the given and family name must appear on the page. */
export function pageNamesOwner(body: string, displayName: string): boolean {
  const text = fold(body);
  const parts = fold(displayName)
    .split(/\s+/)
    .filter((p) => p.length > 1);
  return parts.length >= 2 && parts.every((p) => text.includes(p));
}

export async function fetchLink(
  url: string,
  student: { displayName?: string },
  opts: { fetcher?: Fetcher; resolver?: Resolver } = {},
): Promise<LinkReport> {
  try {
    const r = await safeFetch(url, { ...opts, readBody: true });
    const path = new URL(r.finalUrl).pathname;
    if ([401, 403, 999].includes(r.status) || LOGIN_PATH.test(path) || /type=["']?password/i.test(r.body))
      return { state: "login_wall", httpStatus: r.status, ownerMatched: false };
    if (r.status >= 500) return { state: "error", httpStatus: r.status, ownerMatched: false };
    if (r.status >= 400) return { state: "dead", httpStatus: r.status, ownerMatched: false };
    return {
      state: "live",
      httpStatus: r.status,
      ownerMatched: Boolean(student.displayName && pageNamesOwner(r.body, student.displayName)),
    };
  } catch (e) {
    if (e instanceof UnsafeUrlError) return { state: "unsafe", ownerMatched: false, detail: e.message };
    return { state: "dead", ownerMatched: false, detail: "The link did not respond" };
  }
}

export function decideLink(r: LinkReport): { status: VerificationStatus; reason: string; retry: boolean } {
  switch (r.state) {
    case "live":
      return r.ownerMatched
        ? { status: "VERIFIED", reason: "The page is live and names you as its owner", retry: false }
        : { status: "LIVE_UNVERIFIED", reason: "The page is live but does not name you as its owner", retry: false };
    case "login_wall":
      return {
        status: "LIVE_UNVERIFIED",
        reason: "The page is behind a sign-in, so its owner cannot be confirmed",
        retry: false,
      };
    case "unsafe":
      return { status: "UNVERIFIED", reason: `The link cannot be checked: ${r.detail}`, retry: false };
    case "error":
      return { status: "UNVERIFIED", reason: "The site returned a server error", retry: true };
    default:
      return { status: "UNVERIFIED", reason: "The link did not respond, or the page was not found", retry: true };
  }
}
