---
spec: 002-shell-and-spec-page
type: feature
design_track: app
viewports: [390, 820, 1440]
updated: 2026-09-28T22:40:00Z
---

<!-- DESIGN PASS — holds no acceptance criterion. A target that must be checkable is a claim in spec.md. -->

# Design 002 — Shell and spec page

The current state ("Ist") of this pass is the Lovable static prototype that this spec ports, served locally from
`specs/001-app-skeleton/.design/prototype/spectant-ui/` and captured per viewport; the Angular app itself has no spec
page yet. The target ("Soll") is the Angular 22 + daisyUI 5 port on the App track of the house `DESIGN.md`. Three
Designers worked one viewport each; the parent merged their cross-viewport concerns in the last section.

[Prototyp](.design/prototype/spectant-ui/spec-detail.html) — the Lovable static prototype, linked into this spec's
`.design/` (gitignored); its own docs are under `.design/prototype/spectant-ui/docs/`, its demo assumptions are listed
in `06-OFFENE-PUNKTE.md` and are not adopted.

## Mobile (390)

### Ist

![](.design/mobile-ist.png)

The captures show the Lovable static prototype, not the app. The Angular app has no spec page yet and only renders a placeholder. The main capture is `spec-detail.html` (area Status, tab Status) in the dark theme at 390 px. Two more captures were taken at the same width: the spec dashboard `spec.html` and the live board `board-live.html`.

![](.design/mobile-ist-dashboard.png)
![](.design/mobile-ist-board.png)

**Header (all three captures). This is broken.** The sticky header is about 64 px tall with a transparent glass background. Its left side is a bordered pill holding the living-ring logo and the spec picker, truncated to "Web cons". Five icon buttons sit on top of that pill: search, live (a pulse icon with a lime dot), zen (expand icon), the assistant ring, and settings. They cover the picker's label, and fragments of hidden labels ("oc", "ta") show through between the buttons. The area picker cannot be seen or tapped. Nothing reads as "spectant", because the wordmark text is hidden below 640 px. The root cause is in the prototype's CSS: the brand pill is `flex: none` inside a `minmax(0,1fr)` grid column, and five 40 px controls need about 232 px of the 366 px row. The header is the main thing this port has to fix at 390 px (ISC-73).

**Spec head (Status capture).** It takes about 370 px, from roughly y 90 to y 460, before the tab bar starts. Top to bottom:
- A back arrow and a small workspace logo, then "LEADgen / AI" in cyan and "/ Spec 002" in muted text.
- Two chips: `feature` (muted, with an icon) and `BUILDING` (cyan, uppercase).
- The heading "002 · web-console": the ID in cyan mono, the title in bold at about 20 px.
- A description over two lines, then the meta line "updated 12 min ago · round 3 · 2 files uncommitted".
- The command chip `/spec-implement 002` with a copy icon, and a violet "2 notes" pill. Both are about 32 px tall, and the copy icon is about 20 px, well under a 44 px touch target.
- An agent banner with an orange left border and dot: "Agent spec-002-ISC-333 is working on ISC-333 · since 4 min". Below it, right-aligned, a lock icon with "writes paused" in small muted grey. That text looks low in contrast; it has not been measured.

**Tab bar.** A muted "STATUS" area eyebrow, a divider, then "Status" (selected, cyan underline) and "Timeline". The eyebrow repeats the selected tab and uses about 70 px of width.

**"Where it stands" card.** It is nested with about 24 px of inner padding and starts near y 520, so the first real content arrives at the bottom of a phone's first screen. Contents:
- A five-segment stage track (Plan, Tasks, Review, Build, Close). The current stage, Build, is marked only by cyan and a lighter label, so colour alone carries the state.
- A 73 % ring with a lime-to-cyan gradient, next to "22/30 claims closed" ("claims" has a dotted glossary underline).
- NEXT: the command chip again, then "ISC-334 is takeable, 1 claim locked by an agent".
- A lime chip "takeable ISC-334".
- An orange warning triangle and a full orange line "ISC-339 unknown to master · /spec-sync 002".

**Dashboard capture.** The page is about 2,980 px long, over three and a half screens. It has the same colliding header and the same 370 px spec head. Then, in order:
- **Key numbers:** a full-width claims ring card (22/30, "8 open · 1 takeable"), then a 2×2 grid of Tasks landed 18/26 with a bar, Round 3 with "1 agent working", Gates 2/4 as segments, and Waiting on you 3.
- **Idea quote:** a violet-edged card with the eyebrow "THE IDEA · PRINCIPAL_STATED_GOAL · SPEC.MD" and a large German demo quote.
- **Next step:** the command, three reason bullets, and the stage track again.
- **Lanes:** web, server, core and operator, each with a mono name, a bar and n/m.
- **TL;DR:** a card with a STALE chip, `/spec-tldr 002`, and text cut off at "More…".
- **"Inside this spec":** five area tiles in two columns, each with a `g s`-style keyboard hint. The Notes tile sits alone in the last row, leaving a hole next to it.
- **Rail content,** at the very bottom: Waiting on you (three rows with operator, manual and question chips), Warnings, and Gates. The answer to the "Waiting on you 3" tile is therefore about 2,300 px below it.

**Board capture.** The page is about 3,340 px long, with the same header and spec head. Then:
- **Tab bar:** "LIVE | Board (live chip) | Matrix".
- **Toolbar:** Lanes/Flow segmented control, Filter, a search field cut to "id, claim, tex", and a density button.
- **Legend chips:** in flight 2, needs you 2, waiting 11, done 4, closed 5, wrapped over two rows.
- **Scrubber:** ◂ ▶ ▸ plus a rail with R1, a hatched re-cut marker, R3 and a lime Live ring; below it "Live · updated 12 s ago" and "claims 22/30 · tasks 9/26". The dashboard said 18/26, which is the fixture inconsistency the prototype's own doc 06 warns about.
- **Sticky bottom bar:** "This frame · 4 events · Needs you · 2", captured lying across the core lane.
- **Lanes, stacked one per row:** core, server, web, repo, test, operator. "test" is not a constitution lane. Each lane header has a dot, the name, "n · m waiting", a small × close control (well under 44 px) and a split meter. Sections inside each lane: NEEDS YOU, IN FLIGHT, WAITING (collapsible reason rows such as "width 4 reached 2"), and LANDED.
- **Cards:** a left border in the state colour, glyph, T-id, ISC chip, P badge and state chip (DONE, CLOSED, IN FLIGHT, QUESTION, CONCERNS). The task text is cut to one line ("Spec scanner reads stage, claims a…"), so most cards lose their meaning.
- **Operator lane:** a checklist ("Your steps · 0 of 2 done").
- **Footer note:** "A record, not an authority…".

**What works and should carry over:**
- The colour roles: cyan means active, lime means done, orange means work or warning, violet means decision or agent.
- The mono treatment of IDs and commands, and the ring-plus-fraction pairing.
- Lanes stacked with no horizontal page scroll.
- Waiting tasks grouped by reason.
- The agent banner and "writes paused" as the lock signal.
- The dark theme's page-darkest surface hierarchy.

**What must change for the Angular 22 + daisyUI 5 port:**
- The header collision.
- The spec head's height and its duplication of the picker.
- The eyebrow that repeats the tab.
- Touch targets under 44 px: chips, copy icon, lane ×.
- Keyboard hints shown on a touch device.
- Colour-only stage marking.
- One-line truncation of task text.
- Rail content buried at the page end.
- The assistant button, which is out of scope.
- All demo data: the German quote, "principal_stated_goal", the "test" lane, and the inconsistent task counts. None of it is ported.


### Soll


The binding standard is the App track of DESIGN.md:
- Tailwind 4, CSS-first; daisyUI 5 is the only theme mechanism, with its built-in themes off (DS-APP-01, DS-APP-11, DS-APP-12).
- Every colour is an OKLCH token converted from the prototype's hex, with the hex kept in a comment (DS-APP-03).
- Light and dark stay deliberately asymmetric (DS-APP-06).
- Own primitives live in `shared/ui/`, with daisyUI classes as the skin (DS-APP-21).
- Icons are lucide (DS-APP-24).

Every rule below applies when the `shell` container is under 640 px wide. Touch-target and hover rules key on `(pointer: coarse)` and `(hover: none)`, not on width.

#### Grid, type, surface
- **Gutter and spacing.** 16 px side gutter. Spacing comes only from the 8 px scale: 8 inside a group, 16 card padding and card gap, 24 between sections. The Ist's 24 px nested inner padding goes away.
- **Type scale** (ISC-74 ships the faces locally):
  - Manrope: body 14/20, meta 12/16, eyebrow 11/16 uppercase with .08em tracking.
  - Sora 650: h1 20/28, section titles 16/24.
  - JetBrains Mono: IDs, commands and paths at 12/16.
  - Docs body 15/24, for reading.
  - Nothing under 12 px except scrubber tick labels (11/16).
  - Numbers use `tabular-nums`.
- **Inputs** (search, note title, textarea) use a 16 px font size, so iOS does not zoom on focus.
- **Cards.** Border only, radius 12 (`--radius-box`), no glow or shadow. The prototype's decorative glow is the deviation doc 04 names. The header keeps its `--page-glass` blur and gains a 1 px border once the page scrolls.
- **Touch targets.** Every interactive element is at least 44×44 px. Visually smaller chips (command chip, claim chip, notes pill) keep a 32 px visual height and get a hit area extended to 44 px.
- **Keyboard hints.** `kbd` hints (`g s`, `press n`) are hidden under `(hover: none)`.
- **Safe areas.** The header respects `env(safe-area-inset-top)`, and every bottom bar adds `env(safe-area-inset-bottom)`.

