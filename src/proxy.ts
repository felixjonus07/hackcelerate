/**
 * Request gate (Next.js 16 `proxy`; this project never uses `middleware.ts`).
 *
 * Optimistic check only: if there is no session cookie on a protected route,
 * redirect to sign-in. Real authorization (role, assignment, consent) happens
 * in the data access layer on every request — see src/server/auth/session.ts.
 */
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const PROTECTED = ["/student", "/admin", "/leaderboards", "/account"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !hasSession) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  // Never let the browser or a shared proxy keep authenticated pages (back button after sign-out).
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)))
    res.headers.set("Cache-Control", "private, no-store");
  // Security headers (CSP, HSTS, frame/permissions policy) are set for every route in next.config.ts.
  return res;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)"],
};
