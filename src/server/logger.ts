/**
 * Structured logger. Personal fields are redacted before logs leave the
 * process (§13.3 log scrubber).
 */
import pino from "pino";

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
});
