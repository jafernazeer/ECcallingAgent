# Task: Redesign the AqionVox demo dashboard for desktop

Companion to `aqionvox-mobile-redesign-prompt.md`. Apply the desktop dashboard
pass shipped on the EthikCorp EC Calling Agent portal
(github.com/jafernazeer/ECcallingAgent). Do the mobile brief first if it has
not been applied yet — this one assumes the phone drill-down already exists.

## Context

Both pages embed a live voice-agent CRM (calls list, transcripts, captured
leads) inside a demo page. The desktop view had accumulated the usual problems
of a demo surface rather than a working dashboard: decorative framing competing
with the data, a list pane wider than the transcript it opens, 40px rows of
uniform weight, and no visible keyboard focus.

## Goal

Desktop should read as a modern, minimal dashboard app: calm surfaces, one
clear reading path, and data given more room than chrome.

## Required changes

Scope everything to `@media (min-width: 1001px)` so the phone and tablet
layouts are untouched.

### 1. Give the record the width, not the list
This is the highest-impact change. If the master/detail grid favours the list
(e.g. `1.55fr / 1fr`), invert it: the list becomes a fixed, modest column
(`minmax(268px, 330px)`) and the record takes the remaining space. A list row
holds a name and a timestamp; a transcript holds paragraphs.

**Verify by measurement:** on a 1440px viewport the record pane should land
around 480px, not around 320px.

### 2. Flatten the decorative chrome
Remove the gradient fill and heavy inner padding from the frame around the
dashboard; keep a single hairline border, one soft shadow, and an 18px radius.
The dashboard surface itself should be the object of attention. Raise the shell
to a 680px minimum height and the internal scroll caps to roughly 620px.

### 3. Rows that read as data
- Row height 52px minimum, 12px/18px padding.
- Header row: 11px uppercase, 0.06em tracking, faint tinted background.
- Selected row: a 3px accent bar on the leading edge, not just a background
  tint — the state must not depend on colour alone.
- Visible `:focus-visible` outlines on every row, nav item and back control.
  List rows are real buttons; keyboard users must be able to see where they are.

### 4. Records read as documents
- Field labels 11px uppercase in a muted tone; values 14px on their own line.
- Notes/summary blocks get a tinted panel, an uppercase caption, and 1.65
  line-height.
- Transcript turns capped at `max-width: 68ch` at 14px / ~1.62 line-height.
  Uncapped paragraphs across a wide pane are the single most common
  readability failure in dashboards like this.

### 5. Navigation clarity
Sidebar items at 13.5px/500 with a 9px radius and a hover tint. The active item
gets a filled background, 600 weight, and a 3px indicator bar on the leading
edge.

### 6. Numbers that do not twitch
`font-variant-numeric: tabular-nums` on KPI values, durations, funnel values
and any axis labels. KPI value at 30px/600 with tight tracking, its label at
11px uppercase — the number is the headline, the label is support.

### 7. Motion
Transitions 150–200ms on hover/selection only. Add a
`@media (prefers-reduced-motion: reduce)` block that disables them.

## Constraints

- Do not change the mobile or tablet layout. Everything sits inside the
  desktop media query.
- Keep the existing brand palette and token names. This is a layout, density
  and typography pass, not a rebrand.
- No UI framework, no CSS-in-JS, no component library. Match the existing CSS
  conventions in the file.
- If a design-system generator suggests oversized display type or a
  landing-page section pattern, ignore it — that guidance targets marketing
  pages and will damage a data dashboard. Take only the minimal/high-contrast
  and whitespace direction from it.

## Verification (required before reporting done)

At 1440px and 1280px, measure and report:

1. Record pane width ~480px (not ~320px) with the list at ~330px.
2. Row height >= 52px; selected row shows the leading accent bar.
3. Transcript paragraph width <= 68ch, font-size 14px, line-height ~1.6.
4. Focus outline visible when tabbing to a list row.
5. KPI values render with tabular figures.
6. `document.documentElement.scrollWidth <= clientWidth` — no horizontal
   overflow.
7. Phone (375px) and tablet (768px) layouts are unchanged from before the edit.

Report the measured numbers. If the preview cannot screenshot or scroll,
verify via computed styles and say so explicitly rather than claiming a visual
check you did not perform.
