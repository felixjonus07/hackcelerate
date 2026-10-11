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
| E-Cell coordinator | `ecell@aspiredge.example` | `/admin/dashboard` |
| HOD | `hod@aspiredge.example` | `/admin/dashboard` |
| Dean | `dean@aspiredge.example` | `/admin/dashboard` |
| Registrar | `registrar@aspiredge.example` | `/admin/dashboard` |
| Auditor | `auditor@aspiredge.example` | `/admin/audit-report` |

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
| `/sign-in` | everyone | Email + password (demo accounts prefill the email), institution SSO when configured, timeout reasons |
| `/account/security` | everyone signed in | Session limits, other devices with remote sign-out, password change |
| `/student/passport` | student | Score vs readiness, gap, trend, next step (with its score value), quests, evidence, score breakdown |
| `/student/what-if` | student | Live simulator on the same engine; writes nothing |
| `/student/quests` | student | Accept, defer and submit evidence |
| `/student/consent` | student | Sharing per category × office, leaderboard opt-in, data rights |
| `/student/onboarding` | student | Six-card setup (§12.1) |
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
| Headers | CSP, HSTS (production), `X-Frame-Options: DENY`, `Permissions-Policy`, COOP, no `X-Powered-By`; protected pages `Cache-Control: private, no-store` | `next.config.ts`, `src/proxy.ts` |
| Secrets | App refuses to start in production with the dev `BETTER_AUTH_SECRET` | `src/server/env.ts` |

All limits are env-configurable (`SESSION_*`, `AUTH_*`; see `.env.example`). Behind a reverse proxy, set `TRUSTED_IP_HEADER` to the header the proxy sets, so clients can't spoof their IP to dodge rate limits.

## Reviewing pages with the Playwright CLI

```bash
npx playwright-cli install-browser chromium      # first time only
npx playwright-cli open http://localhost:3100/sign-in
npx playwright-cli snapshot                      # find element refs
npx playwright-cli click <ref>
npx playwright-cli screenshot --full-page --filename .impeccable/review/page.png
npx playwright-cli resize 390 844                # mobile pass
```

## Environment variables

See [`.env.example`](.env.example). Key ones: `DATABASE_URL`, `REDIS_URL`, `BETTER_AUTH_SECRET`, `DEMO_LOGIN_ENABLED`, `OIDC_*` (institution SSO), `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` (verify the slug before use), `OPENROUTER_EMBEDDING_MODEL`, `GITHUB_TOKEN`, `POLICY_FILE`.

## Project status

Phase 0 (foundation & scaffolding) is complete apart from CI. See [`PLAN.md`](PLAN.md) for the phase list and exit gates. Open product decisions (§21) run on the documented defaults until the institution records them.

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

### 2026-10-11: Worker runner compatibility
- Wrapped the BullMQ scheduler setup in `src/workers/index.ts` inside an async `start()` function to support CommonJS execution under `tsx` without top-level await errors.

### 2026-10-11: Phase 1 — Data layer & policy completion (§3, §4)
- Added `parentalConsentRequired` and `parentalConsentAt` on `students` for DPDP Act 2023 / §4.3 under-18 consent check (migration `0004_parental_consent`).
- Implemented pure data-quality validators in `src/server/ingestion/quality.ts` covering every row of Table 4.3 (CGPA range, attendance week & series confidence degradation, mock attempt speed & percentile exclusion, artifact URL reachability, roll number format, and date-of-birth consistency with under-18 parental check).
- Implemented ERP CSV import job (`src/server/ingestion/erp.ts`) with flexible column mapping, SHA-256 checksum tracking via `ingestion_runs`, bad roll number rejection, missing file stale detection, and worker integration.
- Upgraded policy loader (`src/server/policy/load.ts`) to resolve active policy from database `policy_versions` with fallback to `policy/2026.10-v1.json`, cache invalidation on policy activation, and strict validation that track component weights sum to 100 (§5.3).
- Added `GET /api/v1/admin/policy/versions` endpoint to query version history.
- Added append-only trigger tests (`src/server/db/__tests__/immutability.test.ts`) verifying PostgreSQL rejects `UPDATE` and `DELETE` on `evaluations` and `audit_events`.
- Updated seed script (`scripts/seed.ts`) to seed active policy versions, realistic student dates of birth across 7 departments with under-18 test accounts, and pgvector embeddings for `remediation_library` and `opportunities` when `OPENROUTER_API_KEY` is present.
- Unit test suite expanded from 49 to 84 tests (all passing).
- Run: `npm run db:migrate && npm run db:seed` (or `npm run db:reset`).