#### Shell header: one `<header>`, two rows, 92 px sticky (ISC-73, ISC-75, ISC-76)
- **Row 1 (48 px), left to right:**
  - The living ring alone, 28 px inside a 44 px link, labelled "spectant, all workspaces". The ring keeps the violet dot; the "spectant" wordmark text is not shown at this tier. The spin and wave animations run only on hover-capable pointers and never under reduced motion.
  - One bordered pill (daisyUI `join`) with two segments:
    - Workspace picker: the name, truncated at 104 px.
    - A "/" divider.
    - Spec picker: the mono ID `002` when a spec is open, otherwise the spec count. Its accessible name carries the full "002 web-console".
  - Then `flex:1`, followed by three 44 px icon buttons: palette (search), live indicator (the dot alone, with its state as text for screen readers), and settings. Help is an entry inside the settings sheet.
  - Budget: 44 + 166 + 3 × 44 + gaps = 358 px. No overlap at 390 px.
- **Row 2 (44 px):**
  - Left: the area menu trigger, about 104 px: area dot, area name, chevron.
  - Middle: the current area's tabs as a daisyUI `tabs tabs-border` strip that scrolls horizontally on its own, with a fade on the trailing edge. This is the only scroller the header owns.
  - Right: the zen toggle, 44 px, `aria-pressed`.
  - The "STATUS" eyebrow from the Ist is gone; the area trigger replaces it.
- **Popovers become bottom sheets** (daisyUI `modal modal-bottom` on a native `<dialog>`, focus trapped, returning focus to the trigger per DS-APP-34 and DS-APP-35). This covers the workspace picker, spec picker, area menu, settings and palette.
  - The area menu lists all six areas: Dashboard · Status · Live · Data · Docs · Notes. Each row is 56 px and shows its dot, name and tab list as a subline. The current area has `aria-current="page"`.
  - Areas that are not built yet render disabled with their reason, following the mark on ISC-76.
  - Sheets are at most 75dvh high, with a 32×4 px grab handle. The primary action, where a sheet has one, is sticky at the sheet's bottom.
- **Zen** hides row 1's three tools and the spec head. Both header rows stay sticky. The spec head is replaced by a 40 px footer status bar: ID · stage chip · claims 22/30 · command chip with copy. Tapping the zen button again restores the page.
- **The assistant control is removed** (out of scope).

#### Spec head, compact (under the header, scrolls away)
- **Target height** is at most 240 px for the Status capture's content, down from about 370. The first content card then starts at or above y 360 instead of y 520.
- **Breadcrumb.** Dropped at compact: the header pill already carries workspace and spec. Tapping the workspace segment opens the picker sheet, whose first row is "Open workspace dashboard".
- **Layout, top to bottom:**
  - `h1`: mono ID in cyan, then the title, clamped to 2 lines.
  - One chip row that wraps: type chip, stage chip, notes pill.
  - The description, clamped to 2 lines, with a "more" disclosure.
  - The meta line at 12/16.
  - The command chip at full width. Its copy button becomes a real 44 px target, and copying confirms through the app's single toast (DS-APP-25).
- **Agent banner** as one dense row: an orange edge, then "● spec-002-ISC-333 on ISC-333 · 4 min". Below it, a "writes paused" chip with a lock icon. That chip uses text-colour tokens that must pass 4.5:1 in both themes (ISC-64, DS-APP-32); the Ist's small muted grey does not qualify.

#### Spec dashboard `/w/:ws/s/:id` (ISC-78, ISC-72)
Order at compact:
1. **Key numbers.** A claims card at full width: 96 px ring plus a 32/40 fraction and an "n open · n takeable" line. Below it, a 2×2 grid of Tasks landed, Round, Gates and Waiting on you. Every tile is a link: Waiting on you goes to Status, section Waiting, with a hash anchor. Every counter comes from the golden fixture; no prototype number survives.
2. **Next step.** Command chip, then the reason as at most three bullets.
3. **Idea quote.** Violet 3 px edge, Sora 18/26, at most 4 lines. The eyebrow reads "THE IDEA · spec.md § Goal". The source is the first sentence of `## Goal`, falling back to `task:`. `principal_stated_goal` is never shown.
4. **Lanes.** One row per constitution lane (core, server, web, repo), then operator last. Each row is 44 px: mono name, bar, right-aligned n/m, and a link into Live filtered to that lane.
5. **Area tiles.** Two columns, minimum height 96 px, each tile a whole-card link. When the number of tiles is odd, the last tile spans both columns, so no hole remains. No `kbd` hints.

The rail content (Waiting on you, Warnings, Gates) does not repeat at the bottom of the dashboard at compact. It lives at the top of Status, as prompt 2 specifies for medium and compact. That cuts the page from about 3.5 screens to about 2. The TL;DR card is not part of ISC-78; see crossViewport.

#### Status: tabs Status · Timeline (ISC-80, ISC-36, ISC-85)
- **Status tab order:** agent banner (when present) → Where it stands → Waiting on you → Gates → Warnings → open claims and fog → activity.
- **Stage track.** The current stage gets cyan, weight 600, a small ▾ marker above the segment, and `aria-current="step"`. It is no longer colour-only. Labels are 12/16.
- **Ring.** Decorative (`aria-hidden`). The "22/30 claims closed" text carries the value.
- **Gate button (ISC-85).** Full width, 48 px, four states:
  - ready: primary cyan.
  - stale: orange outline plus a list of the changed files below it, mono and wrapping at `/`.
  - done: lime check plus the time.
  - paused: disabled, with a lock icon and the session name as visible text, not a tooltip.
- **Gate dialog.** A bottom sheet that lists the three hashed files, then a sticky Confirm button.
  - 409 shows an inline alert in the sheet with a Reload button (ISC-26).
  - 423 shows the lock's session name (ISC-86).
  - With no lock source, a neutral note reads "no agent source".
- **Timeline.**
  - One vertical list with a left rule and a glyph per source: decision, round, gate, commit.
  - First line: event title and a mono time, right-aligned. Second line: source · actor.
  - Day headers stick at top 92 px, under the header.
  - Source filters live in a Filter button that opens a sheet with checkboxes and counts. The active filters show as removable chips.
  - Derived stage entries carry a visible "derived" chip (ISC-36).
  - A round entry expands (daisyUI `collapse`) into its task list and an "Open board at round n" link.

#### Data: tabs Claims · Tasks · Evidence (ISC-81, ISC-82, ISC-83.1)
- **Filter pattern, shared by Claims and Tasks.** A full-width 44 px search field, then "State ▾" and "Kind ▾" (or "Lane ▾") buttons that open sheets with counts. Active filters show as removable chips, plus a result line "12 of 30".
- **Claim card:**
  - Row 1: state glyph (open, takeable, taken, blocked, closed, dropped) with its state word visible at compact, the mono ISC ID, the kind chip, and a note-count badge (ISC-95).
  - Row 2: the full claim text, clamped to 3 lines with an expand.
  - Row 3: edges, e.g. "after ISC-330", muted.
  - The probe row (type · check · threshold · tool · severity) and the verification line sit in a "Probe" disclosure as a stacked definition list, not a table.
  - Cards are grouped by state, with count headers.
- **Task row, three lines:**
  - Line 1: checkbox (44 px target) · mono T-id · claim chip · [P] / [seam] flags · state chip on the right.
  - Line 2: the task text, clamped to 2 lines and never cut to one.
  - Line 3: lane chip · path tail in mono · "after T13".
- **Checkbox states:**
  - Saving shows an inline spinner.
  - Locked shows a lock icon plus visible text "locked · spec-002-ISC-333", because there are no tooltips on touch.
  - 409 and 423 are handled as in the gate dialog (ISC-25, ISC-26, ISC-27).
- **Probe mapping.** A stacked list per claim (claim → tool → severity), not a wide table.
- **Evidence.**
  - Grouped by claim, each group a collapse.
  - File rows are 56 px: type icon, filename in mono that wraps, size.
  - Images show as a 2-column thumbnail grid of about 171 px squares.
  - Tapping a thumbnail or a Markdown file opens a full-screen `<dialog>` with the path, the content fitted to width, and a 44 px close button.
  - A refused file shows an error row, never a fallback preview (ISC-83).

#### Docs: tabs Plan · Design · Decisions · Constitution (ISC-84)
- **Reading measure.** Full width minus the gutters, about 50ch at 15/24. Headings are in Sora.
- **Table of contents.** A "Contents" disclosure at the top, not a sidebar.
- **Tables.** Each table is wrapped in a focusable, labelled horizontal scroll region (`role="region"`, `tabindex="0"`) with an edge fade. Doc 04 explicitly allows this kind of targeted scroller, and it never makes the page overflow.
- **Code blocks** scroll inside, set in mono 12/18.
- **Mermaid figures** are scaled to width with a caption. Tapping one opens it full screen.
- **Design tab.** One Ist/Soll pair per viewport, stacked: the thumbnail at full width, which opens in a dialog, then the Soll text.
- **Empty state, type-aware:** an icon, the reason sentence, and the command chip.

