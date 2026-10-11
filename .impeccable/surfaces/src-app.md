---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: ["src/components"]
---

# Surface brief: AspirEdge app (student + staff shells)

Scope: the authenticated app — student passport, onboarding, what-if, quests, consent center; staff approvals, command center, counseling board, student deep-dive, audit report. Mode: **Operate**. Build path: code-led.

Audience and job: faculty mentor (laptop, staff room, between classes) works the approval queue and counseling board; student (phone, weekly) checks score, gap, next step and who sees their data. Constraints: PRODUCT.md (WCAG 2.1 AA, persona names never shown to students, Command Center aggregate-only, every number linked to evidence).

## Direction contract

THESIS: AspirEdge as an app students already know by thumb: one idea per card, plain words, and one bright colour that appears only where something can be pressed. Refuses the grey KPI-tile analytics dashboard and the neon "AI" console.

OWN-WORLD: warm sand ground, white cards with 20–24px radii and soft offset shadows, cocoa ink; saffron is the only saturated colour and marks actions alone (buttons, links, active nav pill, focus). Gap and verification states use leaf, ochre and brick labels with icon plus text, never saffron. Nunito Sans everywhere, tabular figures for data.

STORY: the student sees where they stand, the single next step and who sees their data; the mentor sees who needs attention, why (every fact evidence-linked), and approves, edits or rejects in one tap.

FIRST VIEWPORT: desktop has a 260px sand side nav (brand, role items, active item a white pill), a greeting heading, then a two-column card grid: score card (large tabular score, readiness bar with target tick, gap tag) beside the next-step card holding the saffron primary action; quests and evidence cards below. Mobile is one column with a persistent bottom bar. Staff screens use the same shell: queue cards left, brief card right.

FORM: Warm Consumer App (catalog challenger digital-design-canon-warm-consumer-app-surface), chosen by the user over the assigned direction; seed key 75d1ab63. Signature interaction: soft spring press on actionable cards and buttons, and a readiness bar whose fill and target tick glide when the what-if sliders move.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Dark theme: light is primary (daylight staff rooms, phones outdoors); dark follows `prefers-color-scheme` with the same roles.
- Verification encoding must stay one consistent chip vocabulary across screens (the chosen form's known risk is that the evidence mechanism goes invisible).
