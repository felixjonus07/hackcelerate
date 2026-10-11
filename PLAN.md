# AspirEdge AI — Implementation Plan

> **Audience:** every engineer and coding agent working in this repository.
> **Source of truth for product rules:** [`docs/reference/AspirEdge_Deep_Plan.pdf`](docs/reference/AspirEdge_Deep_Plan.pdf) (Deep Platform Plan v2.0, 11 Oct 2026). Section numbers below (`§5.3`) refer to that document.
> **Binding rules for how to work:** [`AGENTS.md`](AGENTS.md) (also loaded as `CLAUDE.md`). Read it before starting any task.

This plan turns the reference blueprint into an ordered set of phases. Each phase lists its goal, the tasks (as checkboxes agents tick off), the files it owns, and an **exit gate** that must pass before the next phase starts. Phases are sequential; tasks inside a phase may run in parallel unless marked `→ depends on`.

---

## 0. How agents use this file

1. Find the **first phase whose exit gate is not met**. Work only on unchecked tasks in that phase (or a later phase only if the task is explicitly marked `parallel-safe`).
2. Before coding, re-read the referenced `§` sections and the relevant module README comment.
3. When a task is done: tick its checkbox here, add a dated entry to the **Changelog** in [`README.md`](README.md), and make sure `npm run check` passes (lint + typecheck + unit tests).
4. Never change the tech stack, the folder structure, or the UI design language (see `AGENTS.md` → *Locked decisions*). If a task seems to require it, stop and ask the user.
5. Any numeric threshold, weight or band belongs in the **policy file** (`policy/*.json`), never in code (§1.3 "Configurable, not hardcoded").
6. UI work follows `PRODUCT.md`, `DESIGN.md` and the `/impeccable` skill. Review rendered pages with the Playwright CLI (`npx @playwright/cli`) before marking a UI task done.

---

## 1. Architecture at a glance

The reference plan suggests a Python/FastAPI backend (§10.1). **The user fixed a TypeScript/Next.js stack instead.** Each component in §10.1 maps as follows:

| §10.1 component | This repository | Location |
| --- | --- | --- |
| Web client | Next.js 16 App Router, React 19, Tailwind CSS v4, Recharts, dnd-kit | `src/app`, `src/components` |
| API service | Next.js Route Handlers under `/api/v1`, Zod validation | `src/app/api/v1` |
| Request gate | `src/proxy.ts` (Next.js 16 **proxy**, never `middleware.ts`) for optimistic session redirects; real authorization in the data access layer | `src/proxy.ts`, `src/server/auth` |
| Ingestion service | TypeScript job on BullMQ (ERP CSV import + checksum) | `src/server/ingestion`, `src/workers` |
| Verification workers | BullMQ workers on Redis (GitHub, Crossref, link, certificate) | `src/server/verification`, `src/workers` |
| Rules engine | Pure TypeScript package, **no I/O**, versioned, unit + property tested | `src/server/rules` |
| LLM adapter | OpenRouter (OpenAI-compatible API) via `fetch`, pinned model, Redis-cached | `src/server/llm` |
| Validator | Zod schema + evidence-ref, numeric-fidelity and forbidden-content checks | `src/server/llm/validator.ts` |
| Consent service | Access matrix (§13.1) + consent records; called on every read path | `src/server/consent` |
| Notification service | Email/WhatsApp digests (Phase 8+) | `src/server/notifications` |
| Database | PostgreSQL 17 + **pgvector**, Drizzle ORM + drizzle-kit migrations | `src/server/db`, `drizzle/` |
| Cache & queue | Redis 7: Next.js data cache helpers, narrative cache, BullMQ queues | `src/server/cache`, `src/server/queue` |
| Object storage | S3-compatible bucket with signed URLs (Phase 3) | `src/server/storage` |
| Identity | Better Auth: seeded demo accounts per role + generic **OIDC** provider (institution IdP) enabled by env | `src/server/auth` |

**pgvector use:** semantic matching of a student's data gaps to the *remediation library* and the *opportunity feed* (§9.1 "Action plan … constrained to the remediation library and linked opportunities"), and alumni matchmaking (§2). Embeddings are produced through OpenRouter's embeddings endpoint behind `src/server/embeddings`.

**Nightly data flow (§10.2):** ERP / GitHub / Crossref / uploads → ingestion → verification → rules engine → evaluation record → LLM adapter → validator → consent check → approval queue → mentor UI. "Run eval" re-runs one student through the same path.