#### Live: tabs Board · Matrix (ISC-87 to ISC-93)
- **Toolbar**, one row:
  - Lanes/Flow segmented control.
  - Filter button: opens a sheet holding the lane checkboxes and the state legend with counts. This replaces the Ist's two wrapped rows of legend chips.
  - Search icon button that expands into a full-width field.
  - No density toggle at compact: cards use the two-line density.
  - When filtered: an "n of m cards" line.
- **Scrubber.**
  - Not sticky at compact; it sits under the toolbar.
  - ◂ ▶ ▸ are 44 px buttons, and the rail spans the rest of the width.
  - Only every second result tick is labelled.
  - The re-cut marker keeps its hatch and gets a visible "re-cut" label (ISC-91).
- **Bottom bar**, sticky, 48 px plus safe area: "◂ R3 · live ▸ · This frame 4 · Needs you 2". Frame stepping stays within thumb reach after scrolling. Tapping the bar opens a bottom sheet with two tabs, This frame and Needs you.
- **Lanes.**
  - One lane per row, with no horizontal overflow and no lane scrolling on its own (ISC-93 holds at 390 as well as 600).
  - The lane header is sticky at top 92 px: dot, name, counts, split meter, and a collapse chevron with a 44 px target. It replaces the Ist's × control.
  - Lane order comes from the constitution, then operator.
- **Sections inside a lane,** in this order:
  - Needs you.
  - In flight: shows the lock's session name (ISC-90).
  - Waiting: 44 px collapsible reason rows with counts; every card stays reachable (ISC-89).
  - Landed: collapsed to a "Landed n" row by default at compact.
- **Card:**
  - A 3 px left edge in the state colour.
  - Row 1: glyph, mono T-id, claim chip, state chip text. Every one of the eleven states carries glyph, chip text and colour (ISC-88).
  - Row 2: the task text in up to 2 lines.
  - Row 3: builder tag, flags, and the session for work in flight.
- **Card detail.** A full-screen `<dialog>`.
- **Flow at compact.** A segmented control (Waiting · In flight · Needs you · Landed, with counts), with lanes as bands beneath it, as in the prototype.
- **Operator lane.** A checklist of 44 px rows whose checkbox is the guarded task write.
- **Matrix.**
  - A sticky first column of task IDs (mono, 64 px).
  - Frames sit in one labelled horizontal scroll region; cells are 44×44 glyph cells.
  - Tapping a cell switches to Board at that frame (ISC-92).

#### Notes (ISC-94, ISC-95)
- **List and editor are two stacked views,** never side by side at compact.
  - List: a header with a visible "New note" button (44 px, not floating, so it cannot collide with bottom bars), filter chips (All · Unanchored · by anchor), and 64 px rows showing title, anchor chip, updated time, and the first line muted.
  - Editor: a "← Notes" back link, the title field, an Edit/Preview segmented control, an auto-growing textarea of at least 12 lines at 16 px, and the anchor picker as a searchable bottom sheet.
- **Save state** as text, e.g. "saved · 12:04".
- **Delete** sits behind a confirm dialog.

#### Motion and accessibility
- **Reduced motion.** Under `prefers-reduced-motion`, sheets fade instead of sliding, number morphing and the ring and wordmark animation stop, and card jumps highlight without moving (DS-APP-42, ISC-65).
- **Tokens.** Durations and easings come from `motion.css` (DS-APP-41).
- **Focus.** A 2 px brand `:focus-visible` ring with an offset (DS-APP-38).
- **Forced colours.** A fallback for the ring, the stage track and the hatched re-cut marker (DS-APP-39).
- **UI strings** come from the EN/DE catalogues (ISC-22).
- **Visual baselines** at 390 px, light and dark: spec dashboard and Notes (ISC-96, ISC-96.1), the spec page (ISC-23, ISC-23.1), and the board (ISC-49, ISC-49.1).


## Tablet (820)

### Ist

![](.design/tablet-ist.png)

The app has no spec page yet; Angular shows a placeholder. The current design state is therefore the Lovable static prototype this spec ports, captured at 820 px. That width is the prototype's **medium tier** (container 640–1119 px): no context rail, 24 px page gutters and a 772 px content column. The main capture is `spec-detail.html` on area Status. The spec dashboard and the live board are in the two extra captures below.

**Header (64 px, sticky, dark theme).** On the left is one bordered rail, 40 px tall. It holds the living-ring mark on its own (the "spectant" wordmark is hidden at this tier), then the workspace picker "LEADgen / AI ⌄", the spec picker "Web console ⌄" in violet, and a cyan book icon for the library. The rail stops there, at about 360 px. **The area menu is not visible.** The prototype renders it inside the rail, but at medium the rail is clipped (`overflow: hidden`, `flex: 0 1 auto`). The one control that says which area you are in is cut off while it stays in the tab order. On the right are eight 40 px bordered controls: palette (search icon), the live indicator group (activity icon with a lime dot, refresh, timer "30 s"), zen, the assistant ring with its violet dot, settings and help. The right cluster outweighs the navigation. Every control has the same box, so nothing leads the eye.

**Spec head.** Row 1 is the breadcrumb (back arrow, workspace badge, "LEADgen / AI / Spec 002") with a grey `feature` chip and a cyan `BUILDING` chip on the right. Row 2 is "002 · web-console": the id in cyan mono, the title in Sora at about 24 px, then the description and the meta line "updated 12 min ago · round 3 · 2 files uncommitted". On the right sit the command chip `/spec-implement 002` with a copy button and a violet "2 notes" pill. The two-column head holds only because 820 is 20 px above the prototype's 800 px switch.

**Agent banner.** Full width with a 3 px orange left edge, an orange dot and "Agent spec-002-ISC-333 is working on ISC-333 · since 4 min". A muted lock icon and "writes paused" sit on the right.

**Tab bar.** The eyebrow "STATUS" and a divider, then the tabs "Status" (selected, cyan underline) and "Timeline". The bar and its rule start about 4 px left of the cards below, so the left edges do not line up.