### 2026-10-11: Phase 2 — Rules engine completion (§5)
- Implemented deterministic calculators for all six tracks in `src/server/rules/rubrics/index.ts` (§5.3): Corporate Placement, Higher Studies & Research, Entrepreneurship & Startups, Public Service & Government Exams, Freelance & Creator Economy, and Sports, Defense & NCC.
- Higher Studies entrance exams: enforced mixed-source lowest-multiplier rule (`min_{m} multiplier(m.status)` across practice mock sources, §5.3.2) and timed mock speed sub-measure.
- Sports, Defense & NCC: physical fitness scaled by BMI band factor (`NORMAL`, `WATCH`, `EVALUATE`), strictly guaranteeing BMI is never displayed or output as a number to protect students from comparison and body-image harm (§5.3.6).
- Track gates (§5.3): implemented gate evaluation for all tracks (`at_least_one_department_standard_item`, `cgpa_above_eligibility_floor`, `attendance_at_or_above_requirement`, `minimum_credits_held`). Updated UI in student passport and what-if simulator to show gate failure notice and "Not enough evidence yet" before scores are shown.
- Version stamp: recorded `RULES_ENGINE_VERSION` (semver) on every evaluation.
- Added comprehensive rubric specification suite (`src/server/rules/__tests__/rubrics.test.ts`, 10 tests) and fast-check property testing suite (`src/server/rules/__tests__/properties.test.ts`, 21,000 runs) proving score boundedness in [0, 100] and monotonicity (adding verified evidence never lowers a score, §15.1).
- Reviewed rendered UI with Playwright CLI at desktop (1440) and mobile (390) viewports with zero horizontal overflow.

### 2026-10-11: Phase 5 — LLM reasoning layer completion (§9, §15.2, Appendix A, B, C)
- Added OpenRouter zero-data retention (ZDR) configuration (`provider: { data_collection: "deny" }`) in `src/server/llm/adapter.ts` and confirmed model provider data-retention/training terms in writing (`docs/compliance/provider-terms.md`).
- Implemented comprehensive adversarial test suite (`src/server/llm/__tests__/adversarial.test.ts`) covering 24 distinct attack vectors (Appendix C prompt injection, XSS/HTML, delimiter escapes, fabricated citations, hallucinated numbers, protected attributes, diagnostic claims, forbidden student-facing terms, persona exposures, schema injection, and non-JSON preambles) with zero failures.
- Implemented contract metrics report script (`scripts/contract-metrics.ts`, `npm run metrics:contract`) verifying 100% first-attempt schema pass rate, 100% evidence citation coverage, 100% numeric fidelity, 0% forbidden content rate, and reading grade level compliance.
- Implemented Phase 5 exit gate suite (`src/server/llm/__tests__/exit-gate.test.ts`) verifying that running without `OPENROUTER_API_KEY` yields valid, citation-complete, schema-compliant fallback narratives for all seed records (`SYN-01…07`, `ME-27`, `CS-44`, `EE-12`).
- Total test suite expanded to 19 test files with 231/231 passing tests (`npm run check` and `npm run build` passing cleanly).

### 2026-10-11: Phase 4 — AEG engine, personas, trends, routing completion (§7, §8.1, §3.3, §20, Appendix D)
- Added institution holiday calendar to policy schema (`src/server/policy/schema.ts`) and policy file (`policy/2026.10-v1.json`).
- Upgraded working-day SLA calculator (`src/server/services/time.ts`) with weekend skipping, institution holiday calendar integration, and bidirectional duration utilities (`addWorkingDays`, `workingDaysUntil`, `isWorkingDay`). Integrated calendar into intervention SLA generation (`src/server/services/evaluations.ts`).
- Added automatic re-evaluation trigger when a policy version activates (`src/app/api/v1/admin/policy/versions/[v]/activate/route.ts`, §3.3) enqueuing BullMQ evaluation jobs for all students with reason `policy_change`.
- Expanded golden evaluation tests (`src/server/rules/__tests__/golden.test.ts`) covering all Appendix D synthetic seed records (`SYN-01` through `SYN-07`), worked examples `CS-44` and `EE-12`, with persona triggers, index floors, and SLA calendar math.
- Added tests in `src/server/services/__tests__/time.test.ts` and `src/server/policy/__tests__/activation-trigger.test.ts` (197 tests passing across the entire suite).

