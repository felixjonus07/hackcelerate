/** Object storage (§13.3): SigV4 against the AWS worked example, upload validation, expiring local links. */
import { describe, expect, it } from "vitest";
import { loadPolicyFile } from "../../policy/file";
import { localToken, readLocalToken, validateUpload } from "..";
import { presign } from "../sigv4";

const policy = loadPolicyFile();

describe("SigV4 presigned URL", () => {
  it("reproduces the example in the AWS documentation exactly", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presign({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresSeconds: 86400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });
  it("signs the headers an upload must send, and the signature changes with them", () => {
    const base = {
      method: "PUT" as const,
      host: "h.example",
      path: "/b/k",
      region: "ap-south-1",
      accessKeyId: "A",
      secretAccessKey: "S",
      expiresSeconds: 60,
      now: new Date("2026-10-11T00:00:00Z"),
    };
    const a = presign({ ...base, signedHeaders: { "x-amz-server-side-encryption": "AES256" } });
    const b = presign({ ...base, signedHeaders: { "x-amz-server-side-encryption": "aws:kms" } });
    expect(a).toContain("X-Amz-SignedHeaders=host%3Bx-amz-server-side-encryption");
    expect(a).not.toBe(b);
  });
});

describe("upload validation", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

  it("accepts a PDF, PNG and JPEG whose bytes match the declared type, and returns a hash", () => {
    for (const [bytes, type] of [
      [pdf, "application/pdf"],
      [png, "image/png"],
      [jpg, "image/jpeg"],
    ] as const) {
      const r = validateUpload(bytes, type, policy);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("rejects a file whose contents do not match its declared type", () => {
    expect(validateUpload(png, "application/pdf", policy)).toMatchObject({ ok: false });
    expect(validateUpload(new TextEncoder().encode("<script>alert(1)</script>"), "image/png", policy)).toMatchObject({
      ok: false,
    });
  });
  it("rejects other types, an empty file and an oversized one", () => {
    expect(validateUpload(pdf, "text/html", policy)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/PDF, PNG and JPEG/),
    });
    expect(validateUpload(new Uint8Array(), "application/pdf", policy)).toMatchObject({ ok: false });
    const big = new Uint8Array(policy.verification.upload.max_bytes + 1);
    big.set(pdf);
    expect(validateUpload(big, "application/pdf", policy)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/larger/),
    });
  });
});

describe("local expiring links", () => {
  const now = 1_800_000_000_000;
  it("accepts a fresh token and returns the key", () => {
    expect(readLocalToken(localToken("students/a/b", now + 60_000), now)).toEqual({ key: "students/a/b" });
  });
  it("rejects an expired, tampered or malformed token", () => {
    expect(readLocalToken(localToken("students/a/b", now - 1), now)).toBeNull();
    const t = localToken("students/a/b", now + 60_000);
    const [payload, sig] = t.split(".");
    const forged = `${Buffer.from(JSON.stringify({ k: "students/other/x", e: now + 60_000 })).toString("base64url")}.${sig}`;
    expect(readLocalToken(forged, now)).toBeNull();
    expect(readLocalToken(`${payload}.${sig.slice(0, -2)}xx`, now)).toBeNull();
    expect(readLocalToken("garbage", now)).toBeNull();
  });
});
