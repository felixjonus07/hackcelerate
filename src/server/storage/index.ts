/**
 * Object storage (§13.3): uploaded certificates and letters live in a private bucket and are served
 * only through links that expire within minutes. Production uses an S3-compatible bucket (signed with
 * SigV4, server-side encrypted); development falls back to files under `.local-data/uploads` served
 * through a signed, expiring route.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { env, s3Enabled } from "../env";
import type { Policy } from "../policy/schema";
import { presign } from "./sigv4";

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

// ── Upload validation ──────────────────────────────────────────────────────

const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) =>
    b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d,
  "image/png": (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

export type UploadCheck = { ok: true; sha256: string } | { ok: false; reason: string };

/** Size, type and content check; the declared type must match the file's own signature. */
export function validateUpload(
  body: Uint8Array,
  declaredType: string,
  policy: Pick<Policy, "verification">,
): UploadCheck {
  const { max_bytes, allowed_types } = policy.verification.upload;
  if (body.length === 0) return { ok: false, reason: "The file is empty" };
  if (body.length > max_bytes)
    return { ok: false, reason: `The file is larger than ${Math.round(max_bytes / 1_048_576)} MB` };
  if (!allowed_types.includes(declaredType)) return { ok: false, reason: "Only PDF, PNG and JPEG files are accepted" };
  if (!MAGIC[declaredType]?.(body)) return { ok: false, reason: "The file's contents do not match its type" };
  return { ok: true, sha256: createHash("sha256").update(body).digest("hex") };
}

export const objectKey = (studentId: string, id: string) => `students/${studentId}/${id}`;

// ── S3-compatible driver ───────────────────────────────────────────────────

function s3Target(key: string) {
  const endpoint = new URL(env.S3_ENDPOINT || `https://s3.${env.S3_REGION}.amazonaws.com`);
  const pathStyle = env.S3_FORCE_PATH_STYLE || Boolean(env.S3_ENDPOINT);
  return {
    scheme: endpoint.protocol === "http:" ? ("http" as const) : ("https" as const),
    host: pathStyle ? endpoint.host : `${env.S3_BUCKET}.${endpoint.host}`,
    path: pathStyle ? `/${env.S3_BUCKET}/${key}` : `/${key}`,
  };
}

const s3Store: ObjectStore = {
  async put(key, body, contentType) {
    const t = s3Target(key);
    const url = presign({
      method: "PUT",
      ...t,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      expiresSeconds: 60,
      now: new Date(),
      signedHeaders: { "x-amz-server-side-encryption": "AES256", "content-type": contentType },
    });
    const res = await fetch(url, {
      method: "PUT",
      body: Buffer.from(body),
      headers: { "x-amz-server-side-encryption": "AES256", "content-type": contentType },
    });
    if (!res.ok) throw new Error(`Object storage rejected the upload (${res.status})`);
  },
  async signedUrl(key, seconds = 300) {
    return presign({
      method: "GET",
      ...s3Target(key),
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      expiresSeconds: seconds,
      now: new Date(),
    });
  },
  async delete(key) {
    const url = presign({
      method: "DELETE",
      ...s3Target(key),
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      expiresSeconds: 60,
      now: new Date(),
    });
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Object storage rejected the delete (${res.status})`);
  },
};

// ── Local driver (development) ─────────────────────────────────────────────

const ROOT = resolve(process.cwd(), ".local-data", "uploads");
const MAX_LINK_SECONDS = 900;

const sign = (payload: string) =>
  createHmac("sha256", env.BETTER_AUTH_SECRET).update(`file-link:${payload}`).digest("base64url");

/** A link the local file route accepts until `exp`; tamper-proof through an HMAC of the key and expiry. */
export function localToken(key: string, exp: number): string {
  const payload = Buffer.from(JSON.stringify({ k: key, e: exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readLocalToken(token: string, now = Date.now()): { key: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { k, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { k: string; e: number };
    return e > now && typeof k === "string" ? { key: k } : null;
  } catch {
    return null;
  }
}

const safePath = (key: string) => {
  const p = resolve(ROOT, key);
  if (!p.startsWith(`${ROOT}/`)) throw new Error("Invalid storage key");
  return p;
};

export async function readLocalObject(key: string): Promise<Buffer | null> {
  return readFile(safePath(key)).catch(() => null);
}

const localStore: ObjectStore = {
  async put(key, body) {
    const p = safePath(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  },
  async signedUrl(key, seconds = 300) {
    const s = Math.min(seconds, MAX_LINK_SECONDS);
    return `/api/files/${localToken(key, Date.now() + s * 1000)}`;
  },
  async delete(key) {
    await rm(safePath(key), { force: true });
  },
};

export const storage: ObjectStore = s3Enabled ? s3Store : localStore;
export const storageKind: "s3" | "local" = s3Enabled ? "s3" : "local";
