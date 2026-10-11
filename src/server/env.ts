/** Validated environment. Import from server code and workers only. */
import { z } from "zod";

const bool = (defaultVal = false) =>
  z
    .enum(["true", "false", "1", "0", ""])
    .optional()
    .transform((v) => (v === undefined || v === "" ? defaultVal : v === "true" || v === "1"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3100"),
  DATABASE_URL: z.string().default("postgres://aspiredge:aspiredge@localhost:5434/aspiredge"),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  BETTER_AUTH_SECRET: z.string().min(1).default("dev-only-secret-change-me-0000000000000000"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3100"),
  DEMO_LOGIN_ENABLED: bool(true),
  /** Demo accounts are refused in production unless this is also set. */
  ALLOW_DEMO_LOGIN_IN_PRODUCTION: bool(true),
  /** Header your reverse proxy sets with the client IP (used for rate limiting). */
  TRUSTED_IP_HEADER: z.string().default("x-forwarded-for"),
  // Session timeouts (§13.2). Idle = no request for this long; max = absolute lifetime.
  SESSION_STAFF_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  SESSION_STAFF_MAX_HOURS: z.coerce.number().int().min(1).default(8),
  SESSION_STUDENT_IDLE_MINUTES: z.coerce.number().int().min(1).default(30),
  SESSION_STUDENT_MAX_HOURS: z.coerce.number().int().min(1).default(12),
  /** "Keep me signed in on this device" (students only): idle and absolute lifetime. */
  SESSION_STUDENT_TRUSTED_DAYS: z.coerce.number().int().min(1).default(30),
  SESSION_WARNING_SECONDS: z.coerce.number().int().min(10).default(120),
  // Brute-force protection.
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).default(15),
  AUTH_SIGNIN_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  OIDC_PROVIDER_ID: z.string().default("institution"),
  OIDC_DISCOVERY_URL: z.string().optional().default(""),
  OIDC_CLIENT_ID: z.string().optional().default(""),
  OIDC_CLIENT_SECRET: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-5.5"),
  OPENROUTER_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.2),
  OPENROUTER_EMBEDDING_MODEL: z.string().default("openai/text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().default(1536),
  GITHUB_TOKEN: z.string().optional().default(""),
  CROSSREF_MAILTO: z.string().optional().default(""),
  POLICY_FILE: z.string().default("policy/2026.10-v1.json"),
  // S3-compatible object storage for evidence uploads (§13.3, Phase 3).
  // All five must be set for S3; otherwise a local filesystem fallback is used.
  S3_ENDPOINT: z.string().optional().default(""),
  S3_BUCKET: z.string().optional().default(""),
  S3_REGION: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
});

const DEV_SECRET = "dev-only-secret-change-me-0000000000000000";

/**
 * Set SKIP_ENV_VALIDATION=1 or detect Next.js build phase to bypass validation
 * during CI/CD builds where runtime env vars are not needed to collect routes.
 * Validation still runs at runtime on the actual server.
 */
const skipValidation =
  process.env.SKIP_ENV_VALIDATION === "1" ||
  process.env.NEXT_PHASE === "phase-production-build" ||
  process.env.npm_lifecycle_event === "build";

function parseEnv(): z.infer<typeof schema> {
  const result = schema.safeParse(process.env);
  if (result.success) {
    if (result.data.NODE_ENV === "production" && result.data.BETTER_AUTH_SECRET === DEV_SECRET && !skipValidation) {
      throw new Error("Set BETTER_AUTH_SECRET in production (openssl rand -base64 32)");
    }
    return result.data;
  }
  if (skipValidation) {
    return schema.parse({});
  }
  return schema
    .refine((e) => e.NODE_ENV !== "production" || e.BETTER_AUTH_SECRET !== DEV_SECRET, {
      message: "Set BETTER_AUTH_SECRET in production (openssl rand -base64 32)",
    })
    .parse(process.env);
}

export const env = parseEnv();

export const demoLoginEnabled =
  !skipValidation && env.DEMO_LOGIN_ENABLED && (env.NODE_ENV !== "production" || env.ALLOW_DEMO_LOGIN_IN_PRODUCTION);
export const isProduction = env.NODE_ENV === "production";
export const oidcEnabled = Boolean(env.OIDC_DISCOVERY_URL && env.OIDC_CLIENT_ID);
export const llmEnabled = Boolean(env.OPENROUTER_API_KEY);
