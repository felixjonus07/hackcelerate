# Decisions log (§21)

The ten open decisions in the plan (§21, Table 21). **Until the owner records a decision, the proposed default is in force and is marked `provisional` in the policy file** (`policy/2026.10-v1.json`, status `DRAFT`). This log records who decides, what the code does today, and when the decision was made.

Status values: **Default in force** (nobody has decided yet), **Decided** (owner confirmed; fill in the date and the person).

| # | Decision | Owner | Default in force (what the code does) | Where it lives | Status | Decided on |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Attendance rule source | Registrar | Platform defaults: 75 % requirement, 65 % condonation floor | `policy → attendance` | Default in force | _pending_ |
| 2 | CGPA scale | Registrar | 10-point scale | `policy → academic` | Default in force | _pending_ |
| 3 | Confirm tracks 1–3 | Placement cell and E-Cell | Corporate Placement, Higher Studies and Research, Entrepreneurship | `policy → tracks` | Default in force | _pending_ |
| 4 | High Flyer index floor | Dean | MODERATE; the placement route handles urgency | `policy → personas` | Default in force | _pending_ |
| 5 | Hosting location | IT head | India-region cloud for the pilot | deployment docs (not in this repo yet) | Default in force | _pending_ |
| 6 | Persona names visible to students | Student affairs | Never shown; students see gaps and suggestions | `src/lib/labels.ts`, `src/lib/language.ts`, language linter test | Default in force | _pending_ |
| 7 | Model vendor and version | Engineering lead | Pinned per term through `OPENROUTER_MODEL`; golden set and `npm run llm:report` before any change | `.env`, `scripts/llm-report.ts` | Default in force | _pending_ |
| 8 | Leaderboard default | Student affairs | Off for new students; opt-in per student | `policy → leaderboard`, consent centre | Default in force | _pending_ |
| 9 | Mentor access to non-assigned students | Dean | Allowed with a reason code; logged and reviewable in the audit report | `src/server/consent/matrix.ts` | Default in force | _pending_ |
| 10 | Demographic data for fairness checks | Legal and governance committee | Collected only with consent, stored in a separate table, never used in scoring | fairness service, Phase 10 | Default in force | _pending_ |

## Other items that need a named human before the pilot

These are not in §21 but the plan makes them preconditions. None of them can be settled by code.

| Item | Owner | Why it is open |
| --- | --- | --- |
| Model provider data-retention and training terms, in writing | Engineering lead | Phase 5 task; needs the provider's confirmation |
| DPDP obligation mapping reviewed by compliance; current commencement dates confirmed | Compliance officer | `docs/dpdp-mapping.md` is a design aid, not legal advice |
| Penetration test before the pilot | Security lead | Needs an external tester |
| Retention periods (§13.5) reviewed | Legal and registrar | All periods are proposals |
| Fairness thresholds (0.8–1.25) adopted or replaced | Governance committee | Proposals only; a disparity never triggers an automatic change |
| Mentor usefulness rating (≥ 4 of 5) | Pilot mentors | Needs real mentors reading real briefs |
| Nonce-based CSP | Engineering lead | Blocked by Cache Components (static shells are cached, so a per-request nonce cannot be injected). Needs a decision to drop the task or accept `'unsafe-inline'` for scripts. See `next.config.ts` |
| Provisional policy values introduced by the build (required-evidence weights, Cooper bands, BMI band scores, minimum credits, `cohort.artifact_score_full_weight`, the LOW missing-weeks limit) | Registrar and the track owners | Listed in the policy file's `provisional` array |

## How to record a decision

1. Edit the row above: set Status to **Decided**, add the date and the owner's name.
2. If it changes a number, create a policy draft in the registrar policy editor (`/admin/policy`), get the two approvals (registrar and dean for persona changes) and activate it. Remove the item from the `provisional` array in the new version.
3. Add a README changelog entry.
