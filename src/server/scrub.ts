/**
 * Log scrubber (§13.3): application logs exclude personal fields, and a scrubber runs before any log leaves a
 * service. Field names are redacted by the logger's `redact` paths; this removes personal data that appears
 * inside text or values, such as an email in an error message, a roll number in a URL, or a token in a header.
 * Pure and dependency-free so the worker, the server and the tests all use the same rules.
 */
const PATTERNS: [RegExp, string][] = [
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]"],
  [/\b(?:bearer|basic)\s+[a-z0-9._~+/=-]{8,}/gi, "[credential]"],
  [/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi, "[token]"],
  [/\b(?:better-auth|__secure-better-auth)[a-z._-]*=[^;\s]+/gi, "[cookie]"],
  [/\bsk-[a-z0-9_-]{16,}\b/gi, "[key]"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[id-number]"], // 12-digit national ID shapes
  [/\+?\d[\d\s-]{8,}\d/g, "[phone]"],
  [/\b[A-Z]{2,5}\d{4,8}\b/g, "[roll]"],
];

const SENSITIVE_KEYS =
  /^(email|name|displayname|rollnumber|phone|password|token|secret|authorization|cookie|dateofbirth|dob|address)$/i;

export function scrubText(text: string): string {
  return PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text);
}

/** Deep copy with personal values removed; depth-limited so a cyclic or huge object cannot hang the logger. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (value == null || typeof value !== "object" || depth > 6) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value instanceof Error)
    return {
      type: value.name,
      message: scrubText(value.message),
      stack: value.stack ? scrubText(value.stack) : undefined,
    };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.test(k) ? "[redacted]" : scrubValue(v, depth + 1),
    ]),
  );
}