---

## 2. Phase overview

| Phase | Name | Reference | Exit gate (summary) |
| --- | --- | --- | --- |
| 0 | Foundation & scaffolding | §10, §19 h0–2 | `npm run check` green, Docker services up, app boots, seed runs |
| 1 | Data layer & policy | §3, §4 | Schema + migrations for all §4.1 entities; policy file validated; 60 synthetic students seeded |
| 2 | Rules engine | §5, §20 | Golden tests reproduce §20 to one decimal; property tests pass |
| 3 | Evidence verification | §6 | Status lifecycle enforced; GitHub + Crossref + link workers live; integrity flags |
| 4 | AEG, personas, trends, routing | §7, §8.1 | Seed records SYN-01…07 produce expected personas and index floors |
| 5 | LLM reasoning layer | §9, App. A–C | Validator pipeline + fallback; adversarial suite (≥20 cases) zero failures |
| 6 | Interventions & counseling | §8 | Approve/edit/reject end-to-end with consent check; Kanban with WIP limits |
| 7 | Student experience | §12.1, §12.3 | Onboarding → passport → quest → consent change journey passes e2e |
| 8 | Staff experience | §12.2, §12.3 | Command Center, deep-dive with reason codes, audit report, leaderboards, policy admin |
| 9 | Security, privacy, DPDP | §13 | Authorization matrix tests zero failures; audit log append-only; retention jobs |
| 10 | Fairness, wellbeing, evaluation | §14, §15 | Golden set (60) + LLM thresholds §15.2 met; a11y no critical violations; load targets §10.3 |
| 11 | Demo hardening & rollout | §16, §19 | Five-journey smoke test; shadow-mode switch; demo script + backup recording |

---

## Phase 0 — Foundation & scaffolding

**Goal:** a runnable, documented skeleton every later phase builds on. Mirrors §19 hours 0–2.

- [x] Next.js 16.4 App Router app with TypeScript, Tailwind v4, React Compiler, Cache Components, Biome
- [x] `src/proxy.ts` session gate (no `middleware.ts`)
- [x] `docker-compose.yml`: PostgreSQL 17 + pgvector (port 5434), Redis 7 (port 6380)
- [x] Drizzle config, DB client, Redis client, BullMQ queue registry, worker entry
- [x] Better Auth (email/password demo accounts + generic OIDC slot via env)
- [x] Environment schema validated with Zod (`src/server/env.ts`) and `.env.example`
- [x] Pure rules-engine module with Corporate Placement rubric and golden tests (seeded early so UI has real numbers)
- [x] LLM adapter, validator and templated fallback skeletons
- [x] Access matrix (§13.1) as data + tests
- [x] Base UI shell and the mentor + student loop screens built with `/impeccable`
- [x] `AGENTS.md`, `CLAUDE.md`, `PLAN.md`, `README.md`, `PRODUCT.md`, `DESIGN.md`
- [x] Seed script with demo accounts and synthetic students (Appendix D + generated cohort)
- [x] Playwright smoke journeys (`e2e/smoke.spec.ts`) and Playwright CLI page review
- [ ] CI workflow (GitHub Actions: `npm ci && npm run check && npm run build`) — `parallel-safe`

**Exit gate:** `docker compose up -d && npm run db:migrate && npm run db:seed && npm run check && npm run build` all succeed; `/sign-in` renders; a demo mentor can reach `/admin/approvals`.

---

## Phase 1 — Data layer & policy

**Goal:** every §4.1 entity persisted with the §4.3 data-quality rules; the policy file is the only home for numbers.

- [x] Review `src/server/db/schema/*` against §4.1; add missing columns (e.g. `Student.dateOfBirth` for the under-18 check §4.3)
- [x] Policy lifecycle: `policy_versions` table with status `DRAFT → ACTIVE → RETIRED`, effective date, two-approval record for persona changes (§3.3)
- [x] `src/server/policy/load.ts`: load active version from DB, fall back to `policy/2026.10-v1.json`; Zod-validate; weights per track sum to 100
- [x] Evaluations immutable: DB trigger rejecting `UPDATE`/`DELETE` on `evaluations` (like `audit_events`)
- [x] Data-quality validators (§4.3) as pure functions in `src/server/ingestion/quality.ts` with tests
- [x] ERP CSV import job (`src/server/ingestion/erp.ts`): column mapping, checksum vs previous night, reject rows with bad roll numbers, mark stale on missing file
- [x] Expand seed to 60 synthetic students across 7 departments; every record labelled synthetic
- [x] pgvector: seed `remediation_library` and `opportunities` with embeddings (skip embeddings when no API key)

