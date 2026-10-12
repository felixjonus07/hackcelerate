/**
 * AWS Signature Version 4 query-string signing (presigned URLs), enough for an S3-compatible bucket:
 * a short-lived link to GET or PUT one object, with no SDK. Verified against the worked example in
 * the AWS documentation (see tests).
 */
import { createHash, createHmac } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as SigV4 requires (`/` kept only in the path). */
const enc = (s: string, keepSlash = false) =>
  encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? "/" : "%2F");

export interface PresignInput {
  method: "GET" | "PUT" | "DELETE";
  host: string;
  /** Path including the bucket when using path-style addressing, e.g. "/bucket/key". */
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  /** Request time; passed in so the signature is reproducible. */
  now: Date;
  scheme?: "https" | "http";
  /** Extra headers that must be sent with the request and are covered by the signature. */
  signedHeaders?: Record<string, string>;
}

export function presign(i: PresignInput): string {
  const amzDate = i.now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/s3/aws4_request`;
  const headers: Record<string, string> = {
    host: i.host,
    ...Object.fromEntries(Object.entries(i.signedHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
  };
  const names = Object.keys(headers).sort();
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${i.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(i.expiresSeconds),
    "X-Amz-SignedHeaders": names.join(";"),
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join("&");
  const canonical = [
    i.method,
    enc(i.path, true),
    canonicalQuery,
    `${names.map((n) => `${n}:${headers[n]}`).join("\n")}\n`,
    names.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, date), i.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `${i.scheme ?? "https"}://${i.host}${enc(i.path, true)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
