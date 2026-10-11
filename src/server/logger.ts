/**
 * Structured logger. Personal fields are redacted by name, and everything else is scrubbed for personal data
 * in text before the line leaves the process (§13.3 log scrubber, see `scrub.ts`).
 */
import pino from "pino";
import { scrubText, scrubValue } from "./scrub";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.email",
      "*.name",
      "*.rollNumber",
      "*.displayName",
      "*.phone",
      "*.password",
      "*.token",
      "req.headers.cookie",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
  formatters: {
    log: (obj) => scrubValue(obj) as Record<string, unknown>,
  },
  hooks: {
    // pino's own `msg` argument: scrub it too (an error message can carry an email or a link with a roll number).
    logMethod(args, method) {
      const next = args.map((a) => (typeof a === "string" ? scrubText(a) : a)) as typeof args;
      method.apply(this, next);
    },
  },
});