**Exit gate:** `npm run db:reset` builds from scratch; quality-rule tests cover every row of §4.3; policy loader rejects a file whose weights don't sum to 100. [MET]

---

## Phase 2 — Rules engine

**Goal:** deterministic, reproducible scores for all six tracks (§5). Lives in `src/server/rules` — no imports from `db`, `cache`, `llm`, network or `Date.now()` (pass `asOf` in).

- [x] Normalization functions (§5.2) with tests
- [x] Verification multipliers (§5.5) from policy
- [x] Corporate Placement rubric incl. department standards (§5.3.1, §5.4)
- [x] Track score + confidence (§5.6)
- [x] Golden test: Example A ME-27 = 48.14, what-if scenarios 58.14 / 59.64 (§20.1–20.2)
- [ ] Higher Studies & Research rubric (§5.3.2) — mixed-source lowest-multiplier rule
- [ ] Entrepreneurship rubric (§5.3.3)
- [ ] Public Service rubric + CGPA gate (§5.3.4)
- [ ] Freelance & Creator rubric + attendance gate (§5.3.5)
- [ ] Sports, Defense & NCC rubric + credits gate; BMI never output as a number (§5.3.6)
- [ ] Gates (§5.3): a failed gate returns `gateFailed` and the UI shows "Not enough evidence yet"
- [ ] Property tests (fast-check, 10,000 runs): scores ∈ [0,100]; adding verified evidence never lowers a score (§15.1)
- [ ] Version stamp: `RULES_ENGINE_VERSION` recorded on every evaluation

**Exit gate:** `npm run test -- rules` green; golden rubric tests match §20 to one decimal place.

---

## Phase 3 — Evidence verification layer

**Goal:** the §6.1 status lifecycle enforced in code; verification runs off the request path on BullMQ.

- [ ] `src/server/verification/lifecycle.ts`: allowed transitions table (§6.1) + tests; every transition writes an audit event with actor and reason
- [ ] GitHub worker: OAuth ownership, REST owner/creation/commit authorship/fork check; recheck every 30 days (§6.2)
- [ ] Crossref DOI worker with author-name match; name variants → mentor review
- [ ] Portfolio/link worker: HTTP live check + owner name match → `LIVE_UNVERIFIED` on login walls
- [ ] Certificate / internship letter flows → `ATTESTED` by named reviewer
- [ ] External mock report: 10 % random sampling per term
- [ ] Integrity checks (§6.3): implausible speed, burst commits, duplicate claim, streak padding, reused text (content hash). Output is a **flag for review only** — never changes a score
- [ ] Object storage (S3-compatible, private bucket, signed URLs ≤ 5 min) for uploads
- [ ] Recheck scheduler (repeatable BullMQ jobs); STALE after one failed recheck, UNVERIFIED after two

**Exit gate:** worker integration tests with recorded HTTP fixtures pass; transitions outside the table are rejected.

---

## Phase 4 — AEG engine, personas, trends, routing

**Goal:** §7 and §8.1 implemented as pure rules, driven by policy.

- [x] Gap ratio and AEG bands (§7.2); persona floor can raise, never lower
- [x] Persona triggers (§7.3) incl. attendance-critical flag without persona
- [x] Precedence (§7.4) with queued lower-priority routes
- [x] Trend engine: least-squares slope over 4 weeks, thresholds, INSUFFICIENT_DATA (§7.5)
- [x] Pivot advisory (§7.6) — rule-based, never automatic
- [x] Routing table (§8.1): recipient, approver, SLA, escalation, closure rule — from policy
- [ ] Working-day SLA calculator with institution holiday calendar
- [ ] Re-evaluation trigger when a policy version changes (§3.3)
- [ ] Golden tests: SYN-01…07 expected personas and index floors (Appendix D), CS-44 and EE-12 (§20.3–20.4)

**Exit gate:** all Appendix D seed records produce their expected persona and index.

---

## Phase 5 — LLM reasoning layer

**Goal:** the model writes language only, from validated facts (§9). Provider: **OpenRouter**.

