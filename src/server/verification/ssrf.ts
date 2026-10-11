/**
 * Server-side fetches of student-supplied links (§6.2 portfolio check) must never reach our own
 * network. A link is refused unless it is http(s) on a standard port and every address its host
 * resolves to is public. Redirects are re-checked hop by hop in `http.ts`.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALLOWED_PORTS = new Set(["", "80", "443"]);

function v4Parts(ip: string): number[] | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = v4Parts(ip) as number[];
    const [a, b] = p;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && p[2] === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? lower.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
  }
  return true; // not an address: treat as unsafe
}

export class UnsafeUrlError extends Error {}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Throws `UnsafeUrlError` unless the URL is safe to fetch from the server. */
export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new UnsafeUrlError("Only http and https links are checked");
  if (url.username || url.password) throw new UnsafeUrlError("Links with credentials are not checked");
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError("Only standard web ports are checked");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new UnsafeUrlError("Local addresses are not checked");
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (addresses.length === 0) throw new UnsafeUrlError("The host does not resolve");
  if (addresses.some(isPrivateAddress)) throw new UnsafeUrlError("The link points at a private network address");
  return url;
}
