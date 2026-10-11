# Demo script, backup recording and slides outline

Total run time: **7 minutes**. All data is synthetic and labelled so. Rehearse twice; the backup recording is the fallback if the live app, network or model is unavailable (§19).

## Before you start (5 minutes)

```bash
npm run db:up
npm run db:reset          # migrate and reseed: DEMO_LOGIN_ENABLED=true and DEMO_PASSWORD set in .env
npm run dev               # http://localhost:3100
npm run worker            # second terminal, for the evaluation and notification queues
```

- Sign in once as every account you will use and sign out, so the sign-in rate limit is not a surprise on stage.
- Offline model: with no `OPENROUTER_API_KEY` the app uses rules-only narratives. Say so; it is a feature (the fallback), not a failure.
- Accounts (all share `DEMO_PASSWORD`): `student@`, `mentor@`, `registrar@`, `auditor@`, `dean@`, `advisor@`, `placement@`, `ecell@` at `aspiredge.example`.

## The story (7 minutes)

| Min | Screen | Say | Show |
| --- | --- | --- | --- |
| 0:00 | Slide 1 | A student says "I want a corporate placement." Nothing in the system knows whether they are doing the work. | The gap between what is declared and what is evidenced |
| 0:45 | `/student/passport` as **student** | The score comes from code and policy, never from the model. Every item has a verification state with text, icon and colour. | Readiness, the gap tag, "Not enough evidence yet" on a gated track, evidence chips |
| 1:45 | `/student/what-if` | What if I add the missing certificate? The same rules engine answers, instantly, with no side effects. | Move a slider; the score and gap change |
| 2:30 | `/student/quests` | One short action at a time, with a clock the student controls. | Accept a quest; add evidence with a link |
| 3:00 | `/student/consent` | The student decides who sees what. Leaderboards are off by default. | Toggle a share; show the recorded history |
| 3:45 | `/admin/approvals` as **mentor** | A named human approves every intervention. The brief lists three facts, each linked to its source, plus data gaps and two questions to ask. | Open a fact link; approve. Point out consent is checked again at dispatch |
| 5:00 | `/admin/dashboard` | Aggregates only. A deep-dive needs a reason code, and it is logged. | Cohort view; then open a student with a reason |
| 5:45 | `/admin/audit-report` as **auditor** | Policy version, draft warning, sampled records, every read logged. | Print preview; JSON export |
| 6:30 | Slide: governance | Policy lives in a versioned file. Changes need two approvals. Fairness and wellbeing are measured, not assumed. | Registrar policy editor, if time allows |

## If something breaks

1. Live data odd: `npm run db:reset`, reload. Takes about 40 seconds.
2. Sign-in locked: wait the lockout window or reseed.
3. App down: play the backup recording from the same point in the table.
4. Never improvise numbers. If asked how a score was computed, open the student record and read the component breakdown.

## Backup recording

Record the full 7-minute run on the seeded data **after the last code change**, with the Playwright CLI or any screen recorder at 1440×900, no notifications visible.

- Save as `docs/demo-backup.mp4` outside git (the repo does not store large binaries; keep it on the demo laptop and a USB drive).
- Re-record whenever a screen changes.
- Status: **not yet recorded** (human task).

## Slides outline (8 slides)

1. **The gap**: declared aspiration versus verified execution.
2. **What AspirEdge does**: one evidence-based passport per student, six tracks, a single scoring method.
3. **How it scores**: rules in code and policy; the model writes narrative only and cites evidence.
4. **A human approves everything**: the mentor brief, SLA, consent at dispatch.
5. **Privacy by design**: consent matrix, reason-coded reads, append-only audit, DPDP mapping.
6. **Fairness and wellbeing**: flag-rate ratios by group, nudges with counseling contacts, language standards.
7. **Proof**: golden set of 60 records, property tests, authorization matrix, five-journey smoke test, accessibility checks.
8. **Path to pilot**: shadow mode, open decisions with owners, what is blocked on people (see `docs/decisions.md`).

Status: **outline only; slides not yet made** (human task).