- [x] Prompt builder with four fixed layers: system (Appendix A) → policy → facts → task (§9.2)
- [x] Untrusted-text sanitizer: strip markup, cap 1,000 chars, wrap in delimited data blocks
- [x] OpenRouter adapter via `fetch`: records provider, model id, temperature, prompt version (§9.4)
- [x] Output schema (Appendix B) as Zod
- [x] Validator pipeline (§9.3): parse → schema → evidence refs → numeric fidelity → forbidden content → tone/length
- [x] Templated rules-only fallback, `fallback = true`, notice text (§9.4)
- [x] One retry with parser error on steps 1–2, then fallback
- [x] Narrative cache keyed by hash(facts, policy version, prompt version) in Redis (§9.5)
- [ ] Adversarial suite (Appendix C + 12 more = ≥20 cases) as Vitest tests with a recorded-response harness
- [ ] Contract metrics (§15.2) report script: first-attempt schema pass, evidence coverage, numeric fidelity …
- [ ] Confirm model provider data-retention/training terms in writing before pilot (owner: engineering lead)

**Exit gate:** adversarial suite zero failures; removing `OPENROUTER_API_KEY` yields valid fallback narratives for all seed records.

---

## Phase 6 — Interventions & counseling

**Goal:** no student is contacted without a named approver (§1.3, §8).

- [x] Intervention created only as `PENDING_APPROVAL`; decision endpoint approve / edit-and-approve / reject
- [ ] Consent check at dispatch (recipient + category) — blocks and explains when consent is missing
- [ ] SLA tracking + escalation jobs (§8.1)
- [x] Counseling Kanban columns (§8.2); WIP limit 25 with over-limit banner
- [ ] Kanban: backward moves require a reason; 14-day inactivity amber marker; quest expiry → Follow-up due
- [x] Keyboard moves + screen-reader announcements (dnd-kit keyboard sensor) (§12.4)
- [ ] Quest lifecycle (§8.3): Proposed → Accepted → Active → Evidence submitted → Done / Expired; completes only with evidence of the named type
- [ ] Mentor brief: three facts, data gaps, two suggested questions, pivot options, each fact linked to its source field

**Exit gate:** e2e "mentor approval" journey passes; dispatch without consent is impossible (authorization test).

---

## Phase 7 — Student experience

**Goal:** the student screens of §12.1 / §12.3, mobile first.

- [x] Onboarding six-card wizard shell (§12.1)
- [x] Passport: track score vs readiness, gap index, trend, breakdown, data gaps → quests
- [x] What-if simulator calling the rules engine, writes nothing
- [x] Consent center: toggles per category × recipient, default mentor-only
- [ ] Onboarding wired end-to-end: notice ack, consent choices, baseline check + correction request, ambition (dates validated), evidence, first evaluation
- [x] Evidence submission with live status chips
- [ ] Rights requests (§13.7): access export, correction routing, erasure against retention schedule
- [ ] Wellbeing nudges (§14.2) with campus counseling + emergency contacts in the passport footer
- [ ] Leaderboards opt-in (off by default), tabs per track, verified-link chips

**Exit gate:** e2e journeys "onboarding", "passport and quest", "consent change" pass on Chromium and WebKit.

---

## Phase 8 — Staff experience

- [x] Command Center shell: donut by track, track pill bar, AEG matrix cards (aggregates only)
- [x] Approval queue screen
- [x] Student deep-dive behind reason-code prompt (§13.2) with radar chart; every view logged
- [ ] Class advisor attendance views; placement readiness list (consented fields only); E-Cell traction view
- [ ] Audit report: printable, policy version + draft warning, aggregates + sampled records (§12.3)
- [ ] Registrar: policy editor (draft → two approvals → activate), ingestion status
- [ ] Notifications: weekly digests, WhatsApp templates (opt-in)

**Exit gate:** e2e "audit export" journey passes; Command Center never shows an individual record (test).

---

## Phase 9 — Security, privacy & DPDP compliance

