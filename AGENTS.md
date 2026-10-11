<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AspirEdge AI: rules for coding agents

These rules bind every agent and engineer working in this repository (Claude Code reads them through `CLAUDE.md`). If a task conflicts with a rule below, stop and ask the user. Do not work around a rule.

**Read before any task:**

1. [`PLAN.md`](PLAN.md): which phase is active and which task is next.
2. [`PRODUCT.md`](PRODUCT.md): users, purpose, constraints and language rules.
3. [`DESIGN.md`](DESIGN.md) and [`.impeccable/surfaces/src-app.md`](.impeccable/surfaces/src-app.md): the visual system and its direction contract.
4. The relevant section of [`docs/reference/AspirEdge_Deep_Plan.pdf`](docs/reference/AspirEdge_Deep_Plan.pdf). Section numbers such as `§7.3` in code comments refer to it.

---

## 1. Locked decisions (never change without the user's explicit approval)

### 1.1 UI design: built with `/impeccable`, not to be altered

- The visual world is **Warm Consumer App**, chosen by the user in the impeccable decision round. Its tokens live only in `src/app/globals.css` and are documented in `DESIGN.md`.
- **Do not change the design**: no new colours, fonts, radii, shadows or motion curves; no restyling of existing components; no third-party UI kits (shadcn, MUI, Chakra and similar). Build new UI from `src/components/ui/*` and the existing tokens.
- **Saffron (`act`) marks actions only**: buttons, links, the active nav item and focus. Never use it for decoration, charts or status.
- Gap and verification states always use **text + icon + colour** (`GapTag`, `TrendTag`, `EvidenceChip`). Never colour alone.
- **One idea per card. Never nest cards.** No eyebrow or kicker labels above headings, no gradient text, no glass effects, no coloured side borders on cards.
- Any new screen or substantial UI change must go through the `/impeccable` skill (`.claude/skills/impeccable`). An extension inherits the established world: run `impeccable context`, then the relevant command (`shape`, `polish`, `audit`, …). Never start a new visual direction.
- After UI edits, run the detector once: `.claude/skills/impeccable/scripts/impeccable detect --json <changed files>`.

### 1.2 Tech stack: fixed

| Concern | Locked choice |
| --- | --- |
| Framework | Next.js 16 App Router, React 19, TypeScript, React Compiler, **Cache Components** |
| Request gate | **`src/proxy.ts`** (Next.js proxy). **Never create `middleware.ts`.** |
| Styling | Tailwind CSS v4 with tokens in `globals.css` |
| Database | PostgreSQL 17 + **pgvector**, **Drizzle ORM** + drizzle-kit migrations |
| Cache / queue | **Redis 7** via ioredis, **BullMQ** for background jobs |
| Auth | **Better Auth** (demo email/password + generic OIDC) |
| LLM | **OpenRouter** through `src/server/llm/adapter.ts` only |
| Validation | Zod 4 |
| Charts / drag-and-drop | Recharts, dnd-kit |
| Tests | Vitest + fast-check (unit/property), Playwright (e2e), Playwright CLI (page review) |
| Lint / format | Biome |
| Package manager | npm (`package-lock.json`) |

Adding a dependency is allowed only when it serves a `PLAN.md` task, fits this stack, and is recorded in the README changelog. Replacing any row above is not allowed.

### 1.3 Folder structure: fixed

```
.
├── AGENTS.md / CLAUDE.md / PLAN.md / README.md / PRODUCT.md / DESIGN.md
├── docker-compose.yml          # Postgres (pgvector) :5434, Redis :6380
├── drizzle/                    # generated SQL migrations (+ custom guards)
├── policy/                     # versioned institution policy files (§3.1)
├── docs/reference/             # source blueprint PDF
├── scripts/                    # seed and one-off scripts
├── e2e/                        # Playwright end-to-end tests
├── .claude/skills/impeccable/  # design skill (do not edit)
├── .impeccable/                # design context: surface briefs, design.json
└── src/
    ├── proxy.ts                # optimistic session gate (no middleware.ts)
    ├── app/                    # routes only: pages, layouts, server actions, route handlers
    │   ├── sign-in/
    │   ├── student/            # passport, what-if, quests, consent, onboarding
    │   ├── admin/              # approvals, dashboard, counseling-kanban, students/[id], audit-report
    │   ├── leaderboards/
    │   └── api/                # auth/[...all], health, v1/* (§11)
    ├── components/
    │   ├── ui/                 # primitives (Button, Card, Tag, EvidenceChip, Switch, Skeleton…)
    │   ├── shell/              # AppShell, navigation
    │   └── passport|staff|what-if|consent|onboarding/   # feature components
    ├── lib/                    # client-safe helpers (format, labels, cn, auth-client)
    ├── server/                 # server-only domain code
    │   ├── rules/              # PURE rules engine (no I/O, no clock, no network)
    │   ├── policy/             # policy schema + loader
    │   ├── llm/                # prompt, adapter, validator, fallback, narrative
    │   ├── consent/            # access matrix (§13.1)
    │   ├── services/           # use cases (evaluations, approvals, cohort, passport…)
    │   ├── db/                 # Drizzle client + schema/
    │   ├── auth/               # Better Auth, roles, session DAL
    │   ├── cache/ queue/       # Redis helpers, BullMQ registry
    │   ├── verification/ ingestion/ embeddings/ notifications/ storage/ audit/ api/
    │   └── env.ts logger.ts
    └── workers/                # BullMQ worker process (npm run worker)
```

