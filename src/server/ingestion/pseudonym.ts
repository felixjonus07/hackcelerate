/**
 * Pseudonymous IDs (§4.1): analytics, staff lists and every model request use an ID that cannot be turned
 * back into a roll number without the secret. It is a keyed hash of the roll number, so the same student gets
 * the same ID on every import, and nobody can compute it without the key.
 */
import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function pseudonymFor(rollNumber: string, secret: string): string {
  if (secret.length < 16) throw new Error("The pseudonym secret must be at least 16 characters");
  const h = createHmac("sha256", secret).update(`pseudonym:${rollNumber.trim().toUpperCase()}`).digest();
  let out = "";
  for (let i = 0; i < 10; i++) out += ALPHABET[h[i] % ALPHABET.length];
  return `P-${out}`;
}