- [x] Access matrix (§13.1) encoded as data with unit tests
- [ ] Authorization tests: every `/api/v1` endpoint × every role (§15.1 "zero failures")
- [ ] Audit events on every read of personal data, policy change, approval, export (§13.6); DB trigger enforces append-only. Auth events done
- [x] Session policy: Redis-stored sessions, server-enforced idle timeout, absolute lifetime per role, trusted devices for students only, timeout warning UI (§13.2)
- [x] Sign-in hardening: per-IP rate limit, per-account lockout, no credentials in client code, demo login off in production, origin check, security headers
- [x] Account security page: sessions, remote sign-out, password change
- [ ] Nonce-based CSP (drop `'unsafe-inline'` for scripts)
- [ ] Pseudonymous IDs in analytics and LLM requests; roll numbers in a restricted table (§4.1, §9.4)
- [ ] Log scrubber for personal fields (§13.3)
- [ ] Retention jobs per §13.5
- [ ] Under-18 parental consent check (§4.3, §13.4)
- [ ] DPDP mapping (§13.4) reviewed by compliance; grievance officer contact on every personal-data screen
- [ ] Dependency scanning, static analysis, OWASP ZAP baseline

**Exit gate:** authorization suite zero failures; ZAP baseline no high findings.

---

## Phase 10 — Fairness, wellbeing & evaluation

- [ ] Fairness protocol (§14.1): flag-rate ratio report by group (≥20 per group), 0.8–1.25 band
- [ ] Language standards linter for student-facing strings (§14.3) as a Vitest test
- [ ] Golden evaluation set: 60 synthetic records with expected personas, bands and reference narratives (§15.3)
- [ ] LLM acceptance thresholds (§15.2) report
- [ ] Accessibility: axe-core on every screen via Playwright; manual screen-reader pass on core journeys
- [ ] Load test (k6): nightly batch of 2,000 students in < 2 h at concurrency 8; p95 < 1 s cached views (§10.3)

**Exit gate:** every row of §15.1's "Gate before pilot" column met.

---

## Phase 11 — Demo hardening & rollout

- [ ] Five-journey smoke test (onboarding, passport+quest, mentor approval, consent change, audit export)
- [ ] Shadow-mode flag: outputs visible only to the project team (§16.2)
- [ ] Tag a working state every two hours during the hackathon (§19)
- [ ] Demo script, backup recording, slides
- [ ] Decisions log for §21 open items (owner, decision, date)

**Exit gate:** judged demo with a backup recording (§16.1 Phase 0 gate).

---

## 3. Mapping to the 24-hour hackathon schedule (§19)

| Hours | §19 focus | Phase / tasks in this plan |
| --- | --- | --- |
| 0–2 | Repo, schema, synthetic data | Phase 0 (done), Phase 1 seed expansion |
| 2–5 | Policy file; Corporate Placement engine | Phase 2 (CP done; finish gates + property tests) |
| 5–8 | Persona, AEG, trend | Phase 4 golden tests |
| 8–11 | LLM adapter, prompt, validator, fallback | Phase 5 retry + cache + adversarial |
| 11–13 | Approval queue API + screen | Phase 6 consent-at-dispatch |
| 13–15 | Onboarding + passport | Phase 7 onboarding wiring |
| 15–17 | What-if | Phase 7 (done) |
| 17–19 | One live GitHub verification; consent center | Phase 3 GitHub worker; Phase 7 consent |
| 19–21 | Kanban + mentor brief | Phase 6 Kanban rules, mentor brief |
| 21–22 | Integration + smoke test | Phase 11 smoke test |
| 22–24 | A11y, copy review, rehearsal, submission | Phase 10 a11y subset, Phase 11 |

Scope freezes at hour 6; new ideas go to the roadmap section of `README.md`.

---

## 4. Open decisions (§21) — defaults in force until recorded

| Decision | Default used in code | Where it lives |
| --- | --- | --- |
| Attendance rule source | 75 % requirement, 65 % condonation floor | `policy/2026.10-v1.json → attendance` |
| CGPA scale | 10-point | `policy → academic` |
| Tracks 1–3 names | Corporate Placement, Higher Studies & Research, Entrepreneurship | `policy → tracks` |
| High Flyer floor | MODERATE | `policy → personas` |
| Hosting | India-region cloud | deployment docs |
| Persona names to students | Never shown | UI copy rules (`AGENTS.md`) |
| Model vendor/version | Pinned per term via `OPENROUTER_MODEL` | `.env` |
| Leaderboard default | Off | `policy → leaderboard` |
| Mentor access to non-assigned students | Allowed with reason, logged | `src/server/consent/matrix.ts` |
| Demographic data for fairness | Consent-only, separate table, never scored | Phase 10 |
