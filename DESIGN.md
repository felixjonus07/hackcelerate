---
name: AspirEdge AI
description: Career alignment for students and mentors, built as a warm consumer app where one bright colour marks what can be pressed.
colors:
  sand: "#f6efe7"
  sand-2: "#efe5d9"
  sand-3: "#e6d9ca"
  card: "#ffffff"
  line: "#eadfd3"
  ink: "#2b2420"
  ink-2: "#6f6259"
  act: "#c2490b"
  act-hover: "#a93e08"
  act-bright: "#f26b1d"
  act-soft: "#fff1e8"
  act-ink: "#ffffff"
  low: "#2f6b2c"
  low-bg: "#e4f1e1"
  mod: "#8a5a00"
  mod-bg: "#fbefd2"
  crit: "#a2312a"
  crit-bg: "#fbe4e0"
  mark: "#9c8a7b"
  series-1: "#2b2420"
  series-2: "#5f7f6a"
  series-3: "#8a6d4b"
  series-4: "#7d5a50"
  series-5: "#a89077"
  series-6: "#4e6151"
  series-7: "#c8b9a6"
typography:
  display-score:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  display-hero:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.9rem"
    fontWeight: 900
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title-lead:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 800
    lineHeight: 1.375
  title:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 800
    lineHeight: 1.375
  body:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-compact:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.43
  button:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1
  tag:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 700
    lineHeight: 1
  nav-micro:
    fontFamily: "Nunito Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    lineHeight: 1.2
rounded:
  card: "22px"
  inset: "16px"
  field: "14px"
  pill: "9999px"
spacing:
  gutter: "16px"
  gutter-sm: "24px"
  gutter-lg: "32px"
  card-pad: "20px"
  card-pad-sm: "24px"
  grid-gap: "20px"
  stack: "16px"
  side-nav: "260px"
  content-max: "1320px"
components:
  button-primary:
    backgroundColor: "{colors.act}"
    textColor: "{colors.act-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.act-hover}"
    textColor: "{colors.act-ink}"
  button-secondary:
    backgroundColor: "{colors.sand-2}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.sand-3}"
    textColor: "{colors.ink}"
  button-ghost:
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-ghost-hover:
    backgroundColor: "{colors.sand-2}"
  button-danger:
    backgroundColor: "{colors.card}"
    textColor: "{colors.crit}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.crit-bg}"
    textColor: "{colors.crit}"
  button-small:
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "36px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-pad}"
  inset-panel:
    backgroundColor: "{colors.sand}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inset}"
    padding: "24px 20px"
  field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0 14px"
    height: "44px"
  tag-neutral:
    backgroundColor: "{colors.sand-2}"
    textColor: "{colors.ink-2}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  tag-low:
    backgroundColor: "{colors.low-bg}"
    textColor: "{colors.low}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  tag-mod:
    backgroundColor: "{colors.mod-bg}"
    textColor: "{colors.mod}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  tag-crit:
    backgroundColor: "{colors.crit-bg}"
    textColor: "{colors.crit}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  nav-item:
    textColor: "{colors.ink-2}"
    typography: "{typography.button}"
    rounded: "{rounded.field}"
    padding: "12px 14px"
  nav-item-active:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "12px 14px"
  bottom-nav-item:
    textColor: "{colors.ink-2}"
    typography: "{typography.nav-micro}"
    rounded: "{rounded.inset}"
    padding: "8px 0"
  bottom-nav-item-active:
    textColor: "{colors.act}"
  switch-on:
    backgroundColor: "{colors.act}"
    rounded: "{rounded.pill}"
    width: "48px"
    height: "28px"
  switch-off:
    backgroundColor: "{colors.sand-3}"
    rounded: "{rounded.pill}"
    width: "48px"
    height: "28px"
  readiness-track:
    backgroundColor: "{colors.sand-2}"
    rounded: "{rounded.pill}"
    height: "12px"
  readiness-fill:
    backgroundColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    height: "12px"
---

# Design System: AspirEdge AI

## Overview

**Creative North Star: "The Thumb-Known App"**

AspirEdge reads like an app students already know by thumb: a warm sand ground, white cards with generous rounded corners, cocoa ink, and plain words. Each card carries one idea (where you stand, the next step, your evidence, who sees your data) so the student reads a screen in seconds and the mentor works a queue without hunting. Density is comfortable rather than compact; whitespace and card edges do the grouping, not rules and boxes.

Saffron is the one saturated colour in the system and it appears only where something can be pressed: primary buttons, links, the active bottom-bar item, switches that are on, and the focus ring. Every judgement the product makes (gap level, verification state, trend) is carried by leaf, ochre and brick labels that always pair an icon with words, so meaning never rests on colour alone. Numbers are set in heavy tabular figures and every one of them sits next to its evidence.

