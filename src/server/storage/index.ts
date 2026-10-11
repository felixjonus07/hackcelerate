/**
 * Object storage (§13.3): private S3-compatible bucket, encrypted, served via
 * signed URLs that expire within minutes. Phase 3.
 */
export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export const storage: ObjectStore = {
  async put() {
    throw new Error("Object storage is not configured yet (PLAN.md Phase 3)");
  },
  async signedUrl() {
    throw new Error("Object storage is not configured yet (PLAN.md Phase 3)");
  },
};
