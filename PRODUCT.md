# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 (App Router, `proxy.ts`, Cache Components), TypeScript, Tailwind CSS v4, PostgreSQL 17 with pgvector, Drizzle ORM, Redis (cache) with BullMQ (queues), Better Auth (seeded demo accounts per role plus a generic OIDC provider enabled by environment variables), OpenRouter as the LLM provider behind a single narrative adapter. Fixed by the user; see `AGENTS.md` for the lock rules.

## Users

Primary loop for the first build, confirmed by the user: the **faculty mentor** and the **student**.

- **Faculty mentor** — opens the tool between classes or in a scheduled mentoring slot to answer "which of my students need attention, and what should I say?" Works the approval queue, the counseling Kanban and the one-page mentor brief. Must be able to approve, edit or reject a proposed intervention in under a minute and trust every number because it links to its evidence.
- **Student** — returns to their passport roughly weekly, mostly on a phone, to answer "what is the next step toward my goal?" Sees track score, gap, trend, data gaps turned into quests, a what-if simulator, and a consent center that controls who sees what.

Secondary roles specified in the reference plan (not optimised first): class advisor, dean/HOD, placement cell officer, E-Cell coordinator, sports/NCC officer, registrar/admin, auditor (NAAC, KPMG), alumni mentor.

## Product Purpose

AspirEdge AI is a multi-track career alignment platform for an Indian university. Each student declares a career track and an aspiration (target outcome, target date, readiness level). The platform collects verified evidence of execution from sources the institution already has (ERP academic records, the internal mock-test platform, the student's own links and certificates), scores it against a discipline-specific rubric in code, measures the Aspiration-Execution Gap (AEG), and proposes a short action plan. A named mentor approves every intervention before it happens.

Success: mentors act on fewer, better-targeted cases; students see a concrete next step instead of a verdict; every number is reproducible from its policy version and evidence.

## Positioning

Deterministic scoring with an explaining, not deciding, language model. Scores, the AEG index, persona flags, trends and routing come from a versioned, institution-owned policy file and a pure rules engine; the LLM only writes narrative from already-validated facts, with every sentence citing an evidence reference `[ev:ID]`. Department-specific standards (Mechanical, Commerce, Biotech, Law, CS, EEE, Civil) remove the usual CS bias of placement tools. Consent is granular per data category and recipient, and nothing reaches a student or a third party without a human approval.

## Operating Context

- Nightly cohort refresh: ERP exports, GitHub API, Crossref and uploads flow through ingestion, verification workers, the rules engine, the LLM adapter and the validator, then into the approval queue behind a consent check. A single student can be re-evaluated on demand ("Run Eval").
- Six career tracks: Corporate Placement (fully specified first), Higher Studies and Research, Entrepreneurship and Startups, Public Service and Government Exams, Freelance and Creator Economy, Sports/Defense/NCC.
- Evidence moves through verification states: SUBMITTED, UNDER_CHECK, VERIFIED, ATTESTED, LIVE_UNVERIFIED, SELF_REPORTED, UNVERIFIED, REJECTED, STALE, each with a score multiplier.
- Interventions are routed by persona (Detention Threat Builder, Aspiration Mismatch, False-Positive High Flyer, Drifting Student, Watch band, Integrity flag) with SLAs and closure rules; the counseling Kanban has columns Referred, Scheduled, In conversation, Plan active, Follow-up due, Closed, with a work-in-progress limit of 25 per mentor.
- Auditors print a NAAC/KPMG audit report stamped with the policy version.
- Governed by India's Digital Personal Data Protection Act, 2023.

## Capabilities and Constraints

- Rules engine is pure code with no network access; same inputs and policy version always give the same outputs. The LLM can never change a number, flag or recipient.
- Policy file (thresholds, weights, persona parameters) is versioned with an effective date; persona changes need two approvals; evaluations are immutable.
- Role-based access matrix (reference plan Table 13.1); student deep-dives require a logged reason code; every read of personal data writes an append-only audit event.
- Persona names are internal and never shown to students. Student-facing language follows the reference plan's language standards (Table 14.3): no "drifting", "at risk", "failing", "lazy", "you must", "topper".
- Command Center (aggregate planning) and Student Deep-Dive (individual conversation) must never be merged into one view.
- No individual list exports; no recruiter-facing export; staff cannot set a persona manually.
- Wellbeing rules are narrow: no diagnosis, no free-text emotional storage; nudges always show campus counseling and emergency contacts.
- Undecided (reference plan Section 21; defaults used and marked provisional): attendance rule source, CGPA scale (10-point default), names of tracks 1–3, High Flyer floor, hosting location (India-region default), model vendor/version pin, leaderboard default (off), mentor access to non-assigned students, demographic data for fairness checks.

## Brand Commitments

- Name: **AspirEdge AI**. No third-party logos or brand systems (confirmed: no KPMG or institution branding in the UI).
- Voice: warm, specific, second-person for students; describes the gap in terms of the next step. Neutral, evidence-first for staff.

## Evidence on Hand

- Reference plan: `docs/reference/AspirEdge_Deep_Plan.pdf` (v2.0, 11 October 2026, draft for review).
- Seven synthetic seed records (SYN-01 to SYN-07) and three hand-worked examples (ME-27, CS-44, EE-12) from the reference plan. All demo data is synthetic and must be labelled as such.
- No real students, testimonials, institutions, customers, metrics or pilot results exist yet. Do not fabricate them.

## Product Principles

1. Deterministic where it matters — numbers come from code and policy, never from the model.
2. Evidence over claims — every figure links to its source and verification state.
3. A human approves every intervention — the UI makes approval fast, never automatic.
4. Minimum data, explicit consent — each view shows only the fields its role and the student's consent allow.
5. Support, not surveillance — language and controls keep the tool out of disciplinary use.

## Accessibility & Inclusion

WCAG 2.1 AA on every student and staff screen. Color never carries meaning alone (AEG levels use text + icon + color). Charts have a text summary and a table toggle. The Kanban supports keyboard moves with screen-reader announcements. The passport is mobile first; gauges collapse to numbers on small screens. Animations respect reduced motion. BMI is never displayed as a number.
