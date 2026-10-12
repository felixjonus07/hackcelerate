# DPDP Act 2023: obligation mapping to the build (§13.4)

A design aid, not legal advice. The Act's rules come into force in phases, so the compliance officer must confirm the current commencement dates before the pilot. **Review status: not yet reviewed by compliance** (PLAN.md Phase 9, human task).

| Obligation | How the product meets it | Where in the code | Test |
| --- | --- | --- | --- |
| **Notice** | Plain-language notice at onboarding listing categories, purposes and recipients; acknowledgement is recorded | `src/components/onboarding/wizard.tsx`, `src/server/services/onboarding.ts` | `student-experience.test.ts`, journey 1 |
| **Consent** | Granular, withdrawable, per category and recipient; no bundled consent; checked again at dispatch | `src/server/consent/matrix.ts`, `src/server/services/consent.ts`, `src/server/services/dispatch.ts`, `src/components/consent/` | `matrix.test.ts`, `interventions.test.ts`, journey 4 |
| **Purpose limitation** | Every read of personal data carries a reason code; reads outside the stated purpose are refused | `src/server/consent/matrix.ts`, `src/server/audit/log.ts` | `matrix.test.ts`, authorization e2e |
| **Data minimization** | ERP import maps only declared columns; LLM requests carry pseudonymous IDs only; roll numbers live in a restricted table | `src/server/ingestion/`, `src/server/llm/prompt.ts`, `src/server/db/schema/people.ts` | `erp.test.ts`, `adversarial.test.ts` |
| **Accuracy** | Students see their baseline data and can request a correction, which routes to the registrar (ERP) or the mentor of record (narrative) and re-runs the evaluation | `src/server/services/rights.ts`, onboarding baseline step | `student-experience.test.ts` |
| **Storage limitation** | Retention schedule applied by a scheduled job; dry-run mode for review | `src/server/services/retention.ts` | `wellbeing-retention.test.ts` |
| **Security safeguards** | Role-based access in the data-access layer, session idle/absolute timeouts, lockout and rate limits, append-only audit log (DB triggers), security headers, `no-store` on protected routes. Penetration test is still to be done | `src/server/auth/session.ts`, `src/proxy.ts`, `next.config.ts`, `drizzle/` guards | `session-policy.test.ts`, `guards.test.ts`, `security.spec.ts`, `authorization.spec.ts` |
| **Breach response** | Needs a documented incident process owned by the compliance officer. Not code | n/a | n/a |
| **Rights of individuals** | Access export, correction routing and erasure checked against the retention schedule; outcome explained in writing | `src/server/services/rights.ts`, `src/server/services/retention.ts` (`executeErasure`), `/admin/requests` | `student-experience.test.ts` |
| **Grievance redressal** | Named grievance officer in the footer of every signed-in screen | `src/components/shell/shell-footer.tsx`, `policy → institution` | smoke e2e |
| **Children's data** | Date of birth checked at onboarding; under 18 requires verifiable parental consent before processing | `src/server/services/parental.ts` | `student-experience.test.ts` |
| **Significant data fiduciary** | Only if the institution is designated. Would add periodic impact assessments and independent audits. Not code | n/a | n/a |

## Retention schedule in force (§13.5, proposed periods)

Applied by `runRetention` in `src/server/services/retention.ts`. All periods need legal and registrar review before the pilot.

| Data | Retention |
| --- | --- |
| ERP records (ingested copies) | Current academic year plus one |
| Artifacts and uploaded certificates | 90 days after verification |
| Evaluations and narratives | 12 months after graduation; aggregates kept |
| Interventions and approvals | Three years after closure |
| Mock attempt raw answers | 12 months; scores and percentiles kept |
| Consent history | Life of the student record plus the audit period |
| Audit events | Seven years; archived and restricted to auditors |

## Open items

- Compliance officer reviews this table and confirms commencement dates.
- Penetration test.
- Incident-response process and Data Protection Board notification path.
- Whether the institution is a significant data fiduciary.
