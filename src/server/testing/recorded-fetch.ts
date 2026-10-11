/**
 * A fetch stand-in that replays recorded HTTP responses (JSON fixtures of real GitHub and Crossref
 * replies, trimmed to the fields the workers read). Records every call so tests can assert on them.
 */
import { readFileSync } from "node:fs";
import type { Fetcher } from "../verification/http";

export interface Recorded {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const loadFixture = (dir: string, name: string): Recorded => JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));

export function recordedFetcher(routes: { match: RegExp; reply: Recorded | ((url: string) => Recorded) }[]) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const route = routes.find((r) => r.match.test(url));
    if (!route) return new Response("no recording for this request", { status: 599 });
    const r = typeof route.reply === "function" ? route.reply(url) : route.reply;
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(r.status === 204 || r.status === 304 ? null : body, { status: r.status, headers: r.headers });
  };
  return { fetcher, calls };
}
