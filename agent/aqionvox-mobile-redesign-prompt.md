# Task: Redesign the AqionVox demo dashboard for mobile

Apply to the **AqionVox demo page on aqionlabs.ai** the same mobile dashboard
redesign that was just shipped on the EthikCorp EC Calling Agent portal
(github.com/jafernazeer/ECcallingAgent, commits `ca46339` and `eb41c4f`).
Read those two commits first if the repo is reachable — they are the reference
implementation, and copying their approach is preferred over reinventing it.

## Context

Both pages are React + Vite marketing/demo sites that embed a live voice-agent
CRM dashboard (calls list, transcripts, captured leads). The dashboard is
rendered inside a decorative handset frame on the page. On phones that frame,
plus nested section/card/body padding, consumed roughly 85px of horizontal
space and capped the dashboard at ~560px tall, leaving list and detail panes
around 93px and 153px wide. That is unreadable, and it is the problem being
fixed.

## Goal

Below 600px the dashboard should read as a real mobile app: full-bleed,
minimal, comfortable to read, following current mobile master/detail norms.

## Required changes

### 1. Reclaim the width
Below 600px, strip the decorative phone chrome from the dashboard container —
zero padding, no border, no frame gradient, no frame shadow — and let it run
edge to edge inside a modest page gutter (about 12px). Keep the frame intact
above 600px; it is part of the desktop presentation and should not change.

Raise the shell height from a fixed pixel value to `min(78vh, 720px)`.

**Verify by measurement, not by eye:** the list pane must go from roughly 93px
to roughly 300px+ at a 375px viewport.

### 2. Drill-down instead of side-by-side
On phones, side-by-side list + detail is wrong — each pane is too narrow.
Replace it with standard drill-down:

- The list fills the screen.
- Tapping a row opens that record as its own full-width screen.
- A Back control ("All calls" / "All leads") returns to the list.
- Switching tabs resets the drill-down, so a new tab never opens mid-record.

Implement with a single `detailOpen` boolean in the dashboard component,
toggled on row click and cleared by Back and by tab switch. Drive visibility
from an `is-detail-open` class on the body element rather than conditional
rendering, so the desktop and tablet layouts are untouched by it.

Keep both panes visible between 601px and 760px (tablet), where the split has
enough room to be useful. Hide the Back control at those widths.

### 3. Readability
- Row titles 15.5px / 600 weight; supporting line 12.5px in a muted tone.
- Transcript and notes text 14.5px at ~1.55 line-height.
- Record fields: uppercase 11.5px labels with the value on its own line at
  15.5px — not a cramped label/value row.
- List rows become cards: the person's name is the anchor, with company and
  phone as one quiet support line beneath. Hide the remaining columns and the
  table header at phone width.
- Rows at least 56px tall; the Back control at least 44px. No tap target below
  44px anywhere.

### 4. Name the caller, never the call type
If the calls list labels rows by call type ("web call", "phone call") or by a
raw call id, replace that with the caller's name.

Resolve the name **server-side**, in whatever function shapes the call list
row, using the same precedence as the lead record: live capture-tool values
first, then the provider's structured post-call analysis fields, then the
labelled fields parsed out of the AI call summary. Return it as an extra field
(e.g. `callerName`, `callerCompany`) on each row. Do not resolve it in the
browser with a regex over the summary — the calls tab and the leads tab must
never disagree about a person's name.

Fall back to "Unknown caller" only when every source is empty. Head the
transcript panel with the caller's name rather than a truncated call id.

## Constraints

- Do not change the desktop layout. Every change belongs in a `max-width`
  media query or behind the `is-detail-open` class.
- Do not introduce a UI framework, CSS-in-JS, or a component library. Match
  the file's existing CSS conventions and naming.
- Preserve existing dark/light treatment and brand colors. This is a layout
  and typography pass, not a rebrand.

## Verification (required before reporting done)

Run the dev server and check at 375px, 600px, 768px and desktop:

1. List pane width at 375px is 300px+ (measure with `getBoundingClientRect`).
2. Tapping a call opens a full-width transcript; Back restores the list.
3. Tapping a lead opens the full record; Back restores the list.
4. Switching tabs while drilled in returns to a list, not a record.
5. `document.documentElement.scrollWidth <= clientWidth` — no horizontal
   overflow at any breakpoint.
6. Row height >= 56px, Back control height >= 44px.
7. Calls list shows caller names, not "web call".
8. Desktop layout is visually unchanged from before the edit.

Report the measured numbers. If the browser preview cannot scroll or
screenshot, verify via computed styles and say so explicitly rather than
claiming a visual check you did not perform.
