# AspirEdge AI

A multi-track career alignment platform for universities. Each student declares a career track and an aspiration. AspirEdge collects **verified evidence** of execution, scores it against a discipline-specific rubric **in code**, measures the **Aspiration-Execution Gap (AEG)**, and proposes a short action plan. A named mentor approves every intervention before it happens.

> Source blueprint: [`docs/reference/AspirEdge_Deep_Plan.pdf`](docs/reference/AspirEdge_Deep_Plan.pdf) (Deep Platform Plan v2.0). Build plan: [`PLAN.md`](PLAN.md). Agent rules: [`AGENTS.md`](AGENTS.md). Product context: [`PRODUCT.md`](PRODUCT.md). Design system: [`DESIGN.md`](DESIGN.md).

**All data in this repository is synthetic.** No real students, institutions or results.

---

## Tech stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16.4 (App Router, `proxy.ts`, Cache Components, React Compiler), React 19, TypeScript |
| UI | Tailwind CSS v4 with design tokens, Nunito Sans, lucide icons, Recharts, dnd-kit. Designed with the `/impeccable` skill |
| Data | PostgreSQL 17 + pgvector, Drizzle ORM |
| Cache & jobs | Redis 7, BullMQ |
| Auth | Better Auth (demo accounts per role + generic OIDC for the institution's identity provider) |
| AI | OpenRouter (pinned model) behind one adapter, with a schema validator and a rules-only fallback |
| Quality | Biome, Vitest + fast-check, Playwright, Playwright CLI |

## Quick start

Requires Node 22+ and Docker.

```bash
npm install
cp .env.example .env              # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run db:up                     # Postgres :5434 (pgvector) and Redis :6380
npm run db:migrate                # schema + append-only guards
npm run db:seed                   # demo accounts + 60 synthetic students, all evaluated
npm run dev                       # http://localhost:3100
npm run worker                    # (optional, second terminal) BullMQ workers + nightly refresh
```

Without `OPENROUTER_API_KEY`, narratives come from the templated rules-only fallback (§9.4). Every score is still computed.

### Demo accounts

Demo sign-in is **off by default** (`DEMO_LOGIN_ENABLED=false`) and refused in production unless `ALLOW_DEMO_LOGIN_IN_PRODUCTION=true`. To use it locally, set `DEMO_LOGIN_ENABLED=true` and a `DEMO_PASSWORD` of 12+ characters in `.env`, then run `npm run db:seed`. Every demo account uses that password. It is never shipped to the browser: choosing a demo account on the sign-in page only fills in the email.

| Role | Email | Lands on |
| --- | --- | --- |
| Student (ME-27, §20.1) | `student@aspiredge.example` | `/student/passport` |
| Student (CS-44, §20.3) | `student2@aspiredge.example` | `/student/passport` |
| Faculty mentor | `mentor@aspiredge.example` | `/admin/approvals` |
| Class advisor | `advisor@aspiredge.example` | `/admin/approvals` |
| Placement officer | `placement@aspiredge.example` | `/admin/approvals` |
| E-Cell coordinator | `ecell@aspiredge.example` | `/admin/traction` |
| HOD | `hod@aspiredge.example` | `/admin/dashboard` |
| Dean | `dean@aspiredge.example` | `/admin/dashboard` |
| Registrar | `registrar@aspiredge.example` | `/admin/policy` |
| Auditor | `auditor@aspiredge.example` | `/admin/audit-report` |
| Sports officer | `sports@aspiredge.example` | `/leaderboards` |
| Alumni mentor | `alumni@aspiredge.example` | `/leaderboards` |
| Student, not yet onboarded | `student3@aspiredge.example` | `/student/onboarding` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js on port 3100 |
| `npm run worker` | BullMQ workers (evaluation, verification, ingestion, maintenance, embeddings) |
| `npm run check` | Biome lint + TypeScript + Vitest. Must pass before every commit |
| `npm run test` / `test:watch` | Vitest unit, golden and property tests |
| `npm run test:e2e` | Playwright end-to-end tests (`e2e/`) |
| `npm run db:up` / `db:down` | Start or stop Docker services |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and studio |
| `npm run db:seed` | Destructive reseed of demo data |
| `npm run db:reset` | Migrate, then reseed |
| `npm run erp:sample` / `erp:import` | Write a sample ERP CSV from the seeded students / import the registrar's CSV |
| `npm run llm:report` | LLM contract metrics over the golden set and the adversarial suite (§15.2) |
| `npm run bench:nightly` | Nightly batch benchmark: 2,000 students at concurrency 8 (§10.3) |
| `npm run audit:deps` | Dependency audit (high and above) |
| `scripts/checkpoint.sh` | Tag a clean, passing tree as `checkpoint-YYYYMMDD-HHMM` (§19) |
| `k6 run scripts/load/cached-views.js` | p95 < 1 s load test for cached views (needs k6 installed) |

## How it works

```
ERP / GitHub / Crossref / uploads → ingestion → verification (BullMQ)
      → rules engine (pure, src/server/rules) → immutable evaluation
      → LLM narrative (OpenRouter) → validator → consent check
      → approval queue → mentor decision → student
```

- **Rules engine** (`src/server/rules`): normalization (§5.2), six track rubrics (§5.3) with department standards (§5.4), verification multipliers (§5.5), track score and confidence (§5.6), AEG index and personas (§7.2–7.4), trend (§7.5), pivot advisory (§7.6), routing (§8.1). The golden tests reproduce §20 exactly (ME-27 = 48.14; what-if 58.14 / 59.64).
- **Policy file** (`policy/2026.10-v1.json`): every threshold and weight. It is Zod-validated, and weights must sum to 100.
- **LLM layer** (`src/server/llm`): four-layer prompt (Appendix A), sanitized untrusted text, Appendix B schema, a six-step validator (parse → schema → evidence refs → numeric fidelity → forbidden content → tone), one retry, then the templated fallback. Results are cached in Redis by facts, policy and prompt version.
- **Access & audit**: the §13.1 matrix as data (`src/server/consent/matrix.ts`), reason-coded deep-dives, and append-only audit, consent and evaluation tables enforced by Postgres triggers.
- **pgvector**: `remediation_library` and `opportunities` carry embeddings for matching gaps to concrete next steps (`src/server/embeddings`).

### Screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/sign-in` | everyone | Email + password (demo accounts prefill the email), institution SSO when configured, timeout reasons, link to sign-up |
| `/sign-up` | everyone signed out | Student self sign-up: name, email, department, year, password. Creates the account and the student record, signs the student in and opens onboarding. Closed with `SIGNUP_ENABLED=false` |
| `/account/security` | everyone signed in | Session limits, other devices with remote sign-out, password change |
| `/student/passport` | student | Score vs readiness, gap, trend, next step (with its score value), quests, evidence, score breakdown |
| `/student/what-if` | student | Live simulator on the same engine; writes nothing |
| `/student/quests` | student | Accept, defer and submit evidence |
| `/student/consent` | student | Sharing per category × office, leaderboard opt-in, data rights |
| `/student/onboarding` | student | Six-card setup (§12.1): notice, consent choices, baseline check, ambition, evidence, passport |
| `/leaderboards` | everyone signed in | Opted-in students by track, ranked by verified effort |
| `/notices` | everyone signed in | In-app notices and digests |
| `/admin/evidence` | named reviewers | Certificates, letters, internship records and integrity flags waiting for a decision |
| `/admin/attendance` | class advisor | Attendance bands for the advisor's students |
| `/admin/placement` | placement officer | Readiness list, consented fields only |
| `/admin/traction` | E-Cell coordinator | Startup traction for consenting students |
| `/admin/policy` | registrar | Policy versions: draft, approvals, activate |
| `/admin/ingestion` | registrar | ERP import runs and data quality |
| `/admin/requests` | registrar, mentor | Students' access, correction and erasure requests |
| `/admin/users` | registrar | Search and filter accounts, add a staff member, change a staff role, turn an account on or off, sign someone out everywhere. Every change and every directory read is audited |
| `/admin/approvals` | mentor, class advisor, placement | Queue + one-page mentor brief + approve / edit / reject |
| `/admin/dashboard` | mentor, HOD, dean | Command Center aggregates (donut, AEG matrix, trend) |
| `/admin/counseling-kanban` | mentor | Kanban with keyboard and drag moves, WIP limit, reasons for backward moves |
| `/admin/students/[id]` | staff | Deep-dive behind a reason code; every view audited |
| `/admin/audit-report` | dean, HOD, auditor | Printable aggregates with the policy version |

The REST API under `/api/v1` mirrors §11 (see `src/app/api/v1`). `GET /api/health` checks Postgres and Redis.

## Security: sessions and sign-in

| Control | Behaviour | Where |
| --- | --- | --- |
| Session storage | Sessions live in **Redis** (Better Auth secondary storage), with a copy in Postgres for listing and audit. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` + `__Secure-` prefixed in production | `src/server/auth/index.ts`, `storage.ts` |
| Idle timeout | Signed out after 30 min without activity (staff and students on unremembered devices). Enforced **server-side** on every request via a Redis TTL key; idle sessions are revoked | `activity.ts`, `session.ts` |
| Absolute lifetime | Staff 8 h, students 12 h, or 30 days with "Keep me signed in" (students only; staff are never remembered). Activity never extends it | `session-policy.ts` |
| Timeout warning | A dialog counts down for the last 2 min, with **Stay signed in** / **Sign out now**. All tabs stay in sync and sign out together | `src/components/shell/session-guard.tsx` |
| Brute force | Per-IP rate limit (10 sign-ins/min) plus per-account lockout (5 failures → 15 min), also for unknown emails, so accounts can't be enumerated | `lockout.ts`, `index.ts` |
| CSRF / origin | Better Auth origin check against `APP_URL`; cross-origin POSTs get 403 | `trustedOrigins` |
| Sessions UI | `/account/security`: this session's limits, other devices with remote sign-out, "sign out everywhere else", password change (revokes other sessions) | `src/app/account/security` |
| Audit | Sign-in success, failure, lockout, sign-out, idle timeout, revocations and password changes go to `audit_events` (emails stored only as a hash) | `audit_events` |
| Sign-up | There is **no public Better Auth sign-up endpoint** (`disableSignUp`); `/sign-up` is a server action that always creates a `student`, never takes a role from the request, creates the student record in the same step, allows `AUTH_SIGNUP_RATE_PER_HOUR` accounts per address per hour, answers a repeat or reserved email like any other failure, and audits every outcome | `src/server/services/signup.ts` |
| Demo accounts | They all use the reserved `@aspiredge.example` domain. While `DEMO_LOGIN_ENABLED` is off they are refused (and audited) like a wrong password even though password sign-in is on for people who signed up; nobody can sign up on that domain | `src/server/auth/demo.ts`, `index.ts` |
| Turned-off accounts | A registrar can turn an account off: no sign-in (same answer as a wrong password), no new session on any path including institution SSO, and every open session is ended at once. Role changes end sessions too, because Redis caches the role with the session | `src/server/auth/revoke.ts`, `session.ts` |
| Headers | CSP (scripts keep `'unsafe-inline'`: a per-request nonce cannot work with Cache Components, see `next.config.ts`), HSTS (production), `X-Frame-Options: DENY`, `Permissions-Policy`, COOP, no `X-Powered-By`; protected pages `Cache-Control: private, no-store` | `next.config.ts`, `src/proxy.ts` |
| Secrets | App refuses to start in production with the dev `BETTER_AUTH_SECRET` | `src/server/env.ts` |

All limits are env-configurable (`SESSION_*`, `AUTH_*`, `SIGNUP_ENABLED`; see `.env.example`). Behind a reverse proxy, set `TRUSTED_IP_HEADER` to the header the proxy sets, so clients can't spoof their IP to dodge rate limits.

## Reviewing pages with the Playwright CLI

```bash
npx playwright-cli install-browser chromium      # first time only
npx playwright-cli open http://localhost:3100/sign-in
npx playwright-cli snapshot                      # find element refs
npx playwright-cli click <ref>
npx playwright-cli screenshot --full-page --filename .impeccable/review/page.png
npx playwright-cli resize 390 844                # mobile pass
```

## Testing

| Command | What it covers |
| --- | --- |
| `npm run test` | Vitest: golden tests (§20 and the 60-record set), property tests, policy lifecycle, services against a throwaway `aspiredge_test` database, the language linter |
| `npm run test:e2e` | Playwright, with the app on port 3100 and `DEMO_PASSWORD` set in `.env`: smoke and security, the five journeys, the authorization matrix (11 roles × every `/api/v1` endpoint) and axe-core accessibility on 19 screens. The `mobile` project (Pixel 7) repeats everything except the authorization matrix |

The journeys change data (onboarding completes, a quest is accepted, a proposal is approved), so `e2e/global-setup.ts` **reseeds the demo data at the start of every run**. It only does so on a local database and only when the suite starts its own app; set `E2E_NO_RESEED=1` to skip it. Journeys tagged `@stateful` run on the desktop project only.

## Deployment (Railway)

The app runs in the Railway project **aspiredge-ai**, environment **production**, at <https://aspiredge.up.railway.app>. Five services, all in Railway's Southeast Asia (Singapore) region:

| Service | What it is | Notes |
| --- | --- | --- |
| `web` | Next.js app (`npm run build`, `npm run start`) | Domain `aspiredge.up.railway.app` → port 3100 (`PORT=3100`, matching the `start` script). Health check `/api/health`. Pre-deploy command `npm run db:migrate` applies the Drizzle migrations before a new version takes traffic |
| `worker` | BullMQ workers and the nightly refresh | Start command `npx tsx src/workers/index.ts`. Not `npm run worker`, whose `--env-file=.env` fails where no `.env` file exists. No public domain |
| `Postgres` | `pgvector/pgvector:pg17` (the image `docker-compose.yml` uses) | Railway's stock Postgres has no pgvector and migration `0000` runs `CREATE EXTENSION vector`. Volume at `/var/lib/postgresql/data`, `PGDATA` in a subfolder (a fresh volume has `lost+found`). Reached over the private network only |
| `Redis` | Railway Redis | Sessions (Better Auth secondary storage), cache and BullMQ queues |

Variables are set on the services, never committed (`.env*` stays gitignored):

- `DATABASE_URL` is built from the `Postgres` service's private domain and password, `REDIS_URL` references `Redis`, so they follow the services if they are rebuilt. The `worker` reads the shared values from `web` by reference.
- `APP_URL` and `BETTER_AUTH_URL` are `https://aspiredge.up.railway.app`. `BETTER_AUTH_SECRET` is generated for Railway and is not the local one.
- `TRUSTED_IP_HEADER=x-real-ip`, the header Railway's edge documents for the client IP (rate limiting and lockout key on it).
- `NODE_ENV` is not set by hand: Railpack sets it to `production` at runtime and installs dev dependencies for the build (the build needs Tailwind, TypeScript and the React Compiler, the worker needs `tsx`).
- **Demo sign-in switch.** `DEMO_LOGIN_ENABLED` on `web` is the on/off switch: `true` lists the demo accounts on the sign-in page and allows their password sign-in, `false` (or unset) hides and refuses it. `ALLOW_DEMO_LOGIN_IN_PRODUCTION=true` is the standing production opt-in the app requires, and `DEMO_PASSWORD` (12+ characters, stored only as a Railway variable on `web`) is the shared password. Flip it with `railway variable set DEMO_LOGIN_ENABLED=false --service web`; the change restarts `web`. The accounts exist only after `scripts/seed.ts` has run against the database. It truncates the app tables, so it is run deliberately and never on deploy. It was run once (2026-10-12) through a temporary Railway service built from GitHub `main` (start command `npx tsx scripts/seed.ts`, restart policy never, variables referencing `web`) and that service was deleted afterwards. To reseed, repeat that, and delete the service when it finishes: while it is connected to `main`, every push would rerun the truncating seed.
- Optional integrations (`OPENROUTER_API_KEY`, `OIDC_*`, `GITHUB_*`, `S3_*`, `NOTIFY_EMAIL_WEBHOOK_URL`, …) are blank until set with `railway variable set <KEY> --service web` (and `--service worker` for the ones the worker uses). Without a model key, narratives use the rules-only fallback.

**Deploys come from GitHub only.** `web` and `worker` are connected to `felixjonus07/hackcelerate`, branch `main`; every push to `main` builds and deploys both. Never upload local code with `railway up`. Connect a service with `railway service source connect --repo felixjonus07/hackcelerate --branch main --service <name>`. A fix reaches production only after it is merged to `main`. The `web` pre-deploy step migrates the database first, and a failed health check keeps the previous version serving.

**Data residency:** the default in `docs/decisions.md` (item 5) is an India-region cloud. Railway has no India region, so the pilot runs in Singapore. Record the IT head's decision before real student data is loaded; only synthetic data is in this deployment.

## Environment variables

See [`.env.example`](.env.example). Key ones: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `DEMO_LOGIN_ENABLED`, `OIDC_*` (institution SSO), `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` (verify the slug before use), `OPENROUTER_EMBEDDING_MODEL`, `GITHUB_TOKEN`, `POLICY_FILE`, `S3_*` (private bucket for uploads; blank keeps them in `.local-data/uploads`), `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (proves GitHub account ownership), `SHADOW_MODE` / `PROJECT_TEAM_EMAILS`, `NOTIFY_EMAIL_WEBHOOK_URL`, `WHATSAPP_*`, `ERP_EXPORT_FILE`.

## Project status

Phases 0–11 are built. What remains is work only a person can do: the model provider's data-retention terms in writing, the compliance review of the DPDP mapping, a penetration test, the manual screen-reader pass, the mentor usefulness rating, the backup recording and slides, and the open decision about the nonce-based CSP. See [`PLAN.md`](PLAN.md) for the phase list and which boxes are open, and [`docs/decisions.md`](docs/decisions.md) for owners. Open product decisions (§21) run on the documented defaults until the institution records them.

Other docs: [`docs/dpdp-mapping.md`](docs/dpdp-mapping.md) (obligation → code → test), [`docs/demo-script.md`](docs/demo-script.md) (7-minute script, backup-recording notes, slides outline).

---

## Changelog

### 2026-10-11: Phase 0 scaffold
- Created the Next.js 16.4 app (TypeScript, Tailwind v4, React Compiler, Cache Components, Biome) and the folder structure locked in `AGENTS.md`.
- Added `src/proxy.ts` (optimistic session gate; no `middleware.ts`) with security headers.
- Added Docker Compose (Postgres 17 + pgvector on 5434, Redis 7 on 6380), Drizzle schema for every §4.1 entity plus Better Auth tables, and migrations `0000_init`, `0001_append_only_guards` (triggers) and `0002_student_signals`.
- Added the versioned policy file `policy/2026.10-v1.json` and its Zod schema (§3.1).
- Implemented the pure rules engine: all six rubrics (Corporate Placement fully specified), AEG, personas, trend, pivot, routing and integrity checks. 42 Vitest tests, including §20 golden values, Appendix D personas, fast-check properties and Appendix C adversarial validator cases.
- Implemented the LLM layer for OpenRouter (prompt layers, sanitizer, adapter, validator, templated fallback, Redis cache).
- Added services (facts loader, evaluations, approvals, consent, cohort, counseling, passport, deep-dive, audit report), BullMQ queues and a worker process with a nightly scheduler, verification (GitHub, link, lifecycle), pgvector embeddings, and placeholder modules for notifications and storage.
- Added Better Auth with seeded demo accounts per role and a generic OIDC slot; DAL authorization with `forbidden()` / `unauthorized()`.
- Built the base UI with `/impeccable` (Warm Consumer App direction, chosen by the user): app shell, student passport, what-if, quests, consent center, onboarding, approvals and mentor brief, Command Center, counseling Kanban, deep-dive, audit report, leaderboards, and error pages. Reviewed with the Playwright CLI at 1440 and 390 px.
- Added 21 `/api/v1` route handlers and `/api/health`.
- Added the seed script (10 accounts, 60 synthetic students, remediation library, opportunities), `AGENTS.md`, `CLAUDE.md`, `PLAN.md`, `PRODUCT.md`, `DESIGN.md`, and the impeccable skill with its agents under `.claude/`.
- Run: `npm install && npm run db:up && npm run db:migrate && npm run db:seed`.

### 2026-10-11: Session security and sign-in hardening
- Sessions are stored in Redis (Better Auth secondary storage) with a Postgres copy; new `session.trusted` column (migration `0003_session_trusted`).
- Role-based timeouts: server-enforced idle timeout (Redis TTL, revokes idle sessions), absolute lifetime with no sliding refresh, and "Keep me signed in" for students only.
- Client timeout warning dialog with a countdown, "Stay signed in" heartbeat (`POST /api/session/heartbeat`) and cross-tab sign-out.
- Brute-force protection: per-IP rate limit plus per-account lockout. Audit events for every auth outcome.
- Removed the hardcoded demo password from the client bundle. Demo login is now off by default and blocked in production; `DEMO_PASSWORD` comes from `.env` and the seed refuses to run without it.
- Added the `/account/security` page (sessions, remote sign-out, password change) and account/sign-out actions in the mobile header.
- Sign-in page: shows timeout/sign-out reasons, recognises an existing session, and never reveals whether an account exists.
- Security headers (CSP, HSTS, frame/permissions policy) in `next.config.ts`; `no-store` on protected pages.
- Tests: 7 new unit tests (session policy, lockout key) and 8 new e2e security journeys. 49 unit and 26 e2e tests pass (desktop + mobile).
- Run: `npm run db:migrate`, set `DEMO_PASSWORD` (and `DEMO_LOGIN_ENABLED=true` for local demos) in `.env`, then `npm run db:seed`.

### 2026-10-11: impeccable finish review fixes
- Mobile: the score breakdown and consent center become stacked lists below `md`/`sm`; the shell's main column gets `min-w-0`, which fixes horizontal overflow at 390 px.
- Counseling board: all six columns fit at ≥1280 px (`xl` grid); compact cards; stable dnd-kit id (fixes a hydration warning).
- Command Center: the gap index is a single table and the trend a segmented bar; chart series are tokens (`--series-1…7`, `--mark`) in `globals.css`.
- What-if: sticky score strip on phones so the readiness bar's glide stays visible.
- Saffron restricted to actions (readiness tick is now ink with a label); eyebrow labels removed; citation chips enlarged.
- Added `playwright.config.ts` and `e2e/smoke.spec.ts` (5 journeys, all passing).

### 2026-10-11: Phase 0–1 — CI, policy lifecycle, data quality, ERP import
- **CI** (`.github/workflows/ci.yml`, PLAN Phase 0): `npm ci`, `npm run check` and `npm run build` on every push and pull request, with Postgres (pgvector) and Redis services so the database tests really run (`REQUIRE_DB=1` turns a missing database into a failure, not a skip).
- **Policy versions** (§3.3, PLAN Phase 1): `src/server/policy/lifecycle.ts` holds the rules as pure functions: DRAFT → ACTIVE → RETIRED; a change to persona triggers, floors or precedence needs **two approvals from different offices** (registrar and dean), anything else one; a version cannot start inside a period already reported to the auditors (the last `audit_report.export`); of several ACTIVE versions the latest effective date in force wins. `services/policy-admin.ts` applies them in one transaction and writes the audit trail; `rolloverPolicies` retires superseded versions once a future-dated one starts. The two routes under `/api/v1/admin/policy/versions` now use it, and a read-only `GET` lists versions (registrar, dean, HOD, auditor).
- **Policy loader** (`policy/load.ts`, now async): the ACTIVE row of `policy_versions` that is in force, Zod-validated, else the file named by `POLICY_FILE` (also if the database is unreachable); cached for 30 s and invalidated on activation. File-only access is in `policy/file.ts`. `getActivePolicy()` callers now `await` it.
- **New policy sections** in `policy/2026.10-v1.json`: `calendar` (weekends, holidays, UTC offset, term), `data_quality` (§4.3 limits) and `ingestion` (ERP header aliases). The schema also rejects a persona missing from the precedence list, overlapping AEG bands, and a condonation floor above the requirement. The calendar holidays are a **synthetic demo calendar**; the registrar replaces them.
- **Data-quality rules** (§4.3, `ingestion/quality.ts`): one pure function per row of the table (CGPA range, attendance week and missing-week confidence caps, mock score range, artifact URL scheme and 14-day reachability, roll number format, date of birth and the under-18 flag), each tested at its boundaries. The facts loader applies them: an invalid CGPA is excluded with a named data gap, invalid attendance weeks are dropped, flagged mocks are not scored, and more than two missing weeks cap confidence at MEDIUM (LOW above four).
- **ERP import** (§6.2): `ingestion/csv.ts` and `ingestion/erp.ts` parse and validate the nightly CSV through the header mapping in the policy (unmapped columns are never read); `services/erp-import.ts` applies it: SHA-256 checksum against the previous night (`UNCHANGED` when identical), bad roll numbers rejected and logged line by line, invalid weeks excluded, weeks upserted, current-term attendance recomputed, **missing file or wrong shape marks the baseline stale** while previous values stay, every run recorded in `ingestion_runs` and audited. The nightly worker runs it when `ERP_EXPORT_FILE` is set. `npm run erp:sample` writes a sample export from the seeded students (with malformed rows); `npm run erp:import -- <file>` imports one by hand.
- **Working-day SLAs** (PLAN Phase 4): `rules/calendar.ts` adds weekends, the holiday calendar and the institution's UTC offset to SLA due dates (`addWorkingDays`, `workingDaysBetween`), replacing the weekend-only helper. The approval queue shows working days left from it.
- **Re-evaluation on policy change** (§3.3, PLAN Phase 4): activating a version queues one evaluation per student whose latest evaluation used another version (idempotent job ids) and records an audit event; existing evaluations are never rewritten.
- **pgvector matching** (`embeddings/`): the catalog embedder fills `remediation_library` and `opportunities` (the seed does it when `OPENROUTER_API_KEY` is set and otherwise says it skipped). Quest selection is rules first (costliest gap, an item the student lacks), then cosine distance; each quest links the nearest verified, still-open opportunity. Without a key the rule order alone applies. Tests use a deterministic fake embedder against real pgvector.
- **Schema** (migration `0004_phase1_data_layer`): `students.credits_held`, `erp_imported_at`, `erp_stale`; `mock_attempts.max_score`, `quality_flag`, `raw_answers`; a unique key on `attendance_weeks (student, course, week)`; typed counters and `file_name` on `ingestion_runs`; `requires_two_approvals`, `changed_sections`, `supersedes`, `retired_at` on `policy_versions`. The §4.1 review found every entity present; evaluations were already immutable through a trigger (`0001`), now also covered by a test.
- **Tests**: a throwaway `aspiredge_test` database (created and migrated by the Vitest global setup) so integration tests never touch the demo data. Policy lifecycle, calendar, data quality, ERP parsing and import, policy administration, re-evaluation, append-only guards and pgvector ranking are covered.
- **Seed**: synthetic birth dates and credits for all 60 students (7 departments, all flagged synthetic), the policy version, and an ingestion history row. New env var `ERP_EXPORT_FILE`. Run: `npm run db:migrate && npm run db:seed`.

### 2026-10-11: Phase 2 — all six track rubrics, gates, property tests
- **Rubrics** (`src/server/rules/rubrics`, §5.3.2–5.3.6): Higher Studies (entrance practice at the lowest verification multiplier of the sources used, speed score as a sub-measure, SOP reviews, application-timeline adherence), Entrepreneurship (traction and build evidence, customer interviews × the mentor's quality rating, venture milestones on time), Public Service (current-affairs days × weekly-test accuracy, GS mocks, speed by difficulty band, streak from complete mocks, answer writing), Freelance (portfolio, client work, certifications, deployments scaled by uptime, open source) and Sports, Defense and NCC (fitness from the strongest signed record, camp days, competition points by level, psychometric ratings). Each is tested against a hand-worked example in `rules/__tests__/rubrics.test.ts`.
- **Gates**: `checkGate` / `gateReason`; a failed gate adds no points, sets `Evaluation.scoreShown = false`, and the passport must read "Not enough evidence yet". The sports gate now reads `students.credits_held` against `min_credits`. **BMI exists only as a band** (`in_range`, `borderline`, `out_of_range`) in the data, the calculation text and the output, and a test fails if a number appears.
- **No clock in the engine**: date-dependent rubrics read `facts.asOf` and throw without it. Streak days, gap days, milestones and current-affairs days are computed from the mocks, milestones and activity events in the facts. The `precomputed` and stored streak fields are gone.
- **Typed track parameters** (`policy/schema.ts` `TRACK_PARAMS`): every number a rubric uses is in `policy/*.json` and validated when the policy loads, plus a machine-readable `provisional` list of values the plan does not specify (required evidence weights per component, Cooper bands, BMI band scores, minimum credits, `cohort.artifact_score_full_weight`, the LOW missing-weeks limit). **These are proposed defaults I introduced; the institution must confirm them (§21).**
- **Data** (migration `0005_phase2_rubric_data`): `milestones`, `activity_events` (timestamps only, no content) and `mock_attempts.difficulty`. The facts loader derives months to deadline, verified projects, 60-day activity and recent source failures from the base tables; `services/signals.ts` refreshes the verified artifact score and the department 75th percentile before each evaluation (the seed pins the plan's worked examples).
- **Engine version** is now `0.2.0` and is stored on every evaluation (`evaluations.engine_version`); a test checks it.
- **Property tests** (`rules/__tests__/properties.test.ts`): for each of the six tracks, 10,000 generated cases check that scores stay within 0–100 with no NaN and that adding verified evidence never lowers a score; evaluation is deterministic and the gap ratio stays within 0–1. Ratio-style records (camp days attended over required) can fall when a worse record is added, by design, and are outside the additive property.
- **Golden tests** (PLAN Phase 4): EE-12's fixture now reproduces the plan's track score of 52 (52.05), CS-44's slope is exactly −3, and each Appendix D record has its persona and index asserted; precedence queues lower routes behind the primary.
- **Seed**: `scripts/seed-data.ts` generates the 60 synthetic students across all six tracks with real base data (mocks, milestones, activity, fitness records, camp days, medals, deployments). Run `npm run db:migrate && npm run db:seed`.

### 2026-10-12: Phase 3 — evidence verification layer
- **Lifecycle** (`verification/lifecycle.ts`, `apply.ts`, §6.1): the allowed-transition table is checked exhaustively (every from/to pair in a test) and by actor: only the system sets VERIFIED, only a named reviewer sets ATTESTED, a student only submits. Every transition is written to `artifact_status_events` and to the audit log with the actor and the reason (new `audit_events.reason` column, migration `0006`). Re-checks follow the plan: one failure makes an item STALE, a second UNVERIFIED, a pass restores it; an attestation lapses to STALE after `verification.attested_review_days`.
- **Checkers** with injected HTTP and recorded fixtures (real GitHub and Crossref replies, trimmed): GitHub (owner, creation date, commit authorship by the student's OAuth-linked login, forks count only with `fork_min_own_commits` own commits, private repositories are not readable, re-check every 30 days), Crossref (author match across accents; a close or different name is a *variant* sent to a mentor, not a verdict), and portfolio links (live status, owner name on the page, login walls become LIVE_UNVERIFIED, unreachable links are retried for 14 days then UNVERIFIED). API outages never decide anything.
- **SSRF guard** (`verification/ssrf.ts`): a student-supplied link is fetched only if it is http(s) on a standard port and every address it resolves to is public; each redirect hop is re-checked.
- **GitHub account linking**: `GET /api/github/link` and `/api/github/callback` run the OAuth flow that proves a student owns their GitHub login (state tied to the signed-in student, one login per student). It is off until `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set; it was not run against GitHub here.
- **Reviewer flows** (`verification/review.ts`): assigned reviewers of the named role attest or reject uploaded evidence with a reason, the placement cell confirms internship hours, sampled external score reports are matched or rejected (a mismatch notifies the mentor), and integrity flags are resolved with a stated reason (both students are told the text was reviewed, not accused).
- **Integrity checks** (§6.3): duplicate claims (normalised repository, DOI, certificate id or file hash), reused text (hash of the normalised description), burst commits, implausible speed. They only raise `integrity_flags` (deduplicated); a flag never changes a score or status. Streak padding earns no credit and no flag.
- **External score reports** are sampled each term (`external_mock_sample_rate`, chosen by hashing the report id with the term, so a rerun picks the same ones).
- **Object storage** (`src/server/storage`, §13.3): uploads are checked for size, type and matching file signature, stored under `students/<id>/<uuid>` and served through links that expire within `signed_url_max_seconds`. With `S3_*` set it uses an S3-compatible bucket (SigV4 signing written here and checked against the AWS documentation's worked example; server-side encryption requested); without, development files live in `.local-data/uploads` behind an HMAC-signed expiring route. No new dependency.
- **Evidence submission** (`services/evidence.ts`) is one path for links and files, driven by the new `evidence_types` catalog in the policy (how each kind is submitted, who confirms it, its weight). `POST /api/v1/quests/{id}/evidence` accepts JSON or multipart; `GET /api/v1/evidence/{id}/file` returns an expiring link after an access check that is audited.
- **Scheduler** (`services/maintenance.ts`, worker): daily re-check queue, attestation expiry, policy rollover, monthly sampling, and a signals/integrity refresh before each nightly evaluation. New `notifications` outbox table (migration `0007`) and `notify()`.
- **Schema** (`0006_phase3_verification`): claim key, text hash, next/last check and attestation time on `artifacts`; sampling fields on `mock_attempts`; a dedupe key on `integrity_flags`; `students.github_login`. New env vars `S3_*`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (see `.env.example`). 202 tests in `src/server/verification` and `src/server/storage` cover the above, with no network calls.

### 2026-10-12: Phase 5 — adversarial suite and contract metrics
- **Adversarial suite** (PLAN Phase 5, §9.2, §15.2): 30 recorded model outputs (all 8 of Appendix C plus 22 more: delimiter break-out, zero-width/Cyrillic/accent/leetspeak obfuscation, Markdown-fenced and chatty output, smuggled JSON fields, tool calls, system-prompt leaks, contact details and roll numbers in student text, persona names, gender/region/health inference, text in another script, fake evidence ids, HTML-comment instructions, a flood of repeated instructions, route and score overrides) replayed through the real prompt builder, validator, retry and fallback by `llm/adversarial.ts` and `llm/__tests__/adversarial.test.ts`. Every case must leave the engine's numbers, flags and routes untouched, keep the system layer byte-identical, and put no forbidden content in front of a student.
- **Gaps the suite found, now closed**: the validator checks a canonical form of each sentence (accents, zero-width characters, look-alike letters and character swaps folded away); it removes sentences that claim a status the cited evidence does not have (only the link check decides "verified"), echo contact details or roll numbers, repeat the system prompt, announce a dispatch or escalation, name a protected group or a health condition, or are written in another script. The sanitizer neutralises the facts-block fence markers, drops HTML comments and control characters, and redacts emails, phone numbers and roll numbers from student text before the model sees it.
- **Pipeline** (`llm/narrative.ts`): dependencies are injectable (model, cache, enabled flag) and each result reports `attempts`, `firstAttemptOk` and `truncations`.
- **Contract metrics** (§15.2, `llm/metrics.ts`, `npm run llm:report`): first-attempt schema pass, final validity, evidence coverage, numeric fidelity, forbidden content, injection resistance (≥ 20 cases) and tone, each against its threshold, with a non-zero exit code on a failure. It runs the live model when `OPENROUTER_API_KEY` is set; without a key it replays the rules-only narrative as the model's output, which checks the pipeline but not a model, and says so. Mentor usefulness needs three mentors rating 50 outputs and is reported as not measurable.
- **Language standards** (§14.3) now live in one list, `src/lib/language.ts`, used by the prompt, the tone measure and (Phase 10) the linter test.
- **Not done, needs a person**: confirming the model provider's data-retention and training terms in writing (owner: engineering lead).

### 2026-10-12: Phase 6 — dispatch, SLAs, quests, mentor brief
- **Consent at dispatch** (PLAN Phase 6, §8.1, §13.1): `consent/dispatch.ts` (pure) and `services/dispatch.ts`. An approved intervention reaches a placement, E-Cell or sports officer only if the student has shared every category the route carries with that office; the mentor and class advisor assigned to the student need no consent. When consent is missing the dispatch is blocked and explained to the approver, nothing is sent, and it goes out by itself if the student later shares what the route carries. Migration `0008_phase6_dispatch_quests.sql` adds `interventions.dispatched_at` and lets `counseling_card_moves` record system moves (`actor_kind`).
- **SLA tracking and escalation** (§8.1): `rules/sla.ts` decides, on the institution's working-day calendar, when a route has waited past `escalate_after_working_days`; `services/escalation.ts` is the job that tells the next role. Escalation never decides for anyone, and roles without individual access (dean, HOD, registrar) receive a count, not a student.
- **Kanban rules** (§8.2): a backward move needs a reason, a card with no activity for 14 days gets an amber marker, and an expired quest moves the card to Follow-up due.
- **Quest lifecycle** (§8.3): `rules/quest.ts` and `services/quests.ts`. Proposed → Accepted → Active → Evidence submitted → Done / Expired. A quest completes only through evidence of the type it names that actually counts; expiry sends the mentor a follow-up and lowers no score. The student can accept, edit the target date within the policy range, or defer. Quests are chosen from the remediation library (`services/remediation.ts`).
- **Mentor brief** (§12.2): `services/brief.ts` builds three facts, the data gaps, two suggested questions and the pivot options from the rules output by fixed rules (no model), and every fact links to the field it came from. The same evaluation always gives the same brief.
- **Run**: `npm run db:migrate`.

### 2026-10-12: Phase 7 — student experience
- **Onboarding end to end** (§12.1): `services/onboarding.ts` remembers the notice acknowledgement and the card the student is on, and lets them finish only once the notice is acknowledged and an ambition is saved. Cards: notice, consent choices, baseline check with a correction request, ambition (track, target outcome, date, readiness), first evidence, passport and quests. Migration `0009_phase7_student_experience.sql` adds `notice_acknowledgements`, `notification_preferences`, `wellbeing_nudges`, the onboarding step and `onboarded_at` on `students`, and routing, plan and resolution columns on `rights_requests`.
- **Rights requests** (§13.7): `services/rights.ts`. Access produces a download of the student's own data (`GET /api/v1/students/me/export`), a correction goes to the registrar (ERP data) or the mentor of record (a narrative), and an erasure is checked against the retention schedule and the outcome explained in writing. The registrar resolves them in `/admin/requests`.
- **Wellbeing nudges** (§14.2): `rules/wellbeing.ts` and `services/wellbeing.ts`. Three behavioural patterns only, no free text, no diagnosis. A hit becomes a recovery nudge for the student (with campus counseling and emergency contacts in the passport footer) and a soft note to the mentor; it never produces a persona, a label or an intervention.
- **Leaderboards** (§12.1): `services/leaderboard.ts`. Off by default, opted-in students only, tabs per track, ranked by verified effort (evidence that counts and the practice streak), never by score or gap. Students appear under their pseudonymous ID with verified public links as chips.
- **Run**: `npm run db:migrate`.

### 2026-10-12: Phase 8 — staff experience and notifications
- **Staff views** (§12.2): `services/staff-views.ts` for the class advisor's attendance view, the placement officer's readiness list (consented fields only) and the E-Cell traction view. They show only what the access matrix and the student's consent allow, never export an individual list (§14.4), and audit every student whose record is read.
- **Reviewer queue** (§6.1, §6.2): `services/review-queue.ts`. Uploaded certificates and internship letters, sampled external score reports and open integrity flags for the students assigned to a named reviewer; a decision moves an artifact to `ATTESTED` or rejects it. Students are shown by pseudonym; the read is audited.
- **Registrar tools** (§3.3): policy editor (draft → approvals → activate, two approvals for persona changes) and ingestion status, backed by `services/policy-admin.ts` and the existing lifecycle rules.
- **Audit report** (§12.3): printable, shows the policy version and a draft warning, aggregates plus sampled records, and writes the reasons for each sampled read.
- **Notifications** (§10.1): `notifications/{templates,digest,transport}.ts`. In-app notices, weekly digests (informational; the class advisor's watch-band summary needs no approval), and WhatsApp template messages only for people who opted in. Email goes to `.local-data/outbox` in development or to a webhook relay. Student templates follow the language standards. Migration `0007_notifications_outbox.sql`.
- **Env**: `NOTIFY_EMAIL_WEBHOOK_URL`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TOKEN` (all optional; blank means off).

### 2026-10-12: Phase 9 — security, privacy and DPDP
- **Authorization matrix** (§15.1 "zero failures"): `server/api/access.ts` lists who may call each `/api/v1` endpoint, read by both the route handlers and the tests. `e2e/authorization.spec.ts` signs in as all 11 roles and calls every endpoint: signed-out gets 401, an allowed role is never refused by the role check, and every other role gets 403 (a role denial is told apart from a record denial by the response body).
- **Audit events** (§13.6): every read of personal data, approval, policy change and export writes an event with actor, role, purpose and reason; `audit_events` stays append-only by trigger. Migration `0010_phase9_privacy.sql` adds `audit_events_archive` (the seven-year archive), `parental_consents`, `demographic_profiles` (consent-only, for fairness checks) and `cohort_aggregates`.
- **Pseudonymous IDs** (§4.1, §9.4): `ingestion/pseudonym.ts` is a keyed hash of the roll number, used in analytics, staff lists and every model request. Migration `0011_restricted_analytics_role.sql` adds an `aspiredge_analytics` role that can read everything except `student_identities` (roll numbers and names); it cannot log in until a deployment gives it a password.
- **Log scrubber** (§13.3): `server/scrub.ts` removes emails, roll numbers and tokens from log text, on top of the logger's redact paths.
- **Retention and erasure** (§13.5, §13.7): `rules/retention.ts` (pure) and `services/retention.ts`. Append-only rows can be removed only inside a transaction that sets `aspiredge.allow_erasure`, which the triggers look for; every run is audited with counts and has a dry-run mode.
- **Parental consent** (§4.3, §13.4): `services/parental.ts`. For a student under the policy's age of majority nothing is processed (no evaluation, no dispatch) until a registrar records verifiable consent.
- **Grievance officer** on every signed-in screen (`components/shell/shell-footer.tsx`).
- **CI and scanning**: `.github/workflows/ci.yml` (check + build) and `security.yml` (dependency audit, CodeQL, OWASP ZAP baseline). `npm run audit:deps`.
- **Finding, not done: nonce-based CSP.** A per-request nonce cannot be applied while Cache Components serves cached static shells, so scripts keep `'unsafe-inline'`. The experiment was reverted and the reason is written next to the headers in `next.config.ts`. PLAN.md leaves it unticked; the decision to drop it or change the rendering model is the user's (see `docs/decisions.md`).
- **Not done, needs a person**: compliance review of the DPDP mapping (`docs/dpdp-mapping.md`), penetration test.
- **Run**: `npm run db:migrate`.

### 2026-10-12: Phase 10 — fairness, golden set, language, accessibility, load
- **Fairness protocol** (§14.1): `rules/fairness.ts` (pure statistics) and `services/fairness.ts`. Flag rate by group for each persona, the ratio to the reference group (band 0.8–1.25) and score distribution per rubric component; groups under 20 students are never reported, and a ratio outside the band only asks the governance committee to look. Demographic fields are consent-only, held in a separate table and never read by the rules engine (a test enforces it).
- **Golden evaluation set** (§15.3): `rules/golden-set.ts` has 60 synthetic records with the persona and band their designer intended, written from the plan's rules rather than copied from the engine. Also `rules/agreement.ts` for system–mentor agreement with Wilson intervals (§15.4).
- **LLM acceptance report** (§15.2): `npm run llm:report` over the golden set and the adversarial suite.
- **Language standards linter** (§14.3): `src/lib/__tests__/language.test.ts` scans student-facing sources and label sets for the discouraged phrases and persona names.
- **Accessibility**: `e2e/accessibility.spec.ts` runs axe-core (WCAG 2.1 A/AA) on 19 screens. New dev dependency `@axe-core/playwright`. It found two issues, both fixed: fact links in the mentor brief used the resting saffron on sand at 4.3:1 and now use the existing `act-hover` token (5.4:1); and the track donut chart put a focusable element inside an `aria-hidden` wrapper (`rootTabIndex={-1}` and no accessibility layer).
- **Load**: `scripts/load/cached-views.js` (k6, 50 virtual users, p95 < 1 s for the passport and leaderboard) and `npm run bench:nightly` (2,000 synthetic students at concurrency 8 through the rules engine and templated narrative; 0.2 s against a two-hour budget). The benchmark covers the compute-bound part only; database write throughput is not benchmarked. **The k6 script has not been run** (k6 is not installed here).
- **Not done, needs a person**: manual screen-reader pass; mentor usefulness rating.

### 2026-10-12: Phase 11 — shadow mode, journeys, demo material
- **Shadow mode** (§16.2): `SHADOW_MODE=true` scores everyone but shows outputs only to the emails in `PROJECT_TEAM_EMAILS` and dispatches nothing (`server/shadow.ts`, `components/shell/shadow-hold.tsx`). Approvals, the dashboard and the kanban show a hold notice to everyone else.
- **Five-journey smoke test** (§19): `e2e/journeys.spec.ts` covers onboarding, passport + quest, mentor approval, consent change and audit export. The suite also runs on a Pixel 7 viewport (`mobile` project), except the authorization matrix (it does not depend on the viewport) and the three journeys that use up seeded data (tagged `@stateful`). `e2e/global-setup.ts` reseeds the demo data before each run, and the default `expect` timeout is 15 s because the dev server compiles a route on its first visit. `policy/2026.10-v1.json` was reformatted with Biome (whitespace only) so `npm run check` passes.
- **Docs**: `docs/decisions.md` (the §21 open items with owner, default in force and status), `docs/dpdp-mapping.md`, `docs/demo-script.md` (7-minute script, backup-recording notes, 8-slide outline) and `scripts/checkpoint.sh` (tags a clean, passing tree as `checkpoint-YYYYMMDD-HHMM`; never commits or pushes).
- **Not done, needs a person**: the backup recording, the slides themselves, tagging every two hours during the hackathon.

### 2026-10-12: Screens, navigation and seed data for Phases 6–11
- **New routes**: `/notices` (in-app notices), `/admin/evidence` (reviewer queue), `/admin/attendance`, `/admin/placement`, `/admin/traction`, `/admin/policy`, `/admin/ingestion`, `/admin/requests`. `/notices` is added to the proxy's signed-in routes; the shell's navigation, mobile bottom bar (short labels, horizontal scroll when there are seven items) and `homeFor` follow the role.
- **Student side**: quests with accept/defer/evidence form, passport nudges and the counseling/emergency footer, the six-card onboarding wizard, consent centre with notification preferences, leaderboard opt-in. Server actions in `app/student/actions.ts` replace the earlier shims.
- **Staff side**: mentor brief on the approvals page, review form, policy editor, request form, audit report with sample card, student deep-dive anchors (`#score`, `#components`, `#personas`) that brief facts link to.
- **Layout fixes found in review at 1440 and 390**: attendance table became a stacked list on phones, long policy keys wrap (`overflow-wrap:anywhere`), the audit report's stray `col-span` (which created an implicit column) was removed, and the detector advisory font size was reduced. No tokens, fonts, radii or shadows changed.
- **Seed**: reviewer-queue items for the demo mentor, plus `student3@aspiredge.example`, a student who has not yet onboarded (it is the account the onboarding journey test walks through, so it ends up onboarded after a test run). Reseed with `npm run db:seed`.

### 2026-10-12: Hosted on Railway (production)
- **What**: the whole project now runs on Railway (project `aspiredge-ai`, environment `production`) at <https://aspiredge.up.railway.app>: `web`, `worker`, a pgvector `Postgres` and `Redis`. Layout, variables and deploy commands are in the new **Deployment (Railway)** section above. No application code, dependency, schema, route, design or folder changes.
- **Database**: a new Postgres (`pgvector/pgvector:pg17`, persistent volume) was created in Railway. The local `DATABASE_URL`, and the `DATABASE_URL`/`DIRECT_URL` in `.env.production`, were left alone; Railway's `DATABASE_URL` is a reference to the new service's private address. All 12 migrations applied cleanly through the web service's pre-deploy command (`npm run db:migrate`).
- **Domain**: the generated Railway domain was renamed to `aspiredge.up.railway.app` and routed to port 3100.
- **Demo sign-in**: on. The production database was seeded once (60 synthetic students, 13 demo accounts, 16 interventions pending approval; embeddings skipped because no `OPENROUTER_API_KEY` is set). Switch it off with `railway variable set DEMO_LOGIN_ENABLED=false --service web`. The shared password is the `DEMO_PASSWORD` variable on `web`.
- **Open item**: hosting is in Singapore, not an India-region cloud (see `docs/decisions.md` item 5).
- **Reader must run**: nothing for local development. Production deploys happen on push to `main` (GitHub integration, no direct uploads).

### 2026-10-12: Railway deploys from GitHub; worker Redis connection; demo sign-in switch
- **GitHub-based hosting**: `web` and `worker` are connected to `felixjonus07/hackcelerate`, branch `main`, and deploy on every push. Direct uploads (`railway up`) are no longer used.
- **Postgres over TLS**: `main`'s database client forces SSL for any non-local host (added for Supabase), so the Railway Postgres service now starts with TLS on (self-signed certificate generated at start, `ssl=on`). Application code is unchanged; the data volume was kept.
- **Worker Redis connection** (`src/workers/index.ts`): `createRedis()` sets a 3 s command timeout and stops reconnecting after 3 tries, which suits web requests but made every blocking BullMQ call fail (`Command timed out`, 25 times in 20 s locally). The worker's own connection now has no command timeout and keeps retrying.
- **Demo sign-in switch**: `DEMO_LOGIN_ENABLED` is the on/off switch on `web`, with `ALLOW_DEMO_LOGIN_IN_PRODUCTION=true` as the standing production opt-in. It is `true` now: the production database was seeded with the 60 synthetic students and the 13 demo accounts.
- **Known**: `npm run check` has one failure that is not part of this change (`policy-admin.test.ts` hardcodes `effective_from = "2026-10-12"` as "tomorrow") and `drizzle.config.ts` has a Biome formatting error from the Supabase commit.

### 2026-10-12: Student sign-up and registrar user management
- **`/sign-up`** (new): a student creates their own account with name, email, department, year and a password of 12+ characters. `signUpStudent` (`src/server/services/signup.ts`) creates the user as `student`, the minimal `students` + `student_identities` record (a pseudonymous ID derived from the user id, a placeholder roll number until the ERP import attaches the real one) and an audit event, then the form signs the student in and opens `/student/onboarding`. A link appears on `/sign-in` while sign-up is open.
- **Switch**: `SIGNUP_ENABLED` (default `true`; `false` closes registration and hides the link) and `AUTH_SIGNUP_RATE_PER_HOUR` (default 5 accounts per network address per hour). Both are in `.env.example`. Email + password sign-in is now on when either demo login or sign-up is on (`passwordAuthEnabled`); institution SSO is unchanged.
- **Demo switch still holds**: seeded `@aspiredge.example` accounts are refused while `DEMO_LOGIN_ENABLED` is off, and nobody can register on that domain.
- **`/admin/users`** (new, registrar only, "Users" in the navigation): search by name or email, filter by role and status, add a staff member with a first password, change a staff role, turn an account on or off, sign someone out everywhere. Guards: no changes to your own account, student accounts keep the student role, at least one active registrar must remain. Each change and each directory read writes an audit event (`user.created`, `user.role_changed`, `user.disabled`, `user.enabled`, `user.sessions_revoked`, `users.list`); a role change or turning an account off ends that person's sessions.
- **Schema**: migration `0012_user_disabled_at.sql` adds a nullable `user.disabled_at`. Production applies it through the `web` pre-deploy step; locally run `npm run db:migrate`.
- **Fix found by the new tests**: the "is this a student?" subquery in `users.ts` must qualify `"user"."id"`, otherwise Drizzle renders a bare `"id"` that resolves to `students.id`.
- **Tests**: `signup.test.ts` and `users.test.ts` (12 tests, real database). `npm run check` still has the known date-dependent `policy-admin` failure, and the `staff-and-notices` suite can fail on a race with other test files that share the database; both failed before this change.
- **Reviewed** with the Playwright CLI at 1440 and 390 (no overflow, no console errors) and on a production build; the impeccable detector reports only the `2.4rem` mobile hero size, the same as the existing sign-in hero. `drizzle.config.ts` was reformatted by Biome (whitespace only), which clears the lint error from the Supabase commit.

## Roadmap (post-freeze ideas go here)

- Server-side PDF export for the audit report
- WhatsApp digest templates (opt-in)
- Alumni matchmaker using pgvector similarity