### 2026-10-11: Phase 3 — Evidence verification layer completion (§6)
- Implemented artifact status lifecycle (§6.1) in `src/server/verification/lifecycle.ts` with strict allowed transitions table, transaction atomicity, actor attribution, and append-only audit event logging on every status change.
- Added asynchronous verification workers integrated with BullMQ queue (`src/server/verification/`):
  - GitHub worker: OAuth repo ownership, REST metadata, authorship, and fork detection (§6.2).
  - Crossref DOI worker: DOI lookup with student name matching and mentor review fallback.
  - Link worker: HTTP liveness verification, SSRF protection, and public profile owner-name match.
  - Certificate / internship letters: review flow for named reviewer attestation (`ATTESTED`).
  - External mock report sampling: 10% deterministic pseudorandom sampling per academic term (`sampling.ts`).
- Implemented integrity checks (§6.3) in `src/server/verification/integrity.ts`: implausible speed, burst commits, duplicate claims, streak padding, and reused content hash (flags for human review only; never altering scores directly).
- Implemented object storage abstraction (`src/server/storage/index.ts`) supporting S3-compatible signed URLs (≤ 5 min expiration) with local fallback.
- Added recheck scheduler (`src/server/verification/recheck.ts`) running daily via BullMQ to transition stale artifacts (`STALE` after one failed check, `UNVERIFIED` after two).
- Database migration `0005_phase3_verification.sql` for verification lifecycle tables and columns.
- Integration tests: 91 tests across `lifecycle.test.ts`, `integrity.test.ts`, and `workers.test.ts` (all passing).

### 2026-10-11: Vercel deployment configuration
- Added `vercel.json`: framework nextjs, region bom1/Mumbai, auto-deploy restricted to `main` branch only (`git.deploymentEnabled`).
- Added `scripts/vercel-ignore.mjs`: skips Vercel builds when only docs/config/e2e files changed (saves Hobby plan build minutes).
- External services required: Neon PostgreSQL (pgvector), Upstash Redis (TCP), BullMQ worker on Railway/Render.
- All env vars in `.env.example`; minimum required in Vercel: `BETTER_AUTH_SECRET`, `DATABASE_URL`, `REDIS_URL`, `APP_URL`, `BETTER_AUTH_URL`, `NODE_ENV`, `POLICY_FILE`.
- Node 22.x must be selected in Vercel project settings (`engines` in `package.json`).

### 2026-10-11: Fix Vercel deployments being canceled (vercel-ignore exit codes)
- **Root cause**: `scripts/vercel-ignore.mjs` had all `process.exit()` calls inverted. Vercel's `ignoreCommand` uses exit **1** to proceed and exit **0** to skip — the opposite of standard Unix convention. Every branch in the script was calling the wrong code, so the "no previous SHA" first-deploy path called `exit(0)` (skip), causing Vercel to cancel every initial deployment.
- Fixed `process.exit(0)` → `process.exit(1)` in the "no previous SHA", "git diff failed" fallback, and "app files changed" branches.
- Fixed `process.exit(1)` → `process.exit(0)` in the "no changed files" and "all skippable" branches.
- Updated header comment block to correctly document the Vercel convention.
- Verified locally: no-SHA branch exits 1 (BUILD ✅), app-file change exits 1 (BUILD ✅), docs-only change exits 0 (SKIP ✅).
- Moved `@tailwindcss/turbopack` and `tailwindcss` from `devDependencies` to `dependencies` in `package.json`.
- Updated `vercel.json` `installCommand` to `npm ci --include=dev` so build-time devDependencies (`typescript`, `@types/*`, `babel-plugin-react-compiler`) are preserved when Vercel sets `NODE_ENV=production`.

### 2026-10-11: Phase 6 — Interventions & counseling completion (§8, §12.2, §12.4, §13.1)
- Implemented consent check at dispatch (`src/server/services/approvals.ts`): interventions to external/placement/co-curricular roles (in `CONSENT_RECIPIENTS` per §13.1 Table 13.1) verify student consent for `intervention_history` / `persona_aeg`. If consent is missing, dispatch is blocked with a clear reason, recorded in `audit_events`, and retained at `APPROVED` until consent is granted. Academic roles (assigned faculty mentor, class advisor) dispatch immediately per academic relationship.
- Added SLA tracking and escalation background worker (`src/server/services/approvals.ts`, `src/workers/index.ts`): scheduled job (`sla_escalation`) evaluates overdue interventions past working-day SLA and escalation window using institution holiday calendar, escalating to configured `escalate_to` role (`PENDING_APPROVAL`).
- Implemented Quest lifecycle and completion verification (`src/server/services/quests.ts`):
  - Overdue quests past `dueAt` transition to `EXPIRED` and advance student counseling cards to `FOLLOW_UP_DUE` via scheduled maintenance job (`quest_expiry`).
  - Quests advance to `DONE` only when the linked artifact is verified (`VERIFIED` or `ATTESTED`) AND matches the quest's `requiredEvidenceType` (§8.3).
  - Student evidence submission enqueues background verification worker.
