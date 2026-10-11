# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- The rules above (imported from `AGENTS.md`) are binding: **no change to the `/impeccable` UI design, the tech stack or the folder structure**; **every change documented in `README.md`**; **pages reviewed with the Playwright CLI**.
- Work from `PLAN.md`: take the first unchecked task in the earliest open phase.
- For any UI work, invoke the `impeccable` skill (`/impeccable <command> <target>`). It is installed at `.claude/skills/impeccable` with its agents in `.claude/agents/`. Do not edit the skill files.
- Use `npx playwright-cli` (not ad-hoc scripts) to open, snapshot and screenshot pages. Save captures under `.impeccable/review/` (gitignored).
- Local services: `npm run db:up` (Postgres 5434, Redis 6380), app on port 3100. Ports 3000, 5432, 5433 and 6379 on this machine belong to other projects; don't use them.
- Before committing, run `npm run check` and `npm run build`.
