/** HTTP helpers shared by the verification workers. Fetchers are injected so tests replay recorded responses. */
import { assertPublicUrl, type Resolver, UnsafeUrlError } from "./ssrf";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_REDIRECTS = 4;
const MAX_BODY_BYTES = 200_000;

/**
 * Fetch a student-supplied link: every hop is checked against the SSRF rules, redirects are followed
 * by hand, and only a bounded part of the body is read.
 */
export async function safeFetch(
  rawUrl: string,
  opts: { fetcher?: Fetcher; resolver?: Resolver; timeoutMs?: number; readBody?: boolean } = {},
): Promise<{ status: number; finalUrl: string; body: string }> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  let url = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = await assertPublicUrl(url, opts.resolver);
    const res = await fetcher(checked.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      headers: { "User-Agent": "AspirEdge-verification/1.0", Accept: "text/html,application/xhtml+xml" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location") as string, checked).toString();
      continue;
    }
    const body = opts.readBody ? (await res.text()).slice(0, MAX_BODY_BYTES) : "";
    return { status: res.status, finalUrl: checked.toString(), body };
  }
  throw new UnsafeUrlError("Too many redirects");
}