- Built Mentor Brief service and UI components (`src/server/services/mentor-brief.ts`, `src/components/staff/mentor-brief.tsx`):
  - Three verifiable facts computed purely in code, each displaying exact source field and `ev:ID` audit citation.
  - Identification of data gaps and rules-engine derived suggested questions (contextual to `aegIndex` and target date).
  - Pivot advisory displaying score delta and target track based on rubric evaluation (§7.6).
  - Integrated `MentorBrief` on the approval queue screen (`/admin/approvals`) and `MentorGuidanceCard` on the student deep-dive screen (`/admin/students/[id]`).
- Added authorization tests (`src/server/consent/__tests__/matrix.test.ts`) and Phase 6 unit suite (`src/server/services/__tests__/phase6.test.ts`) verifying that dispatch without consent is impossible and all exit gate requirements are met.

### 2026-10-11: Phase 7 — Student experience completion (§12.1, §12.3, §13.7, §14.2)
- **Onboarding wired end-to-end (§12.1)**:
  - Wire all six cards of `OnboardingWizard` (`src/components/onboarding/wizard.tsx`):
    - Card 1 (Notice): plain-language explanation of collection, logged notice acknowledgment (`notice.ack` audit event via `acknowledgeNotice`).
    - Card 2 (Consent choices): granular sharing switches per office (Placement cell, E-Cell, Sports office) and academic categories, defaulting to mentor-only.
    - Card 3 (Baseline check): read-only ERP baseline check (CGPA, attendance, department, year) with direct correction request action (`requestRight`).
    - Card 4 (Ambition): track selector, outcome, target date (future-date validation), and readiness slider; saving triggers deterministic evaluation and updates declared track.
    - Card 5 (Evidence): inline evidence submission form (`submitGeneralEvidence`) enqueuing background verification worker.
    - Card 6 (Passport): setup completion summary and link to passport view.
- **Data rights requests (§13.7, DPDP Act 2023)**:
  - Built student personal data export endpoint (`GET /api/v1/students/me/export`): provides downloadable, machine-readable JSON containing baseline records, aspirations, artifacts, evaluations, consent records, and access audit log.
  - Implemented correction routing (`src/server/services/rights.ts`): routes ERP data corrections to Registrar and narrative inquiries to assigned mentor.
  - Implemented erasure against retention schedule: displays statutory 5-year retention requirements for official degrees while scheduling non-statutory data for 30-day deletion.
  - Integrated request history in the Sharing center (`/student/consent`) displaying request types, status tags (`OPEN`, `PENDING_REVIEW`, `COMPLETED`), 30-day statutory response SLAs, and routing resolutions.
- **Wellbeing guardrails & recovery nudges (§14.2)**:
  - Implemented behavioral pattern checks in `src/server/services/wellbeing.ts`:
    - `late_night_clustering`: study sessions after midnight on 5+ nights in 14 days.
    - `mock_surge_attendance_drop`: mock volume surge > 100% in 1 week combined with attendance dip.
    - `abrupt_inactivity`: 14 days pause in activity after heavy use.
  - Transparent recovery nudges in `PassportView` (`src/app/student/passport/passport-view.tsx`): displays the exact pattern detected with non-stigmatizing, supportive phrasing (§14.3); presents campus counseling centre (Block A, Room 12) and emergency contacts (112); preserves permanent counseling contacts in the passport footer.
- **Leaderboards opt-in with track tabs and verified chips (§4.1, §12.1)**:
  - Read model (`src/server/services/leaderboard.ts`) ranking only students who opted in via `leaderboardOptIns`.
  - Upgraded `/leaderboards` page with tabbed career tracks, streak badges, and verified evidence chips (`EvidenceChip`).
  - Updated API route `GET /api/v1/leaderboards?track=` returning opted-in cohort rankings.
- **Testing & verification**:
  - Added Phase 7 unit tests in `src/server/services/__tests__/phase7.test.ts`.
  - Added end-to-end journey tests in `e2e/student.spec.ts` ("onboarding end-to-end wizard", "passport and quest", "consent change and data rights").
  - Test suite passes with 21/21 test files (244 passing tests) and `npm run check` clean.

## Roadmap (post-freeze ideas go here)



- Server-side PDF export for the audit report
- WhatsApp digest templates (opt-in)
- Alumni matchmaker using pgvector similarity