**Status content, one column** (the prototype's two-column status grid starts at 900 px):
- *Where it stands*: the five-segment stage track with Plan, Tasks and Review in lime, Build in cyan with its label tinted, and Close in grey. Below it are a 73 % ring with a cyan-to-lime gradient, "22/30 claims closed", the eyebrow NEXT, a **second** `/spec-implement 002` chip (the same command already sits in the head, 250 px higher), the reason line "ISC-334 is takeable, 1 claim locked by an agent", a lime `takeable ISC-334` chip and an orange warning "ISC-339 unknown to master · /spec-sync 002".
- *Waiting on you* with a count badge of 3: T17 with a checkbox and the chip `operator`, ISC-338 with the chip `manual`. The rest falls below the fold.

![](.design/tablet-ist-dashboard.png)

**Spec dashboard** (`spec.html`, 2397 px tall at this width):
- *KPI band*: a full-width hero card (73 % ring, "Claims CLOSED 22/30", "8 open · 1 takeable") above four equal tiles: TASKS LANDED 18/26 with a bar, ROUND 3 with "1 agent working", "Gates" 2/4 with gate dots, WAITING ON YOU 3. The label case is inconsistent: "Claims CLOSED" and "Gates" in title case with an underline, next to the uppercase eyebrows.
- *The idea*: a violet-edged quote labelled "THE IDEA · PRINCIPAL_STATED_GOAL · SPEC.MD" in German low-high quotes „…“.
- *Next step*: the eyebrow "NEXT STEP · SINCE 07.03. 10:19 VIA /SPEC-IMPLEMENT", a **third** copy of the command chip, three reason bullets and the stage track.
- *Lanes*: web, server, core and operator. Each bar is fixed at about 55 px, with the counts pushed to the far right edge, which leaves about 430 px of dead space in every row.
- *TL;DR* with a `STALE` chip and `/spec-tldr 002`.
- *Inside this spec*: five area tiles (Status, Live, Data, Docs, Notes) with `g`-key hints. The grid places four in a row and leaves Notes alone on a second row. The session name in the Live tile breaks mid-token across three lines.
- The rail content moved into the page flow: *Waiting on you* (3), *Warnings* (1, drift to master) and *Gates* (reviewed 07.03. 09:55, code-reviewed –, master drift ⚠ 1, diagrams ✓).

![](.design/tablet-ist-board.png)

**Live board** (`board-live.html`):
- The tab bar reads "LIVE | Board `live` · Matrix".
- The toolbar has the Lanes | Flow segmented control, the legend chips (in flight 2, needs you 2, waiting 11, done 4, closed 5) squeezed into **three stacked rows** between the segment and Filter, a search field and a menu button.
- The scrubber has ◂ ▶ ▸, a rail with R1, R2, a hatched orange re-cut marker, R3 and a ringed "Live" end, and then the status line "Live · updated 12 s ago · claims 22/30 · tasks 9/26". The dashboard said 18/26 for tasks: the prototype's fixtures contradict each other, as its doc 06 warns.
- The lanes sit in two columns of about 360 px: core, server, web, repo, test, operator. Each lane has a coloured dot, a count, "n waiting", a close ×, a split meter and the sections Needs you / In flight / Waiting (reason groups as disclosure rows, for example "width 4 reached 2 ⌄") / Landed.
- The cards show a glyph, a cyan task id, a claim chip, `[P]`, a state chip and a builder tag. The task text is **cut to one line with an ellipsis** ("Spec scanner reads stage, claims and …"), so most of it is lost at this width.
- Rows align to the taller lane, which leaves voids of up to 200 px under core and web.
- The sticky bottom bar "This frame · 4 events · Needs you 2" covers cards while scrolling.
- The operator lane is a checklist ("Your steps · 0 of 2 done").

**What works and carries over:**
- The token roles (teal brand, cyan active path, violet decision or agent, orange work or warning, lime done only).
- The asymmetric light and dark palettes.
- Manrope, Sora and JetBrains Mono.
- The 4/8 px spacing scale.
- The five-segment stage track.
- The agent banner with its "writes paused" reason.
- The state chips that always carry text as well as colour.
- Reason-grouped waiting tasks.
- The re-cut marker on the scrubber.
- Popovers built on native `popover`.
- `prefers-reduced-motion`, which already stills the ring and the agent ping.

**What must change for the Angular 22 + daisyUI 5 port:**
- The clipped area menu.
- The header controls that are out of scope: library, assistant, and help as its own button.
- The command chip repeated two or three times.
- The inconsistent eyebrow case.
- The German quote marks hard-coded around English content.
- The fixed-width lane bars.
- The orphaned area tile.
- The one-line card truncation on the board.
- The three-row legend.
- The bottom bar covering content.
- The prototype's decorative `.card.glow`, which doc 04 already rules out for the brand.
- Every hex literal, which moves into OKLCH theme blocks (DS-APP-01…04).
- Every number, which the fixtures must supply instead (ISC-72).


### Soll

Tablet means the **medium container tier (640–1119 px)**, with 820 px as the reference width: 24 px gutters and a 772 px content column. Tiers are container queries on the shell, not viewport media queries, so a cmux panel of the same width looks the same. Everything below sits on daisyUI 5 theme blocks `spectant-light` / `spectant-dark` in `src/styles.css`. The prototype hex values are converted to OKLCH, with each hex kept in a comment (DS-APP-01…03), and the semantic aliases live in `tokens.css`. The prototype's `.card.glow` radial is dropped. Cards keep a 1 px border and a 12 px radius, with no shadow.

**Shell header (ISC-73, ISC-74).** One row, 64 px, sticky, glass background, with the rule shown only after scrolling. It carries exactly seven controls:

```
| ◯ spectant | LEADgen / AI ⌄ | ● 002 web-console ⌄ | ● Status ⌄ |      [⌕] [● ⟳] [⛶] [⚙] |
  brand+wordmark  workspace picker   spec picker        area menu          palette live  zen  settings(+help)
```

- **Left rail**:
  - **Brand**: the living ring at 28 px plus the Sora wordmark "spect" + "ant" in lime, about 118 px wide.
  - **Workspace picker**: the name, with a maximum of 120 px and an ellipsis.
  - **Spec picker**: the name when a spec is open, with a maximum of 110 px and the full "002 · web-console" in `aria-label`. On routes without a spec it shows the count ("6 active").
  - **Area menu**: a coloured area dot plus the label, in cyan text.

  The rail never clips (no `overflow: hidden`). When the rail and the tools collide, content yields in a fixed order:
  1. The wordmark text is visually hidden. The ring keeps the accessible name "Spectant, all workspaces".
  2. The workspace label drops to its badge.
  3. The spec name drops to its id `002`.

  **The area menu is never dropped.** At 820 px with the reference data nothing collapses: the rail needs about 490 px and has 524 px.
- **Right tools**, 8 px gap:
  - **Palette**: an icon button (the full trigger field appears at ≥1120).
  - **Live indicator**: dot + refresh as one 80 px group. The interval "30 s" moves into the live popover at this tier.
  - **Zen**.
  - **Settings**: its popover carries theme, language, the single-key switch and **Help & shortcuts**.

  Library and the assistant are out of scope and do not render. Help as a separate button disappears; the help sheet still opens with `?`.
- Every icon button is 40 px visually with a **44 px hit area on `pointer: coarse`**. Tablets are where this matters most. The focus ring is 2 px cyan with a 2 px offset, defined once globally (DS-APP-38).
- The ring's hover sweep and the wordmark wave run only without `prefers-reduced-motion`. With reduced motion the "ant" is static lime.

**Area menu and tab bar (ISC-76).**
- The area menu is a native `popover` listing Dashboard · Status · Live · Data · Docs · Notes. Each entry has its dot, a one-line summary and its `g`-key.
- The current entry uses `aria-current="page"` (DS-APP-37). `role="menu"` is not used.
- The tab bar sits under the spec head, is sticky at `top: 64px` and is 44 px tall. It shows only the current area's tabs, with counts where they mean something (Claims 22/30, Tasks 18/26, Evidence 9).
- The Ist's "STATUS" eyebrow in front of the tabs is removed: the header already names the area, and a second label is noise.
- Tabs and cards share one left edge at 24 px. The Ist is off by 4 px.
- Docs has the most tabs, four, which is about 420 px, so the bar never scrolls at this tier.
- A deep link `/w/:ws/s/:id/<tab>` selects the area and the tab. Router state is explicit; there is no in-memory tab state.

**Spec head** (every spec route, not sticky):
- Row 1: the breadcrumb on the left; the type chip and the stage chip on the right.
- Row 2: the id in mono cyan 15 px · the title in Sora 24/32, wrapping with `overflow-wrap: anywhere`, never truncated. Then the description (muted) and the meta line.
- **Actions** are a flex-wrap group right of the title: the next-command chip with copy, the notes pill, and the **gate button** when the stage is review (ISC-85). When they do not fit beside the title they wrap below the meta line, left-aligned. This replaces the prototype's hard 800 px switch, which 820 px only just clears.
- **The head's command chip is the single copy target for the next command.** The Status block and the dashboard's Next-step card name the command in their reason text and link to it, but they carry no second copy button.

**Agent banner (ISC-86, ISC-90).** One line, full width, under the head. Three variants:
- An agent holds a claim: orange edge, session name, claim, "since 4 min", and "writes paused" with a lock.
- Only the hash guard applies: a muted edge and "no agent source · writes are checked against the file hash".
- A write was refused with 409: "tasks.md changed since you opened it" with a **Reload** button.

The ping of the agent dot becomes a static ring under reduced motion.

**Zen (ISC-75).**
- The header keeps the brand, the pickers and the area menu. Palette, live and settings hide; only the zen toggle stays on the right, in the cyan pressed state.
- The spec head gives way to a 36 px footer status bar (id · title · stage chip · command chip).
- The tab bar stays sticky.
- There is no rail at 820 px, so there is nothing further to hide. The rail's inline content on Status stays, because at this tier it is page content.
- The rail's persisted collapsed state is neither shown nor changed here.

**Spec dashboard (ISC-78, ISC-72).** Read top to bottom:
1. **KPI band**: a full-width hero card (ring 96 px + "22/30", "8 open · 1 takeable") above four equal tiles: tasks, rounds, gates, waiting. Every label is one eyebrow style: 11/16, 600, 0.08 em, uppercase ("CLAIMS CLOSED", "GATES").
2. **The idea**: violet edge, eyebrow "THE IDEA · spec.md § Goal". The quote is the Goal's first sentence, or `task:` as a fallback, in Sora 19/1.45. Quote marks follow the document language: “…” for English.
3. **Next step** and **Waiting on you**, stacked (the two-column split starts at 900). They sit next to each other because both are "what do I do now". Next step shows the reason bullets and the stage track; Waiting on you shows the operator tasks, manual claims and questions, with the checkbox tick (ISC-25).
4. **Lanes**: one row per lane in constitution order (core, server, web, repo, then operator). The row is a grid: name 72 px mono | bar `1fr` | count 48 px, right-aligned tabular. That removes the Ist's dead gap.
5. **Area tiles**: a 6-track grid. Status, Live and Data span 2 tracks each; Docs and Notes span 3 each. That gives two balanced rows and no orphan. The Live tile's session name is one mono line with an ellipsis and the full name in `title`. The `g`-key hints show only under `(any-hover: hover) and (any-pointer: fine)`.
6. **Warnings** and **Gates**, as compact rows.

The TL;DR card is not part of ISC-78. It renders only if spec 001's model already provides it.

**Status area (ISC-79, ISC-80, ISC-36).**
- *Status* is one column at 820 (two columns from 900), in the fixed order Where it stands · Waiting on you · What is open · Activity.
- *Where it stands* is a horizontal composition: the ring (96 px) on the left; on the right the stage track with labels, the stage chip, "since … via …" or the **derived** marker, the reason line, takeable chips and warning lines (orange text with an icon, never colour alone). The four gate rows sit at the bottom of this card, because the rail that holds them at wide does not exist here.
- *Timeline*:
  - One strand, newest on top. A 56 px mono time column, then the 12 px type marker on the line at x = 72, then the title.
  - Day labels are sticky at `top: 108px` (header + tab bar).
  - The filter chips Stage · Decision · Round · Gate · Commit · Note · Agent fit on one row (about 560 px) as toggle buttons with `aria-pressed`.
  - The expandable body is a native `<details>` with a 240 ms disclosure, which is instant under reduced motion.
  - A derived transition uses a dashed marker plus the "derived" chip.

**Data area (ISC-81, ISC-82, ISC-83.1, ISC-24/25/26/27).**
- *Claims*:
  - Filter row 1 is a state segment (All · takeable · taken · blocked · closed · dropped, each with a count). Row 2 holds the kind toggles plus search at `1fr`.
  - Cards are full width, grouped under their feature heading. Each card has the glyph, mono id, the text in 15/24, and dependency chips.
  - The **probe row** is a two-column definition grid in mono 13/20 (type chip | check · threshold · tool · severity dot), so it wraps instead of scrolling.
  - The verification line links into Evidence.
  - A claim with notes shows a note-count pill (ISC-95).
- *Tasks* uses stacked rows, never a horizontally scrolling table:
  - Line 1: checkbox (44 px hit area) · id in mono · lane chip · task text, two lines maximum · state chip.
  - Line 2, muted: claim · edges · paths as path chips.
  - The probe mapping table below uses the same stacking.
  - While writes are paused the checkbox is disabled, with the reason as visible text in the row (not only a tooltip). After a tick, the row tints once for 1200 ms.
- *Evidence*: grouped by claim heading. Thumbnails sit in an `auto-fill, minmax(180px, 1fr)` grid, four per row at 772. A markdown file is a text card with its first lines. The preview is one native `<dialog>` primitive that returns focus to its trigger (DS-APP-34/35).

**Docs area (ISC-84).**
- A single column with the text measure capped at 72ch. The wide-tier 180 px table of contents becomes a "Contents" `<details>` at the top.
- Tables sit in a card with their own horizontal scroll, the one allowed scroller, because Markdown tables are arbitrary.
- Mermaid figures scale to the column width, with a click to open them full size in the dialog primitive.
- A tab whose file does not exist for this spec type stays in the tab bar, muted, with a type-aware empty state that gives the reason and the command, for example "No design pass yet · `/spec-design 002`".

**Live area (ISC-87 to ISC-93, ISC-37).**
- *Toolbar*, one block with three rows:
  1. Lanes | Flow segment, Filter, search at `1fr`, density menu.
  2. The legend chips on **one** row (about 470 px) as filter toggles.
  3. The scrubber at full width: ◂ ▶ ▸ (44 px on coarse pointers), a rail with round ticks, the hatched re-cut marker (ISC-91) and a ringed Live end, then the status line.

  Only row 3 is sticky under the tab bar (48 px). A sticky 150 px block would take about 22 % of an iPad portrait screen.
- *Lanes view*: `repeat(auto-fit, minmax(280px, 1fr))`, which gives two columns of 378 px at 820. Lane order is constitution order; **operator** is last and spans both columns as a checklist. Lanes are `align-self: start`: no stretched empty cards, and no lane scrolls on its own (ISC-93).
  - Card text is clamped to **two lines**, not one, with the full text in the detail dialog.
  - Chip text and glyph stay on every card (ISC-88).
  - Waiting tasks stay folded under their reason with the count, and none is hidden (ISC-89).
- *Flow view*: the four columns Waiting · In flight · Needs you · Landed at `minmax(0, 1fr)`, about 180 px each.
  - The 72 px band header of the wide tier becomes a full-width band title row (dot, lane, n/m) above each band.
  - Compact cards keep the glyph, id, **state chip text** and a 2-line text. The claim chip and builder tag move into the detail dialog.
  - Card movement uses a 240 ms FLIP, which is off under reduced motion.
- *Matrix*: tasks × frames. A sticky first column (task id, 64 px), 32 × 32 cells with state glyphs, the current frame column raised. The matrix card scrolls horizontally inside itself. Clicking a cell switches to Board with the scrubber on that frame (ISC-92).
- *This frame / Needs you*: a 48 px sticky bottom bar opens a native `<dialog>` as a bottom sheet (max 75 dvh) with a This frame | Needs you segment. The page gets `padding-bottom` equal to the bar's height, so the last card is never covered.
- *Card detail*: the same dialog primitive, centred, `min(460px, 100% − 32px)`.

**Notes area (ISC-94, ISC-95, ISC-52).**
- List and detail as two routes: `…/notes` and `…/notes/:noteId`.
- The list shows the title, the anchor chip (spec · ISC-… · T…), a pinned marker and the date. Opening a note replaces the list with the editor and a back link "All notes (n)".
- The editor has a segmented control: Edit | Preview. Side-by-side editing needs the wide tier.
- The anchor is one select, with at most one anchor.
- Delete goes through the dialog primitive.

**Accessibility and contrast (ISC-64 to ISC-66).**
- Text contrast is 4.5:1 and marks 3:1, in both themes, checked in real Chromium through the canvas probe (DS-APP-32/33).
- Two dark-theme values pass only narrowly: muted text on a card (#939293 on #2d2a2e, about 4.6:1) and the grey stage segment (#7f7d80, about 3.3:1). Neither may drift darker in the OKLCH conversion.
- State is never carried by colour alone: every chip has text, every warning has an icon.
- Visual baselines at 820 px, light and dark: spec dashboard and Notes (ISC-96, ISC-96.1), spec page (ISC-23, ISC-23.1), board (ISC-49, ISC-49.1).


## Desktop (1440)

### Ist

![](.design/desktop-ist.png)

The app has no spec page yet (Angular shows a placeholder), so this Ist is the Lovable prototype this spec ports. The main capture is `spec-detail.html` in the Status area at 1440 × 900, dark theme. Four more captures of the same prototype are referenced below.

**Frame.** Gutter 32. Main column x 32–1024 (992), a 32 px gap, rail x 1056–1408 (352). The header has no hairline and no surface of its own. The page is the darkest surface; cards sit one step lighter with 12 px radii and a 1 px border.

**Header (y 12–52).** One bordered group on the left (x 32–716) holds:
- the living-ring mark with "spect" in ink and "ant" in lime, in Sora;
- three pickers, each with a mono caps eyebrow of about 8 px: WORKSPACE "LEADgen / AI", SPEC `002` "Web console" and AREA "Status";
- a cyan "Docs" book link between the spec picker and the area picker (this is the per-workspace library, and it shares its name with the Docs area).

The group's width follows the area name: 716 on Status, 742 on Dashboard, 700 on Live. On the right sit a 40 px search icon button, the live indicator (green dot, "Updated 19 s ago", refresh, timer "30 s"), then zen, the assistant ring, gear and `?`. This right group ends at x 1392, 16 px short of the rail's edge at 1408. On the notes page the same group ends at 1408.

**Spec head.**
- Line 1: the breadcrumb (back arrow, workspace logo, "LEADgen / AI / Spec 002") at y 118, with the chips `feature` and `BUILDING` right-aligned on the same line. A lone `>` chevron (the rail toggle) floats in the 32 px gutter at x 1038.
- Title: mono `002` in cyan and "web-console" at about 24 px bold. The picker calls the same spec "Web console".
- Description and meta ("updated 12 min ago · round 3 · 2 files uncommitted") are muted.
- The command chip `/spec-implement 002` and a violet "2 notes" pill sit on the right, one row below the type chips. The head therefore has two right-hand clusters at different heights.
- A 40 px agent banner with an orange left edge reads "Agent spec-002-ISC-333 is working on ISC-333 · since 4 min", with "writes paused" and a lock at the right.

**Tab bar.** An eyebrow "STATUS" repeats the area, then a rule, then "Status" (active, 2 px cyan underline) and "Timeline". The hairline runs to x 1028, 4 px past the column.

**Status content.** A two-column bento of 484 px cards with a 24 px gap:
- "Why this next step" repeats the command chip, then gives three bullets with dotted-underlined terms and "since 07.03. 10:19 via /spec-implement". The card is stretched to its neighbour's height and ends in about 200 px of empty space.
- "Progress and gates" shows a 73 % ring, a TASKS 18/26 bar and four lane rows (web, server, core, operator). The meters are 64 px wide and their counts sit about 250 px away at the right edge. Four gate tiles follow in a 2×2 grid, each with a coloured left edge: Reviewed · fresh with its file list, Code-reviewed · missing, Master drift with an `unknown_to_master` chip, and Diagrams.
- "What is open" and "Activity" start at the fold.

**Rail.**
- "Where it stands" holds a five-segment stage track (Build active) and a second 73 % ring with "22/30 claims closed". Under NEXT, the same command chip appears a third time, followed by a reason line and a lime `takeable ISC-334` chip. A warning triangle wraps onto its own line above its text ("ISC-339 unknown to master · /spec-sync 002"). Four gate rows then repeat the main gate tiles: reviewed 07.03. 09:55, code-reviewed –, master drift 1, diagrams ✓.
- "Waiting on you 3" lists T17 (checkbox and `operator` chip), ISC-338 (`manual`) and T19 (`question`). Every title is underlined like a link.

**Dashboard** (`spec.html`)

![](.design/desktop-ist-dashboard.png)

The head is the same, with the breadcrumb "Spec 002 · Dashboard".
- The KPI band has five tiles: a claims ring tile 264 wide and four tiles of about 165. The labels mix their casing: "Claims CLOSED", "Gates", "TASKS LANDED".
- The idea quote sits in a violet-edged block. It is the German `principal_stated_goal` in „ “ quotes.
- Next step (bullets plus a stage track) and Lanes sit side by side, followed by a TL;DR disclosure with a `STALE` chip.
- "Inside this spec" has five area tiles with coloured dots (Status orange, Live lime, Data cyan, Docs violet, Notes yellow), `g s` style keys and arrows. The tile titles sit at two different heights, and the Live tile breaks `spec-002-ISC-333` across two lines.
- The rail holds Waiting on you, Warnings, Gates and the hint "[ ] previous / next spec · Esc workspace".

**Live board** (`board-live.html`)

![](.design/desktop-ist-board.png)

- Tabs: Board (with a `live` chip) and Matrix.
- Toolbar: a Lanes/Flow segmented control; five legend chips that wrap, leaving "closed 5" alone on a second row; a Filter button; a search field with `f`; and a menu button.
- Scrubber: ◂ ▶ ▸ buttons at 28 px; ticks R1, R2, a hatched re-cut, R3 and a lime Live ring; "Live · updated 12 s ago"; and "claims 22/30 · tasks 9/26", while the head and Data say 18/26.
- Lanes: a three-column grid of about 320 px. Core, server and web fill the first row; repo, test and operator the second. Lanes differ in height, so the second row starts under the tallest one (server) and leaves holes of about 200 px under core and web.
- Each lane has a dot, a name, "3 · 2 waiting", a close ×, a split meter and the sections NEEDS YOU, IN FLIGHT, WAITING (reason groups with counts) and LANDED.
- Cards have a 4 px state edge, a glyph, an id, a claim chip, `P`/`seam` marks, a state chip, and one line of text cut to "Spec scanner reads stage, cl…".
- The operator column repeats the rail's "Your steps".
- The rail holds a THIS FRAME · LIVE event list, then NEEDS YOU (orange edge) with the stale-agent alert and concern and question mini-cards, then YOUR STEPS.
- A footer reads "A record, not an authority — spec.md is."

**Data · Tasks**

![](.design/desktop-ist-tasks.png)

- The tabs carry counts: Claims 22/30, Tasks 18/26, Evidence 9. Below them sit lane filter chips and "hide done".
- A nine-column table: checkbox, task, claim, flags, title, lane, path, state, builder. Titles truncate while the path column still has room, and "DISPATCHED" runs into "Engineer".
- Every claim chip carries the same lime hand glyph, whether the claim is closed, locked or open.
- Locked, held, operator and question rows have a sub-line.
- A folded "+ 16 more done" row appears even though "hide done" is unchecked.
- A helper line explains ticking.
- A Probe mapping table stretches three sparse columns over 992 px.

**Notes**

![](.design/desktop-ist-notes.png)

Notes is a separate page outside the spec:
- The header swaps the area menu for a palette field.
- The head reads "SPECTANT · NOTES / Notes · LEADgen / AI", the breadcrumb "Dashboard / 002 · web-console / Notes", and there is no rail.
- A violet import notice shows `spectant import-notes <file>`.
- A two-pane card: on the left a 320 px list (search, a cyan "New n" button, chips All / Unanchored / 002 / 003, a teal-tinted selected row); on the right the editor (title, anchor chip, "← Spec 002", "Local · stays on this machine", "saved · just now", trash, a full-height mono textarea). In its Edit/Preview control, "Preview" touches the border.

**What works and should be kept:**
- the information architecture (workspace, then spec, then area, then tab);
- the calm dark palette and the state colour vocabulary;
- mono IDs;
- the 352 px rail with "Where it stands" and "Waiting on you";
- the agent banner with "writes paused";
- the lane sections with waiting grouped by reason;
- the scrubber with its re-cut hatch;
- the Tasks sub-lines that give the reason for a lock or a hold;
- the two-pane notes editor.

**What must change for the port:**
- **Repetition.** The next command appears three times, the ring twice and the gates twice.
- **Header.** The eyebrows are 8 px. The "Docs" library link collides with the Docs area. The right edge is 16 px off, and the header has no surface once content scrolls beneath it.
- **Split right cluster.** The spec head's right side sits at two heights, and the rail toggle floats in the gutter.
- **Stretched cards.** Bento cards stretch into empty space.
- **Board layout.** The lane grid is ragged and the toolbar wraps.
- **Tasks table.** Columns collide.
- **Claim glyphs.** One claim glyph is used for every state.
- **Casing and names.** Label casing is inconsistent, and the spec has two names ("Web console" and "web-console").
- **Dates.** They use German format in an English UI.
- **Idea quote.** It is German text taken from a field that the public spec does not contain.
- **Area tiles.** They use state colours as decoration.
- **Notes placement.** Notes sits outside the spec shell.
- **Demo data.** It is inconsistent (tasks 9/26 against 18/26); per 06-OFFENE-PUNKTE, none of it is ported.


### Soll

The spec page at 1440 uses the **wide tier** (shell container ≥ 1120 px). Shell padding is 32, the content area is 1376 px, and the page is centred with `max-inline-size: 1680px`.

Spec routes use `grid-template-columns: minmax(0, 1fr) 352px` with a 32 px column gap, which gives a 992 px main column and a 352 px rail. The rail is sticky (`inset-block-start: 80px`) and scrolls on its own inside `max-block-size: calc(100dvh - 96px)`.

Everything follows the app track of DESIGN.md:
- **Colours:** only the `spec-light` and `spec-dark` daisyUI theme slots and the aliases in `tokens.css`. Accent text uses its `-ink` token (DS-APP-01/02/06).
- **Components:** own primitives in `shared/ui/` and lucide icons (DS-APP-21/24).
- **Accessibility:** native semantics first (DS-APP-37).
- **Motion:** motion tokens only (DS-APP-41/42).

Surfaces are flat, with 12 px cards, a 1 px `--line` border and no glow. The corner glows of the prototype are dropped (06-OFFENE-PUNKTE).

#### Tokens and type (ISC-74)

**Fonts.** Three local variable woff2 faces:
- **Manrope** (UI, 400–700);
- **Sora** 600 (the wordmark and the page title only);
- **JetBrains Mono** (IDs, commands, paths, counters, all tabular).

**Type scale:**

| Use | Size / line height |
|---|---|
| Caption | 12/16 |
| Small | 13/20 |
| Body | 14/20 |
| Prose | 15/24, at most 72ch |
| Card heading (H2) | 17/24, weight 600 |
| Page title (H1) | Sora 24/32 |
| Eyebrow | 11/16, weight 600, uppercase, `letter-spacing: .08em` |

Nothing is smaller than 11 px. Every eyebrow and section label uses the same casing: "CLAIMS CLOSED", "GATES", "WAITING ON YOU".

**Spacing and edges.** Spacing uses the 8 px scale (4, 8, 16, 24, 32, 48): 24 inside cards, 16 between tiles and 24 between cards. The 3 px left accent edge (4 px for board cards) is the single exception to the scale.

**Colour roles:**

| Role | Slot |
|---|---|
| Active paths, IDs, focus | `primary` (cyan) |
| Agent, decision, notes | `secondary` (violet) |
| Closed | `accent` (lime) |
| Done | `success` (green) |
| Warning, work in progress | `warning` (orange) and `--conc` (yellow) |
| Fail | `error` |
| Stage badge | `neutral` (teal) |

State is never carried by colour alone: every state has a glyph and a text label too.

**Wordmark.** The living ring is 24 px, followed by "spect" in `base-content` and "ant" in `--accent-ink` (plain `accent` lime fails on the light page). Sora 600 18/24. The violet wave runs on hover only and is static under `prefers-reduced-motion`.

#### Header (64 px, sticky, ISC-73)

**Surface.** `base-200` at 85 % with `backdrop-filter: blur(12px)`. A 1 px `--line` hairline appears once the page has scrolled.

**Left group** (one bordered field, 40 high, `radius-field`):
- the wordmark;
- a 1 px rule;
- **workspace picker**: `folder-git-2` icon and the name, at most 200 px with ellipsis;
- **spec picker**: `file-text` icon, then mono `002` in `--muted-ink`, then the spec title. The title comes from `spec.md`, so the picker, the head and the breadcrumb always show the same name. The picker is at most 240 px. With no spec open it shows "6 specs".
- **area menu**: `layout-grid` icon and the area name. It is a native `popover` with Dashboard · Status · Live · Data · Docs · Notes, each with its `g` key and `aria-current="page"` (ISC-76, ISC-97).

The 8 px eyebrows are replaced by the icons plus an `aria-label` ("Workspace: LEADgen / AI"). The library "Docs" link is removed (out of scope, and it collides with the Docs area). The group's width is content-driven, and the right group does not move when it changes.

**Right group**, whose right edge aligns with the rail's edge at x 1408:
- **palette trigger**: a 240 × 40 field, "Jump to spec, workspace, command" with a `⌘K` key hint. It looks the same on every route; the prototype's icon on spec pages against a field on notes is gone.
- **live indicator** as in spec 001: 6 px dot, "Updated 12 s ago", refresh, interval.
- **zen**: 40 px, `maximize-2`/`minimize-2`, `aria-pressed`.
- **settings**: 40 px gear. Its popover holds theme, language, the single-key shortcut switch, a rule, "Keyboard shortcuts `?`" and "Help".

That gives seven controls. The assistant ring is dropped (out of scope).

#### Spec head (every spec area)

The head is a 24 px column-aligned block above the tab bar.

**Row 1.** A breadcrumb in 13/20 `--muted-ink`: `arrow-left`, then "LEADgen / AI", then "002 web-console", then the area. There is no workspace logo.

**Row 2** is a grid `minmax(0,1fr) auto`:
- **Left:** mono `002` 24/32 in `--primary-ink`, then the title in Sora 24/32 (ellipsis with a `title` attribute), then the chips `feature` (neutral) and `building` (stage), all on the title's baseline.
- **Right, one cluster:** the next-command chip with copy (its only home on the page), the "2 notes" pill (`secondary`, links to Notes) and, when the stage allows, the gate button (ISC-85).

**Row 3.** The description in 14/20, then the meta in 13/20 muted. Dates and relative times are formatted with `Intl` in the UI language (ISC-22); no "07.03." appears in English.

**Rail toggle.** `panel-right-close` as a 32 px icon button at the rail's top-right corner, never in the gutter.

**Agent banner.** Full main width, 40 px, `warning` 3 px edge, text from the lock source, and "writes paused" with a lock on the right. It shows only when a lock source reports a lock (ISC-90). With no lock source, a 32 px muted line reads "No agent source · writes check the file hash only" (ISC-86).

#### Tab bar

A 48 px `<nav>` of route links with `aria-current="page"`. The active tab has a 2 px `primary` underline, and the hairline stops exactly at the main column's edge. Counts ride inside the tabs (Claims 22/30), as mono tabular text.

The repeated area eyebrow ("STATUS") is dropped, because the area menu already says it. When an area has only one tab (Notes), no tab bar is drawn.

#### Rail (352, default expanded)

The rail content depends on the area:

| Area | Rail content |
|---|---|
| Status, Data, Docs, Notes | **Where it stands**: labelled stage track, 88 px claims ring with `22/30` and "claims closed", **Next** as the reason line plus takeable chips (no command chip), this spec's warnings (icon and text on one line, `align-items: start`), and the gate rows as a summary linking to Status § Gates. Below it, **Waiting on you**, whose rows are links with an underline on hover only. |
| Dashboard | Waiting on you, Warnings, Gates, and the key hint for `[ ]` and Esc. |
| Live | This frame, Needs you, Your steps (see below). |

Dotted underlines are reserved for glossary terms (`<dfn>` with a tooltip); links never use them.

**Collapsed rail.** A 48 px strip with `panel-right-open` and two count badges (waiting on you, warnings), so the collapsed state still signals open work. The main column grows to 1296. The collapsed state is stored through `/api/settings` and survives a reload (ISC-75). Motion: 240 ms on `grid-template-columns`, 0 under reduced motion.

#### Spec dashboard `/w/:ws/s/:id` (ISC-78)

**KPI band.** `grid-template-columns: 264px repeat(4, minmax(0,1fr))`, gap 16, height 136:
- **Hero tile:** 88 px ring, `22` at 40/48 and `/30` at 20/28 muted, caption "8 open · 1 takeable".
- **Tiles:** Tasks landed (meter), Round (agent dot), Gates (four segments), Waiting on you.
- Every tile is a whole-tile link. Labels ellipsize and never fade.

**Idea quote.** A `<blockquote>` 20/28 Manrope 600 with a `secondary` 3 px edge and a caption "THE IDEA · spec.md § Goal". The text is the first sentence of `## Goal`, falling back to `task:`, with locale quotes.

**Next step and Lanes.** Side by side in `minmax(0,7fr) minmax(0,5fr)`, gap 24.
- *Next step:* reasons as a list, then the stage track.
- *Lanes:* one row per constitution lane in the grid `72px minmax(0,1fr) 56px`, so each meter fills the space between name and count.

**TL;DR.** The `ui-disclosure` from spec 001.

**Inside this spec.** `repeat(5, minmax(0,1fr))`, gap 16, tiles 136 high.
- The title row is pinned to the top of the tile: an area icon (`activity`, `radio`, `database`, `file-text`, `sticky-note`) in `--muted-ink`, the name at 15/24 600, and the `g x` key right.
- Two meta lines, each clamped to one line with ellipsis; a mono chip never breaks.
- An arrow sits bottom-right.
- The coloured dots are dropped: colour is reserved for state. The Live tile shows a `warning` dot only while an agent is working.

#### Status (ISC-79, ISC-80, ISC-36)

**Status tab.** A bento of `repeat(2, minmax(0,1fr))`, gap 24, with `align-items: start`, so no card stretches into empty space:

| Left | Right |
|---|---|
| Why this next step (reasons, no chip; "since … via /spec-implement" as a caption) | Gates |
| Progress by lane (tasks meter and lane rows, no ring) | What is open |

- **Gates** is the gate detail: 2×2 tiles with a 3 px state edge, the hashed file list, the stale reason naming the changed files, and the gate button in ready / stale / done / paused.
- **Activity** runs across both columns under the bento.

**Timeline tab.** A single list within 992 px on the grid `112px 24px minmax(0,1fr)`: a mono date and time, a 2 px rail with a source glyph, then the entry.
- Filter chips by source: decisions, rounds, gates, commits.
- A derived stage entry carries a `derived` chip.
- A round entry expands in place (240 ms) and links "Open frame in Live".

#### Data (ISC-81, ISC-82, ISC-83.1)

**Claims.** The toolbar holds state chips (open, takeable, taken, blocked, closed, dropped), kind chips and search, all as query state. Rows are grouped by state.
- Each row is 48 px minimum: a 16 px state glyph (six distinct shapes, not one hand glyph for all), mono ID, kind chip, text clamped to 2 lines, and a notes-count pill (ISC-95).
- An expandable second band holds edges ("after ISC-68"), the probe row (mono, with copy) and the verification line linking to Evidence.

**Tasks.** Rows are 48 px on the grid:

```
40px | 56px | 104px | minmax(0,1fr) | 96px | 160px | 120px | 88px
```

The columns are checkbox · task · claim · title · lane · path · state · builder.
- `[P]` and `seam` become 16 px inline marks at the start of the title, so the separate flags column goes and the title gains 64 px.
- Paths ellipsize at the start, so the file name stays visible.
- State chips fit in 112 px, with a 8 px gap to the builder column.
- The sub-line (lock, hold, operator, question) spans title to builder.
- Checkbox states: unchecked, checked, saving, locked, held (disabled), operator, and conflict. Conflict shows an orange outline and an inline "tasks.md changed on disk · Reload" that applies nothing (ISC-25/26).
- Done rows show in order. "Hide done" hides them and leaves a footer "16 done hidden · Show"; there is no fold that ignores the toggle.
- The helper line stays.
- **Probe mapping:** `96px 120px minmax(0,1fr)`, 36 px rows, `max-inline-size: 640px`.

**Evidence.** Grouped by claim, each group headed by the claim ID and its verification line. Files sit in `repeat(auto-fill, minmax(200px,1fr))`, which gives 4 across.
- An image shows as a 16:10 `object-fit: contain` thumbnail on `--lane`.
- A Markdown file shows as a text tile with its first 4 lines.
- The path tail is in mono.
- Opening a file uses the shared dialog primitive, at most 960 wide, with focus returning to the tile (DS-APP-34).

#### Docs (ISC-84)

Plan, Design, Decisions and Constitution are tabs.
- **Frontmatter:** a meta row of chips.
- **Layout:** prose at 15/24, at most 72ch, beside a 200 px sticky mini table of contents inside the main column.
- **Tables and code blocks** break out to the full 992 px and scroll inside their figure.
- **Mermaid** renders as a bordered `<figure>` with a caption.
- **Empty state:** a card saying why the file is absent for this spec type, and the command that creates it.

#### Live (ISC-87 to ISC-93)

The tabs are Board and Matrix.

**Sticky block at `top: 64px`** (104 px in all, no layout shift while scrubbing):
- **Toolbar, one 48 px row that never wraps:** Lanes/Flow segmented control (`v`); five legend chips as `aria-pressed` toggles, which replace the separate Filter button; a 200 px search with `f`; a 40 px density menu.
- **Scrubber, 56 px:** 32 px ◂ ▶ ▸ buttons and a real `<input type="range">` with `aria-valuetext`. Ticks show dispatch (hollow), result (filled, worst state), re-cut (hatch) and live (lime ring). On the right, the frame chip ("Live" or an orange "History · R2 · Back to live") and "claims 22/30 · tasks 18/26", morphing over 400 ms.

**Lanes view.** `repeat(auto-fit, minmax(232px,1fr))`, gap 16, which gives the four constitution lanes one row of 236 px each. Unknown lanes wrap after them in their own row with `align-items: start`.
- Lanes never scroll on their own.
- The operator checklist is **not** a lane at wide: its single home is "Your steps" in the rail.

**Card anatomy.** The same in both views:
- line 1: glyph, id, claim chip and marks;
- the text clamped to 2 lines (never a one-line cut);
- last line: builder tag left, state chip right;
- `<article>` with the name "T14, ISC-333, in flight, web".

**Flow view.** Four columns (Waiting · In flight · Needs you · Landed) of `repeat(4, minmax(0,1fr))`. Each lane is a band headed by a 32 px sticky header row (dot, name, `n/m`) spanning the columns, so cards keep the same 236 px width and move with a 240 ms FLIP and no reflow.

**Rail.** **This frame** (collapsible event list), then **Needs you** (question, concerns and fail cards with a 4 px edge, plus the stale-agent alert), then **Your steps** (operator rows, 40 px, with the Tasks checkbox states).

**Matrix.** A card that scrolls horizontally inside itself, with an edge shadow hint.
- A sticky first column of 224 px holds a 32 px lane group header, then rows of 32 px (id and claim).
- Frame columns: dispatch 16 px (dimmed), result 28 px (labelled R1…), live 40 px, and an 8 px hatched re-cut column.
- Each cell is a 14 px state glyph; an absent task shows a dashed cell. Clicking a cell jumps the scrubber to that frame and switches to Board.

#### Notes area `/w/:ws/s/:id/notes` (ISC-94, ISC-95)

Notes lives inside the spec shell: the area menu reads Notes, and the head and rail stay.
- **Import notice** at the top, dismissible; the dismissal is stored in settings.
- **Two-pane card:** a 320 px list and the editor filling the rest (640 at 992).
- **List:** search, a 32 px `primary` "New" button with an `n` key hint, and chips This spec · Unanchored · Workspace.
- **Editor:**
  - the title at 17/24;
  - the anchor picker chip (none, spec, claim or task);
  - "Local · stays on this machine" and the autosave state in `--muted-ink`, and a delete action behind a confirm dialog;
  - an Edit/Preview control with 12 px inner padding, so neither label touches the border;
  - a textarea in JetBrains Mono 14/22, at least 480 high;
  - the preview as prose at 72ch.

#### Zen (ISC-75)

- **Header:** only the wordmark, the pickers, the area menu and the pressed zen button remain.
- **Page:** the spec head and the rail are hidden, the tab bar stays, and the main column takes the full 1376 px. The board then fits five lanes; prose keeps 72ch.
- **Footer bar:** a sticky 40 px status bar with id and title, stage chip, claims meter `22/30`, the command chip with copy and the notes pill.

#### Baseline notes (ISC-96, ISC-23, ISC-49)

The 1440 baselines pin a fixed clock (the relative time is frozen), the expanded rail, and the fixture spec with an agent lock present.


## Viewport-übergreifend

Decisions the parent took from the three Designers' cross-viewport notes. Where two or three viewports asked for the
same thing the line records the agreement; where they differed, the line names the choice and the reason. Nothing here
is an acceptance criterion; the checkable parts are the claims named in brackets.

**Tiers and shell**

- Tiers are container queries on the `shell` container, not viewport media queries: compact < 640, medium 640–1119,
  wide ≥ 1120 (as in spec 001). A cmux panel and a browser window of the same width look the same. The baselines at
  390/820/1440 hit one tier each (ISC-96, ISC-23, ISC-49).
- **One `<header>` on every tier, seven controls** (ISC-73): wordmark, workspace picker, spec picker, area menu,
  palette trigger, live indicator, zen, settings with help inside. The prototype's library link, its assistant button
  and help as its own button are dropped on every tier (library, "dot" and help are out of scope). The `?` key still
  opens the shortcut sheet.
- **Header shape differs by tier, the DOM does not.** Compact renders two sticky header rows (48 + 44 px); row 2 holds
  the area-menu trigger, the current area's tabs as a horizontally scrolling strip, and zen. Medium and wide render one
  64 px row and place the tab bar under the spec head, sticky at `top: 64px`. The tab bar is one `<nav>` component
  projected into a different slot per tier; it is never a second `<header>`. The header e2e counts the seven controls
  at 390 as well as 1440.
- **Collapse order when the left group and the tools collide**, the same on every tier: wordmark text first (the ring
  keeps the accessible name), then the workspace label to its badge, then the spec name to its mono id. **The area menu
  never collapses.** At compact the spec picker therefore shows only the id; the full name lives in the accessible name.
  ISC-73's wording ("name when a spec is open") is to be amended at `/spec-review 002` to "name, or its id at compact".
- The header pickers use role icons (`folder-git-2`, `file-text`, `layout-grid`) plus `aria-label` instead of the
  prototype's 8 px mono eyebrows, on every tier.
- **Palette trigger**: the full field (240 px) only from a header container of about 1280 px; below that an icon
  button on every route, Notes included. This narrows spec 001's design.md (field from 960 px at 320 px); 001's
  palette e2e opens the palette by keyboard and stays green (ISC-77).
- The prototype's hard 800 px switch in the spec head is replaced by a flex-wrap action group, so 820 px does not sit
  20 px above a layout jump.
- The "STATUS"/"LIVE" area eyebrow in front of the tab bar is dropped on every tier; the area menu names the area.
- **Zen** (ISC-75): every tier keeps the sticky navigation and hides the tools; the spec head becomes a footer status
  bar (id, title, stage chip, claims, command chip). The rail collapse toggle and its persisted state exist only at wide
  and are stored through `/api/settings`, never localStorage (the port changes, ISC-18.3). A `z` key for zen is
  proposed as an addition to ISC-97's list at review; until then zen is pointer-only.
- Below wide the rail content moves to the top of the Status tab (Where it stands, Waiting on you, Gates, Warnings) and,
  on Live, into the bottom sheet. It is not repeated at the bottom of the dashboard.

**One home per element**

- **The next command chip has one home**: the spec head (in zen, the footer bar). Status's "Where it stands", the rail
  and the dashboard's Next step show the reason and the takeable chips without a second copy button. Desktop's rail
  follows this rule too.
- **Operator steps have one home per tier**: at wide only the rail's "Your steps"; at medium and compact the operator
  checklist is the last lane (spanning the columns at medium). Never both.
- **Bottom edge below wide**: the zen footer bar and the Live area's "This frame / Needs you" bar merge into one 48 px
  bar (plus safe area) that carries id, title and, on Live, frame stepping and the sheet trigger.
- **Notes is an area inside the spec shell** (`/w/:ws/s/:id/notes`, note detail at `…/notes/:noteId`) on every tier.
  The list shows the workspace's notes with the chips This spec · Unanchored · Workspace, defaulting to this spec. The
  prototype's standalone notes page and its `?from=` return path go away; a workspace-level notes route is not part of
  this spec.
- **Area tiles are five** (Status, Live, Data, Docs, Notes); a Dashboard tile would link to itself. spec.md § Vision
  says "six area tiles" and is to be corrected at review. Tiles use lucide area icons, never the state colours as
  decoration. An odd tile count fills the last row (compact: the last tile spans both columns; medium: a 6-track grid
  with 2-2-2 / 3-3; wide: five equal tracks).
- **Live and Notes** stay in the area menu as disabled entries with a visible reason while their tabs are unbuilt
  (the mark on ISC-76 and the fog line resolve this way): a stable menu keeps the header group's width fixed.

**Content and data rules**

- Board card text is clamped to **two lines** on every tier, never the prototype's one-line cut; the full text is in
  the card detail. Lanes never scroll on their own, and `align-items: start` removes stretched voids (ISC-93).
- Flow view uses a band header row spanning the four columns (not a left row-header column) on every tier, so cards
  keep one width in Lanes and Flow and the FLIP moves them without reflow.
- The board toolbar never wraps at wide (legend chips replace the Filter button); medium keeps the legend on one row;
  compact folds legend and lane filter into one Filter sheet.
- Landed sections fold by default at compact; the e2e checks for ISC-88 and ISC-89 expand them or run at wide.
- The lane × control of the prototype becomes a collapse disclosure (44 px target) on every tier; a lane is never
  removed from the board.
- **Demo data is never ported**: not the German idea quote, not `principal_stated_goal`, not the "test" lane
  (constitution lanes are core, server, web, repo, then operator), not the inconsistent counts (dashboard 18/26 against
  board 9/26). Every number comes from the golden fixture (ISC-72).
- The idea quote is the first sentence of `## Goal`, falling back to `task:` (ISC-78), with quote marks in the content
  language. The spec's display name comes from `spec.md` alone, so picker, breadcrumb, head and palette agree.
- Dates and relative times are formatted with `Intl` in the UI language (ISC-22); no "07.03." in an English UI.
- The TL;DR disclosure on the spec dashboard reuses spec 001's Brief component when `specs/tldr.md` exists; it is not
  part of ISC-78 and needs no claim here.

**Interaction and accessibility, every tier**

- 44 px hit areas for every interactive element under `(pointer: coarse)`, with the visual size unchanged; one global
  rule, not a per-tier choice.
- `kbd` hints show only under `(any-hover: hover) and (any-pointer: fine)`; the ISC-97 bindings work everywhere and
  the shortcut sheet lists them on every tier.
- State is never colour alone: the current stage segment carries a marker and `aria-current="step"`, every chip has
  text, every warning an icon. Two dark values pass contrast only narrowly (muted text on card ≈ 4.6:1, grey track
  ≈ 3.3:1) and must not drift darker in the OKLCH conversion (ISC-65).
- Native `<dialog>` and `popover` for every sheet and menu, focus returned to the trigger; bottom sheets at most 75dvh
  with a grab handle at compact and medium.
- Reduced motion: sheets fade, no FLIP, no pulsing, the ring and the wordmark wave are static.
- Visual-baseline fixtures pin a frozen clock for "Updated n s ago", the expanded rail at wide, and the fixture spec
  with an agent lock present.

**Follow-ups for `/spec-review 002`** (claim or prose wording, not design) — applied 2026-09-29 at review:

- ISC-73: "name when a spec is open" → "name, or its id at compact". Done.
- ISC-97: add `z` (zen) to the binding list. Done.
- spec.md § Vision: "six area tiles" → "five area tiles". Done.