New code goes into the existing folder that owns that concern. Do not add top-level folders, move modules, or create parallel structures (`utils/`, `helpers/`, `features/`, `pages/`, `middleware.ts`) without the user's approval.

---

## 2. Documentation rule: every change goes in the README

Every change that adds, removes or alters behaviour, dependencies, schema, routes, environment variables or UI gets a dated entry under **Changelog** in [`README.md`](README.md), in the same change. Format:

```
### YYYY-MM-DD: <short title>
- What changed and why (link the PLAN.md task / § section)
- Migrations, env vars or scripts the reader must run
```

Also tick the matching checkbox in `PLAN.md`. A change without a README entry is incomplete.

---

## 3. Reviewing pages: use the Playwright CLI

UI work is not done until the rendered page has been reviewed in a real browser with the **Playwright CLI** (`@playwright/cli`, installed as a dev dependency; config in `.playwright/cli.config.json`).

```bash
npm run dev                                   # http://localhost:3100
npx playwright-cli open http://localhost:3100/sign-in
npx playwright-cli snapshot                   # accessibility tree with element refs
npx playwright-cli click <ref>                # e.g. a demo-account button
npx playwright-cli screenshot --full-page --filename .impeccable/review/<page>-desktop.png
npx playwright-cli resize 390 844             # then capture <page>-mobile.png
npx playwright-cli close
```

- Check desktop (1440) and mobile (390) in one batched round, fix everything found, then confirm with at most one more round.
- Confirm no horizontal overflow: `npx playwright-cli eval "document.documentElement.scrollWidth"` should equal the viewport width.
- Check the console log the CLI writes to `.playwright-cli/` for errors.
- First run only: `npx playwright-cli install-browser chromium`.

---

## 4. Domain rules (from the reference plan)

1. **Numbers come from code and policy, never from the model** (§1.3, §9.1). Scores, AEG index, personas, trends, pivots and routes are computed in `src/server/rules`. The LLM writes narrative only, and every sentence cites `[ev:ID]`.
2. **`src/server/rules` is pure.** It must not import `db`, `cache`, `queue`, `llm`, `next/*` or Node I/O, and must not read the clock (pass `asOf` in). The golden tests in `src/server/rules/__tests__/golden.test.ts` reproduce §20 and must stay green.
3. **No hardcoded thresholds.** Every weight, band, floor and SLA lives in `policy/*.json`, validated by `src/server/policy/schema.ts`.
4. **A human approves every intervention.** Interventions are created only as `PENDING_APPROVAL`. Nothing is dispatched without a decision and a consent check.
5. **Authorize in the data access layer on every request** (`src/server/auth/session.ts`). `proxy.ts` is only an optimistic redirect. Student endpoints ignore ids in the path and act on the signed-in student.
6. **Consent and access** follow the matrix in `src/server/consent/matrix.ts` (§13.1). The Command Center shows aggregates only and is never merged with the student deep-dive. Deep-dives require a reason code.
7. **Audit** every read of personal data, approval, policy change and export (`src/server/audit/log.ts`). `audit_events`, `consent_records`, `evaluations`, `artifact_status_events` and `counseling_card_moves` are append-only (DB triggers).
8. **Student-facing language** (§14.3): never show persona names, "drifting", "at risk", "failing", "lazy", "you must" or "topper". Use the phrasing in `src/lib/labels.ts`.
9. **Privacy:** LLM requests carry pseudonymous IDs only, never names, roll numbers or contacts. Untrusted student text is sanitized and fenced (`src/server/llm/prompt.ts`).
10. **Synthetic data only.** Never commit real student data. Label demo data as synthetic.

11. **Sessions and sign-in security** (§13.2) are part of the locked stack. Never weaken them:
    - Authorize only through `requireUser` / `requireApiUser` / `requireStudent` (`src/server/auth/session.ts`). They also enforce the idle timeout.
    - Never put credentials, secrets or the demo password in client code or `NEXT_PUBLIC_*` variables.
    - Don't re-enable sliding session refresh, raise timeouts in code (use `SESSION_*` env vars), or bypass the lockout and rate limits.
    - New auth outcomes must write an audit event. Store a hash of an email, never the raw email, when the actor is anonymous.
    - Keep the security headers in `next.config.ts` and `Cache-Control: no-store` for protected routes in `proxy.ts`.

## 5. Next.js 16 specifics used here

- Cache Components is on: anything reading `cookies()`, `headers()`, `params`, `searchParams` or uncached DB data sits inside `<Suspense>`. Pattern: a sync page renders a `<Suspense>` around an async content component.
- Auth interrupts (`forbidden()`, `unauthorized()`) are enabled; `src/app/forbidden.tsx` and `unauthorized.tsx` render them.
- `server-only` modules (DAL, API helpers) must not be imported by workers or client components. Shared server code (`rules`, `services`, `db`, `llm`) avoids `server-only` so BullMQ workers can use it.

## 6. Definition of done

- [ ] `npm run check` passes (Biome + `tsc` + Vitest)
- [ ] `npm run build` passes
- [ ] UI changes reviewed with the Playwright CLI at 1440 and 390, with no overflow and no console errors
- [ ] `README.md` changelog entry added; `PLAN.md` checkbox ticked
- [ ] No change to the locked design, stack or folder structure