The system rejects the grey KPI-tile analytics dashboard and the neon "AI" console. There is no gradient text, no glass, no glow beyond the soft lift under the primary button, and no small all-caps kicker above headings.

**Key Characteristics:**
- Warm sand ground, white cards (22px corners) with soft, low-offset shadows.
- One saturated colour, saffron, reserved for actions.
- Leaf / ochre / brick state labels, always icon plus text.
- Nunito Sans throughout, heavy weights for headings and scores, tabular figures for data.
- Pill-shaped buttons and tags; a soft spring on press.
- Light theme first, with a matched dark theme that follows the system setting.

## Colors

A warm, low-chroma sand-and-cocoa palette with a single saffron accent and three muted state hues.

### Primary
- **Saffron** (#c2490b, token `act`): the action colour. Primary button fill, text links ("See all", "Full record"), the active bottom-bar item, a switch that is on, input caret and native accent. Never a state, never decoration.
- **Deep Saffron** (#a93e08, `act-hover`): hover fill for primary buttons.
- **Bright Saffron** (#f26b1d, `act-bright`): the 3px focus ring, and the dot in the brand mark.
- **Saffron Wash** (#fff1e8, `act-soft`): text selection and the hover wash behind text-style action buttons.
- **On Saffron** (#ffffff, `act-ink`): label colour on saffron fills.

### Secondary (state hues)
- **Leaf** (#2f6b2c on #e4f1e1, `low` / `low-bg`): low gap, verified and attested evidence, improving trend, success confirmations.
- **Ochre** (#8a5a00 on #fbefd2, `mod` / `mod-bg`): moderate gap, live-but-unverified or stale evidence, inactivity warnings.
- **Brick** (#a2312a on #fbe4e0, `crit` / `crit-bg`): critical gap, rejected or unverified evidence, worsening trend, errors, the danger button label.

### Neutral
- **Sand** (#f6efe7, `sand`): the page ground, the side nav ground, inset panels inside cards, empty states.
- **Dune** (#efe5d9, `sand-2`): secondary button fill, neutral tags, readiness track, skeletons, nav hover.
- **Deep Dune** (#e6d9ca, `sand-3`): secondary button hover, switch off, dashed drop zones, scrollbar thumb.
- **Card White** (#ffffff, `card`): every card, fields, the active side-nav pill, the mobile bottom bar.
- **Seam** (#eadfd3, `line`): hairline dividers between list rows, field borders, the bottom bar's top edge.
- **Cocoa Ink** (#2b2420, `ink`): all primary text, headings, scores, the readiness target tick, the brand tile.
- **Muted Cocoa** (#6f6259, `ink-2`): secondary text, hints, inactive nav, the readiness fill.
- **Data Mark** (#9c8a7b, `mark`): neutral data marks such as "too early" / insufficient-data segments; holds 3:1 against white.

### Chart series
Seven earth tones from the same sand/cocoa family (`series-1` #2b2420 through `series-7` #c8b9a6), used in order for categorical charts (the track donut). Saffron is never a series colour.

### Dark theme
Dark follows `prefers-color-scheme` with the same roles; light is primary. Values: sand #1c1714, sand-2 #251f1b, sand-3 #30281f, card #26201c, line #3a312b, ink #f3eae0, ink-2 #bfaf9f, act #f26b1d, act-hover #ff8a45, act-bright #ff8a45, act-soft #3a2416, act-ink #1c1714 (dark label on saffron), low #9fd39a on #20331f, mod #f1c56a on #3a2e14, crit #f4a199 on #3d1f1c, series-1..7 #f3eae0, #8fb39a, #c7a47a, #c08b7d, #a89077, #7d9a82, #6b5d50. `mark` keeps its light value.

### Named Rules
**The Saffron Means Press Rule.** Saffron marks actions alone: buttons, links, the active nav indicator, an on switch, focus. A score, a gap, a chart series or a heading is never saffron. The brand-mark dot is the only non-action use.

**The Words-and-Icon Rule.** Every state is text plus icon plus colour. A leaf, ochre or brick hue without its label and icon is a defect.

**The Tokens-in-One-Place Rule.** Colour values live only in `src/app/globals.css` as custom properties and are used through their utilities or `var()`. Components never carry inline hex. (The browser `themeColor` metadata, which cannot read CSS variables, is the one mirror of `sand`.)

## Typography

**Display Font:** Nunito Sans (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Nunito Sans
**Label/Mono Font:** Nunito Sans with tabular figures for data

**Character:** One rounded humanist sans carries everything; hierarchy comes from weight (400 body, 700 labels and buttons, 800 card titles, 900 page titles and scores) rather than from a second family. Heavy weights read friendly, not loud, because the letterforms are soft.

### Hierarchy
- **Display score** (900, 3.5rem, line-height 1, -0.025em, tabular): the single big number on a score card. The what-if result uses 3.25rem, the staff deep-dive 3rem.
- **Display hero** (900, 2.4rem rising to 2.9rem from 640px, 1.08): the sign-in heading only, max 16ch.
- **Headline** (900, 1.75rem rising to 2rem from 640px, 1.25, -0.025em): page titles in the page header, followed by a muted one-line description capped at 65ch.
- **Title lead** (800, 1.45rem, 1.375): the next-step card heading, the one card that leads the page.
- **Title** (800, 1.05rem, 1.375): every card heading, with an optional 0.875rem muted hint beneath.
- **Body** (400, 1rem, 1.5): running text; long explanations cap at 46 to 65ch. **Body compact** (0.95rem) for summaries inside cards.
- **Label** (700, 0.875rem): field labels, figure captions such as "track score", evidence chips, meta lines.
- **Tag** (700, 0.8rem, line-height 1): pill tags.
- **Nav micro** (700, 0.72rem): bottom-bar item labels only.

### Named Rules
**The Tabular Numbers Rule.** Every score, weight, count and date in data uses tabular figures (`.tabular`) so columns and live-changing values never jitter.

**The No Kicker Rule.** Headings stand alone. No small uppercase or tracked label sits above a heading; context goes in the heading itself ("Next: ...") or in the hint below it.

## Layout

Mobile first. Below 1024px the app is one column: the brand sits top left, cards stack with 20px gaps, and a fixed white bottom bar (hairline top border, safe-area padding) carries the role's nav items. Content keeps 112px of bottom padding so the bar never covers it.

From 1024px the shell becomes a two-column grid: a 260px sticky side nav on the sand ground (brand, role items, the user's name and sign-out pinned to the bottom) and the main column. Main content is centred with a 1320px maximum width and gutters of 16px (phones), 24px (from 640px) and 32px (from 1024px).

Inside pages, content is a card grid: two equal columns at 1024px for student overview screens, and list-plus-detail splits for staff work (a flexible queue column beside a 360 to 380px brief column, or roughly 1:1.2 splits). The counseling board scrolls sideways with snap points inside its column below 1280px and becomes a six-column grid from 1280px; the page itself never scrolls horizontally. Page headers sit 24px above the grid; card headers sit 16px above card content. Card padding is 20px, 24px from 640px.

## Elevation & Depth

Depth is soft and ambient. Cards lift slightly off the sand ground with a two-part shadow: a tight 1px contact shadow and a wide, negatively spread blur that pools beneath. Everything else is flat and tonal: inset panels are sand on white, the side nav has no surface at all. A stronger lift appears only on state (a kanban card while dragged). The primary button carries its own faint saffron pool, which reads as "this can be pressed", not as decoration.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgb(43 36 32 / 0.05), 0 10px 28px -16px rgb(43 36 32 / 0.22)`): every card, the active side-nav pill, the selected queue item.
- **Lift** (`box-shadow: 0 2px 4px rgb(43 36 32 / 0.06), 0 16px 32px -14px rgb(43 36 32 / 0.28)`): an item being dragged.
- **Primary pool** (`box-shadow: 0 6px 16px -8px var(--act)`): primary buttons only.
- Dark theme swaps the cocoa shadow tint for black at higher opacity (card 0.3 / 0.6, lift 0.35 / 0.7).

### Named Rules
**The Flat Inside Rule.** Only cards cast shadows. Anything inside a card separates by tone (sand panel), a hairline, or spacing, never by a second shadow or a nested card.

## Shapes

Generously rounded, never sharp. Cards use 22px corners; inset panels, empty states, skeleton bars and kanban items use 16px; fields and side-nav items use 14px; buttons, tags, switches and the readiness bar are full pills. Borders are rare: a 1px seam on fields and dividers between list rows. The brand tile is a 9px-radius cocoa square with a sand chevron and a saffron dot.

## Components

### Buttons
Pill-shaped, bold and tactile; they compress slightly when pressed.
- **Shape:** full pill (9999px); 44px tall at medium, 36px at small.
- **Primary:** saffron fill, white label, 0 20px padding, with the primary pool shadow. Hover deepens to Deep Saffron. One primary per card at most; it is the card's single action ("Start quest", "Approve").
- **Secondary:** Dune fill, ink label; hover to Deep Dune. Used beside a primary ("Edit") or alone for low-stakes actions ("Add").
- **Ghost:** no fill, ink label; Dune wash on hover.
- **Danger:** white fill, brick label, 1px inset seam ring; brick wash on hover ("Reject"). Destruction is never filled.
- **Text action:** in-card links ("See all") are saffron 0.875rem bold text that underlines on hover; text-style buttons in cards add a Saffron Wash on hover.
- **Press / Focus / Disabled:** press scales to 0.97 on the spring curve (160ms); focus shows the 3px Bright Saffron outline offset 2px; disabled drops to 50% opacity with a not-allowed cursor.

### Tags
- **Style:** pill, 4px 10px padding, 0.8rem bold, tinted background with the matching dark text: neutral (Dune / Muted Cocoa), low (leaf), mod (ochre), crit (brick).
- **Gap tag:** low = circle-check, moderate = circle-dot, critical = triangle-alert, with student wording ("Moderate gap") or staff wording ("Moderate").
- **Trend tag:** arrow up-right (improving, leaf), arrow down-right (worsening, brick), arrow right (stable, neutral), clock (too early, neutral).

### Evidence chip
The one verification vocabulary across every screen: an icon and a label in 0.875rem bold, no background. Verified (badge-check) and Attested (signature) in leaf; Live, unverified (link) and Stale (rotate) in ochre; Self-reported (pen) and Submitted / Under check (clock) in Muted Cocoa; Unverified and Rejected (circle-slash) in brick. The icon names the state; colour only reinforces it.

### Cards / Containers
- **Corner Style:** 22px.
- **Background:** Card White on the sand ground.
- **Shadow Strategy:** the Card shadow (see Elevation & Depth).
- **Border:** none.
- **Internal Padding:** 20px, 24px from 640px.
- **Header:** title (800, 1.05rem) with an optional muted hint, and an optional action aligned right.
- **Inset panel:** a sand, 16px-radius block inside a card for a callout ("Not yet evidenced", "Proposed next step"). It is a panel, not a card: no shadow.

### Inputs / Fields
- **Style:** white fill, 1px seam border, 14px radius, 44px tall, 14px horizontal padding, 1rem regular text; the label sits above in 0.875rem bold with a 6px gap.
- **Focus:** the global 3px Bright Saffron outline; saffron caret.
- **Error:** a brick-wash block with brick text and `role="alert"` below the fields.
- **Disabled:** 50% opacity.

### Switch
48 by 28px pill: saffron when on, Deep Dune when off, with a 20px white knob that glides 200ms on the expo curve. Pending state drops to 70% opacity and sets `aria-busy`.

### Readiness bar
The signature data mark: a 12px Dune track with a Muted Cocoa fill for the score and a 4px cocoa target tick (ringed in card white) labelled with the target number above it. Fill and tick glide over 500ms on the expo curve when the what-if sliders move. The tick is ink, never saffron.

### Empty state and skeleton
Empty states are sand inset panels with a bold title, one muted sentence (max 46ch) that teaches what will appear, and an optional action. Skeletons are pulsing Dune bars inside white card shapes that match the final layout.

### Navigation
- **Side nav (from 1024px):** items are 14px-radius rows (12px 14px padding, bold, Muted Cocoa, icon 18px). Hover gives a Dune wash and ink text. The active item becomes a white pill with the Card shadow, ink text and a saffron icon at heavier stroke.
- **Bottom bar (below 1024px):** fixed white bar, items stacked icon-over-label (0.72rem bold). The active item turns saffron with a heavier icon stroke.
- **Selected list item (staff queues):** white with the Card shadow and a 2px inset ink ring.
- A "Skip to content" link appears as a white pill on focus.

### Motion
Press uses the spring curve `cubic-bezier(0.3, 1.22, 0.6, 1)` over 160ms (scale 0.97). Glides (readiness fill and tick, switch knob, shadow changes) use the expo curve `cubic-bezier(0.16, 1, 0.3, 1)`. There is no bounce on entry. Under `prefers-reduced-motion: reduce` every transition and animation collapses to 1ms.

## Do's and Don'ts

### Do:
- **Do** keep saffron (#c2490b) for things that can be pressed: buttons, links, the active nav indicator, on switches, focus.
- **Do** pair every state colour with an icon and words, using the GapTag, TrendTag and EvidenceChip vocabularies as built.
- **Do** give each card one idea, a 1.05rem extrabold title and at most one primary button.
- **Do** set scores and data in tabular figures, with the big score at 900 weight.
- **Do** separate content inside a card with sand inset panels (16px radius), hairline seams or spacing.
- **Do** use the pill shape for buttons and tags, 22px for cards, 14px for fields.
- **Do** add new colours, radii, shadows or easings as tokens in `src/app/globals.css`, with a dark-theme value alongside.
- **Do** check every new screen in one column at phone width with the bottom bar in place.

### Don't:
- **Don't** use saffron for a score, a gap level, a chart series, a heading or a decorative accent.
- **Don't** convey a state by colour alone.
- **Don't** nest a card inside a card or put a shadow on anything inside a card.
- **Don't** put an uppercase or tracked eyebrow/kicker label above a heading.
- **Don't** use gradient text, glassmorphism or backdrop blur.
- **Don't** write inline hex or rgb values in components.
- **Don't** build grey KPI-tile dashboards or neon "AI console" styling.
- **Don't** add a second typeface.
