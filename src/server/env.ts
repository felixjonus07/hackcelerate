/** Validated environment. Import from server code and workers only. */
import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

/** Like `bool`, but an unset or empty value means true. */
const boolDefaultTrue = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === undefined || v === "" || v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3100"),
  DATABASE_URL: z.string().default("postgres://aspiredge:aspiredge@localhost:5434/aspiredge"),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  BETTER_AUTH_SECRET: z.string().min(32).default("dev-only-secret-change-me-0000000000000000"),
  BETTER_AUTH_URL: z.url().default("http://localhost:3100"),
  DEMO_LOGIN_ENABLED: bool,
  /** Demo accounts are refused in production unless this is also set. */
  ALLOW_DEMO_LOGIN_IN_PRODUCTION: bool,
  /** Self-service student sign-up (/sign-up). On unless set to false; false closes registration. */
  SIGNUP_ENABLED: boolDefaultTrue,
  /** New accounts one address may create per hour (brute-force and spam protection). */
  AUTH_SIGNUP_RATE_PER_HOUR: z.coerce.number().int().min(1).default(5),
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
  // Object storage (§13.3): an S3-compatible private bucket. Leave blank in development to use local files.
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().default("ap-south-1"),
  S3_BUCKET: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_FORCE_PATH_STYLE: bool,
  /**
   * Shadow mode (§16.2): the system scores everyone but shows its outputs only to the project team, nothing is
   * dispatched, and mentors keep working as usual so their decisions can be compared with the system's.
   */
  SHADOW_MODE: bool,
  /** Comma-separated emails of the project team, who may see outputs in shadow mode. */
  PROJECT_TEAM_EMAILS: z.string().optional().default(""),
  // Notifications (§10.1). Blank = email goes to .local-data/outbox and WhatsApp is off.
  NOTIFY_EMAIL_WEBHOOK_URL: z.string().optional().default(""),
  WHATSAPP_PHONE_ID: z.string().optional().default(""),
  WHATSAPP_TOKEN: z.string().optional().default(""),
  /** GitHub OAuth app that proves repository ownership (§6.2). Both blank = linking is off. */
  GITHUB_CLIENT_ID: z.string().optional().default(""),
  GITHUB_CLIENT_SECRET: z.string().optional().default(""),
  /** The registrar's nightly ERP export (CSV). Empty = no import is configured (§6.2). */
  ERP_EXPORT_FILE: z.string().optional().default(""),
});

const DEV_SECRET = "dev-only-secret-change-me-0000000000000000";

export const env = schema
  .refine((e) => e.NODE_ENV !== "production" || e.BETTER_AUTH_SECRET !== DEV_SECRET, {
    message: "Set BETTER_AUTH_SECRET in production (openssl rand -base64 32)",
  })
  .parse(process.env);
export const demoLoginEnabled =
  env.DEMO_LOGIN_ENABLED && (env.NODE_ENV !== "production" || env.ALLOW_DEMO_LOGIN_IN_PRODUCTION);
/** Email + password works for demo accounts and for people who signed up themselves. */
export const signUpEnabled = env.SIGNUP_ENABLED;
export const passwordAuthEnabled = demoLoginEnabled || signUpEnabled;
export const isProduction = env.NODE_ENV === "production";
export const oidcEnabled = Boolean(env.OIDC_DISCOVERY_URL && env.OIDC_CLIENT_ID);
export const s3Enabled = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
export const githubOAuthEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
export const llmEnabled = Boolean(env.OPENROUTER_API_KEY);
