---
spec: 001-app-skeleton
type: feature
design_track: app
viewports: [390, 820, 1440]
updated: 2026-09-28T12:40:00Z
---

<!-- DESIGN PASS — holds no acceptance criterion. A target that must be checkable is a claim in spec.md.
     Second pass (2026-09-28, after the principal dropped pixel parity): the old dashboard is the design source,
     not a measurement target. Section headings follow the Spec format; the prose is English (public repo). -->

# Design 001 — App skeleton and dashboard

**Direction.** Keep the identity of the old Spec dashboard: the Monokai-Pro palette in light and dark, the card
anatomy (12 px radius, 1 px border, 3 px accent top edge, corner glow), ring, bars, chips, the eyebrow-plus-title
header, the pinned Lucide icon family and the density. Rebuild layout, interaction and motion as a developer tool
built this year: the page answers *where do things stand → what do I run next → which spec* without scrolling at
1440 × 900, and it works with a keyboard at every width.

The "Ist" below is the old static `dashboard.html` for one real repository (six specs), captured full-page in the
dark theme at the three widths, plus the old Specs table tab (`.design/desktop-specs-ist.png`,
`.design/mobile-specs-ist.png`). The light theme was not captured; its values come from the old stylesheet.

**Decisions taken in the merge** (principal, 2026-09-28): a spec opens on the route `/w/:ws/s/:id` (rail inspector at
wide, side sheet at medium, full-screen sheet at compact); "Next up" is its own surface *and* every spec row carries
its stage and next command; the TL;DR bar stays as a collapsed "Brief"; the overview grid is
`repeat(auto-fit, minmax(min(100%, 360px), 1fr))` capped at three columns. Mechanical conflicts between the three
designers (container tiers, motion tokens, contrast tokens, icon set, dev-services placement) were resolved by the
parent and are recorded under `## Viewport-übergreifend`.

## Mobile (390)

### Ist

![](.design/mobile-ist.png)

Full page 390 × 4577 px. Header: teal split badge (`SPECS` over `6`, chevron fused), title "**Specs** ·
lead-generation" breaking at its hyphen, gear plus a joined refresh / timer / chevron group at about 30 px. Tab row:
three icon tabs (grid active, layers, book), a divider, "Kennzahlen" (also active) and "Mehr ▾". Kennzahlen: seven
full-width cards on a 12 px gutter (hero with a 106 px ring, "474 /477", the right half empty; spec claims; specs
with split bar; takeable; warnings; fog; archive). TL;DR bar, Dev-Services pills indented 22 px, Specs (Phasen,
Typen, Alle Specs with three of six rows and a "Zur Tabelle" link, Build-Aktivität). Then headings over empty bodies:
Als Nächstes (about 930 px empty), Archiv (an empty dashed box under a KPI of 15), Warnungen (empty under a KPI of
5), Doku, Letzte Änderungen; footer "Gerendert 28.09.2026, 03:13".

Observations: the first spec title sits at y ≈ 1850, more than two screens down; about 42 % of the page is headings
over nothing; the bar track `#4A474C` on `#2D2A2E` measures 1.55:1; nothing names the next command; a second
workspace has no place.

### Soll

390 px is the **compact tier** of one responsive page, not a phone app: spectant listens on loopback, so a 390 px
viewer is a narrowed browser or the cmux side panel on the same machine, with a keyboard. Touch sizing applies under
`pointer: coarse` only. Goal: within the first 400 px the developer knows where the workspace stands and what to run
next; the fixture page is about 1,400 px tall instead of 4,577.

- **Header (56 px, sticky):** `ui-badge-switcher` (40 px; the only switcher, two levels), then the eyebrow "DASHBOARD
  · 6 SPECS" over the workspace name (17/24, one line, ellipsis, full name in `title`), then a search button (opens the
  palette; `/` and Ctrl+K work when cmux claims ⌘K), the `ui-live-indicator` and the gear. Blur background with a
  solid fallback; the hairline appears on scroll (IntersectionObserver sentinel).
- **KPI band, compact form (`kpi-band`, about 248 px):** row 1: 72 px `ui-ring` beside "MASTER CLAIMS", the fraction
  "474 /477" (display numeral, nowrap, tabular) and "3 open"; row 2: "SPEC CLAIMS 70/73" with a 6 px `ui-meter`; then
  three stat cells (Specs with a split meter → scrolls to the list; Takeable → Next up; Attention "5 · 2 fog" →
  warnings).
- **Brief:** the `ui-disclosure` "TL;DR" collapsed (48 px), see Viewport-übergreifend.
- **Next up (`next-up-list`, card with a cyan edge):** up to three rows of 72 px (ID, one-line title, then
  `ui-command-chip` with copy), "Show all n" as a disclosure.
- **Warnings (`warnings-panel` as a `<details>` callout, orange edge):** rendered only when the count is above 0,
  collapsed, summary "5 warnings in 4 specs".
- **Specs (`spec-list`):** header "SPECS · 6 active · 15 archived"; a horizontally scrolling `ui-filter-chips` row
  (All, building, scoping, fog; `scroll-snap`, edge fade masks, the page never scrolls sideways); a sort icon button
  (sheet: Stage, ID, Progress); rows of at least 64 px (`4ch 1fr auto`: mono ID, title clamped to two lines, phase chip
  over `n/m` and a 32 px micro meter); the second line with stage track and command wraps under the title. The
  `archive-fold` `<details>` "15 archived specs" closes the list.
- **Spec open:** Enter or tap navigates to `/w/:ws/s/:id`, rendered as a full-screen `ui-sheet`; Esc returns and
  focuses the row.
- **Popovers become sheets:** at compact every popover (switcher, sort, gear, interval) renders through the one
  `ui-sheet` primitive (bottom sheet; the palette as a top sheet, 8 px inset, `max-height: calc(100dvh - 16px)`).
  No anchor positioning is needed at this tier.
- **All workspaces (`/`):** the columns stack (one column below 360 × 2 + gap); each `workspace-column` has a sticky
  48 px header (name, path tail, 32 px ring), the compact pulse line, the first Next-up row, the top five spec rows in
  dense mode and "Show all n in <workspace> →". The eyebrow reads "SPECTANT · 2 WORKSPACES · 7 SPECS".
- **Estimated fixture height:** about 1,400 px; the first actionable row at y ≈ 330 (Ist: 1,850).

## Tablet (820)

### Ist

![](.design/tablet-ist.png)

Full page 820 × 2988 px. Header as at 390 with an eyebrow "LEAD-GENERATION · DASHBOARD · 6 SPECS" and a one-line
title. The tab row already overflows into "Mehr ▾" (Warnungen, Doku, Letzte Änderungen hidden) and marks two tabs
active. Kennzahlen: a full-width hero (55 % empty) over a 3 × 2 grid of 253 px cards. TL;DR bar; Dev-Services pills
20 px inside the gutter; Specs as four stacked full-width cards (Phasen, Typen with one chip in a 100 px card, Alle
Specs with three rows, Build-Aktivität). Als Nächstes: a two-column grid of six cards, each with an ID chip, a
two-to-three-line title, a five-step stage meter with all labels (current cyan, done lime, rest grey), a mono command
chip with copy and, on three cards, "nehmbar : ISC-334"; meters of neighbouring cards sit at different heights.
Archiv: an empty dashed box. Warnungen: a heading and about 740 px of empty page; Doku and Letzte Änderungen do not
appear.

Observations: the developer scrolls about 1,530 px to reach the next command; the same six specs appear three times
with signals that disagree (SCOPING chips in Alle Specs, "Abschluss" and `/spec-complete` in Als Nächstes); controls
of about 30 px on an iPad-portrait width.

### Soll

820 px is the **medium tier** (640–1119 px): iPad-portrait WebKit with `pointer: coarse` and often a hardware
keyboard, and the upper end of the cmux side-panel band. Gutter 24 px, content 772 px.

- **Header (64 px, sticky):** `ui-badge-switcher` (48 px), eyebrow "LEAD-GENERATION · 6 SPECS" over the title
  "Specs · lead-generation" (20/28, second part muted, one line); on the right a palette trigger (40 px, at least
  200 px wide, "Search specs…" + `ui-kbd` ⌘K; collapses to an icon button below a 720 px header container), the
  `ui-live-indicator` (status dot, "Updated 12 s ago", refresh, interval, dev services in its popover) and the gear
  (theme System / Light / Dark as `ui-segmented`, language, single-key shortcuts on/off). Controls are 40 px visual
  with 44 × 44 hit areas under `pointer: coarse`, never overlapping.
- **KPI band, medium form:** a 3-column bento of about 288 px: row 1 (144 px) master claims spanning two columns
  (96 px ring, eyebrow, "474" at 40/48 with "/477" at 20/28, caption) beside spec claims (28/32 + bar); row 2 (128 px)
  Specs (split bar with legend), Takeable (cyan edge; applies `?sort=next&takeable=1`), Attention (orange edge;
  "5 warnings · 2 open fog"; jumps to the warnings heading and moves focus there).
- **Brief** collapsed under the band.
- **Next up:** the same `next-up-list` card as at compact, three entries plus "Show all", directly under the Brief.
- **Specs:** `ui-section-header` (eyebrow "SPECS", "6 specs", meta "6 feature · 15 archived"); a sticky toolbar at
  `top: 64px` with `PhaseFilter` as a `ui-segmented` radio group (dots per phase), `TypeFilter` only with two or more
  types, `SortMenu` (Next up default, ID, Progress); an 8 px `ui-split-bar` under the toolbar replaces the Phasen
  card. Rows of at least 72 px inside one card with hairlines: line 1 = `ui-id-chip`, title (15/24 semibold, clamp 2,
  `-webkit-line-clamp`), phase chip and `ui-warning-badge`; line 2 = `ui-stage-track` (five 24 × 8 segments, only the
  current label printed, accessible name "Stage 4 of 5: Build"), claims `n/m`, `ui-command-chip` with copy, "takeable
  ISC-334" muted. Stage tracks align across rows by construction. Foot: `ui-disclosure` "15 archived specs", rows
  loaded when opened.
- **Warnings (`warnings-panel`, `#warnings`):** "Warnings · 5 in 4 specs", grouped by spec, plus "Open fog · 2"; with
  no warnings a single 48 px line "No warnings" with a check icon.
- **Spec open:** `/w/:ws/s/:id` as a 480 px `ui-sheet` from the right (dialog, focus trap, Esc returns to the row).
- **All workspaces (`/`):** two columns of about 374 px side by side (registry order); each `workspace-column` with a
  56 px header link, a 96 px `KpiStrip` (56 px ring + three stat cells), the dense spec list (48 px single-line rows
  with a 40 px mini stage track) and "Open <workspace> →". `/` → `/w/:ws` runs a same-document view transition on
  the workspace title (feature-detected).
- **Filter and sort live in the query string** (`?phase=building&sort=id`), never in memory.

## Desktop (1440)

### Ist

![](.design/desktop-ist.png)

Full page 1440 × 2622 px. Header and tab-row hairline run from x 16 to 1424; the body has a left table of contents
(x 16–236) and a content column x 260–1109, leaving about 315 px empty on the right for the whole page. Navigation:
four icon buttons (sidebar, grid active, layers = the Specs table tab, book), a rule, eight text tabs; the TOC repeats
the same eight entries. Kennzahlen: a 280 × 320 hero (ring, "MASTER-CLAIMS" hyphenated, "474/4" + "77" wrapped)
and six 177 × 152 cards; "JETZT NEHMBAR" fades into its glow. TL;DR bar; Dev-Services pills 22 px off the edge;
Specs (Phasen and Typen cards, Alle Specs with three rows and the "Zur Tabelle" link, Build-Aktivität 60 % empty). Als
Nächstes: six cards in two columns with the five-segment stage track and command chips, sitting at y ≈ 1200. Archiv:
a dashed "▶ 15 archivierte Specs". Warnungen: an empty heading; no Doku, no Letzte Änderungen; about 790 px of empty
page at the end.

The old Specs table tab (`.design/desktop-specs-ist.png`) holds the full table: filter chips, sortable headers,
gate badges (R/C), next-step copy buttons, a notes column and archived rows. It is the source for the Specs panel's
filter, sort and row content.

### Soll

1440 px is the **wide tier** (≥ 1120 px). Shell padding 32, content 1376 px, `max-inline-size: 1680px` centred.
`/w/:ws` uses `grid-template-columns: minmax(0, 1fr) 352px; column-gap: 32px` (main 992 px, rail 352 px). The rail
is sticky (`inset-block-start: 80px`, own scroll). No tab row, no TOC: the KPI tiles, the palette and the `g`
sequences are the navigation.

- **Header (64 px, sticky, glass):** `ui-badge-switcher` (popover 320 wide: "All workspaces · 2", the workspaces with
  counts and `aria-current`, a rule, the specs of the current workspace, footer hint "⌘K searches everything");
  eyebrow + title (20/28, nowrap, ellipsis); a centred palette trigger (320 × 40, "Jump to spec, workspace, command"
  + `ui-kbd`); `ui-live-indicator` (6 px dot + "Updated 12 s ago", `rotate-cw` refresh with one 400 ms turn, `timer`
  "30 s" with Off / 10 / 30 / 60 s, dev services in the popover); gear; a 32 px `?` button.
- **Main column, KPI band (`kpi-band`, `container: kpi`):** at ≥ 880 px `352px repeat(3, minmax(0, 1fr))`, gap 16,
  two rows of 120 → 256 px. Hero spanning both rows: 112 px `ui-ring` (10 px stroke, lime→cyan), "MASTER CLAIMS" with
  `hyphens: none`, "474" at 40/48 + "/477" at 20/28 muted (nowrap, tabular, stepping down past six digits), caption
  "99 % closed · 3 open". Tiles (120 px): Spec claims (meter), Specs (split meter + legend dots), Takeable now,
  Attention (warnings + fog, `--hover` edge), Archive count, and one reserved slot for the activity sparkline of the
  state-machine spec. Tiles with a destination are links (the whole tile; hover raises the glow from 14 % to 22 %,
  no lift). The corner glow is a `::before` behind the content; labels never fade, they ellipsize with a `title`.
- **Brief (`ui-disclosure`, 48 px collapsed):** violet 3 px left edge, rotated `chevron-down`, "TL;DR" in mono
  `--ques`, "as of <date>" muted, a `ui-chip` "stale" when the file is older than the newest spec change, a
  `ui-command-chip` `/spec-tldr` with copy. Open: prose at 15/24, `max-inline-size: 72ch`, animated
  `grid-template-rows: 0fr → 1fr`.
- **Specs panel (`spec-table`, a `ui-card` with 24 padding, `container: specs`):** header row (48 px): H2 "Specs",
  meta "6 · 15 archived", `ui-filter-chips` (All 6, building 2, scoping 4 with 8 px phase dots, `aria-pressed`), a
  sort button (`arrow-up-down`: Stage order default, ID, Progress). An 8 px phase strip under the header. Rows
  (48 px, `<a href="/w/:ws/s/:id">` with roving tabindex): `64px` mono ID | `minmax(0,1fr)` title (one line, ellipsis)
  | `120px` `ui-stage-track size=mini` | `104px` phase chip | `128px` meter 64 × 4 + `n/m` right-aligned; the open row
  carries `aria-current="true"`, a 3 px cyan left edge and the `--disp-t` background. Footer row (40 px): "15
  archived specs" (muted, not interactive in 001).
- **Right rail (`context-rail`, 352 px), default mode:** 1 · **Next up** (`next-up-list`): compact `ui-card`s with the
  cyan edge, ID chip + title (clamp 2), a labelled `ui-stage-track` (60 px segments so "Abschluss" fits), the
  `ui-command-chip` with copy (icon swaps copy → check for 1200 ms, polite announcement "Copied /spec-implement
  012") and a "takeable ISC-334" chip. 2 · **Warnings** (`warnings-panel`): rows of `triangle-alert`, mono ID and
  message (clamp 2), grouped by spec; empty state "No warnings" with `circle-check`. 3 · nothing else: dev services
  live in the header indicator at every width.
- **Inspector mode (`/w/:ws/s/:id`):** the rail swaps to `spec-inspector` through a 240 ms crossfade view
  transition: "Back" text button with `ui-kbd` Esc; ID and full title (20/28); phase and type chips; labelled stage
  track; claims meter with `n/m` and percentage; the next-command chip; takeable-claim chips; this spec's warnings;
  fog count; `[` / `]` step through the list in its current order; Esc returns to `/w/:ws` and focuses the row.
- **All workspaces (`/`):** no rail; body `repeat(auto-fit, minmax(min(100%, 360px), 1fr))`, gap 32, capped at three
  columns (`max-inline-size` on the grid); two workspaces give two columns of 672 px. `workspace-column` as at 820,
  with four `ui-kpi-tile size=sm` (156 × 96) in the strip. Navigating into a workspace morphs the column title into
  the page title (`view-transition-name: ws-title-<slug>`).

## Viewport-übergreifend

### One responsive system

- **Container tiers, named once** (`src/styles/tokens.css`, queried on the shell container `container: shell /
  inline-size`, never on the viewport): **compact** < 640 px (includes the 600 px cmux panel, ISC-63), **medium**
  640–1119 px, **wide** ≥ 1120 px (rail). Components query their own container: `kpi` (880 / 560), `specs` (720 /
  480 for the row columns), `ws-col` (560 for the KPI strip), `header` (720 / 960 for the palette trigger). The old
  460 / 720 / 820 / 900 / 1100 viewport breakpoints are void.
- **Grid rules:** `/w/:ws` = one column below wide, main + 352 px rail at wide. `/` =
  `repeat(auto-fit, minmax(min(100%, 360px), 1fr))`, gap 24 (medium) / 32 (wide), at most three columns; the `min()`
  guard is what keeps 390 and 600 px from overflowing. No rail on `/` at any width.
- **Spacing:** 8 px scale (4 / 8 / 16 / 24 / 32 / 48). Gutter 16 (compact) / 24 (medium) / 32 (wide). 16 inside cards
  and between cards, 32 between sections. The inherited 3 px accent edge is the one sub-scale exception.
- **Section disposition (identical at every width; only the arrangement changes):**

  | Old section | 001 | Where |
  |---|---|---|
  | Kennzahlen (7 cards) | keep, redesigned | `kpi-band`: master claims, spec claims, specs, takeable, attention (warnings + fog), archive count; one tier-specific form each |
  | TL;DR bar | keep | `ui-disclosure` "Brief", collapsed, under the band |
  | Dev-Services | move | `ui-live-indicator` popover in the header + palette group "Services"; pills are links; "Nothing listening" when empty |
  | Specs · Phasen, Typen | merge | filter chips + phase strip in the Specs panel toolbar; type chips only with ≥ 2 types |
  | Specs · Alle Specs + the old Specs table tab | keep, promote | `spec-list` / `spec-table`: every spec, filter, sort, gate badges from the model, next command per row |
  | "Zur Tabelle" link | drop | the list is the table |
  | Specs · Build-Aktivität | drop for 001 | activity comes with the state-machine spec; a sparkline tile slot is reserved |
  | Als Nächstes | keep, promote | `next-up-list` (rail at wide, card under the Brief below wide) **and** stage track + command in every row |
  | Archiv | merge | list footer / `archive-fold`, archive tile at wide, palette group "Archived" |
  | Warnungen | keep | `warnings-panel` (rail at wide, collapsible callout below wide), the Attention tile, per-row badge |
  | Doku, Letzte Änderungen | drop for 001 | tech page is F5; "changed since you looked" markers from live refresh replace the change list |
  | Section tabs, left TOC, icon rail | drop | palette, KPI tiles as links, `g` sequences; one page in 001 |
  | Footer "Gerendert …" | drop | "Updated n s ago" in the header |

### Routes and state

- `/` all workspaces (redirects to `/w/:ws` when exactly one is registered) · `/w/:ws` dashboard · `/w/:ws/s/:id`
  spec open (inspector at wide, 480 px side sheet at medium, full-screen sheet at compact; Esc returns and focuses
  the row; `[` / `]` step through the current list order). F2's review page attaches to this route.
- Filter, sort and takeable flags are query state (`?phase=building&type=feature&sort=next&takeable=1`), never
  in-memory, so reload, back and the cmux web view hold them.
- The badge chevron is the **only switcher widget** (two levels: workspaces, then the specs of the current one). The
  palette also lists workspaces and specs, but it is a search surface, not a persistent switcher: no sidebar list, no
  workspace tabs at any width.
- Settings (theme mode, language, refresh interval, single-key shortcuts) are stored server-side (`/api/settings`) so
  they survive a port change (ISC-18.3); "recent" palette entries are a per-viewer convenience in `localStorage`
  wrapped in try/catch.

### Header and live indicator

One `layout/header` at every width: badge switcher · eyebrow + title · palette trigger (full field ≥ 960 px header
container, icon button below) · `ui-live-indicator` · gear · `?`. The live indicator replaces the old refresh / timer
/ chevron trio: a 6 px status dot (`--done` live, `--conc` refreshing, `--fail` unreachable), "Updated 12 s ago"
(`ui-relative-time`, not announced), a refresh button, the interval (Off / 10 / 30 / 60 s) and the dev services in
its popover. The page also refreshes when the tab becomes visible again; requests use ETag.

### Command palette and keyboard

- `layout/command-palette` on `ui-dialog` (`showModal()`, 96 px from the top, `min(640px, 100% - 32px)`, backdrop
  40 % black + `blur(4px)`; a top sheet at compact). Input row 56 px as a combobox driving a listbox through
  `aria-activedescendant`. Groups: Recent (empty query), Next up, Workspaces, Specs (current workspace first: mono
  ID, title, phase chip, workspace tail), Services, Actions (Go to all workspaces, Go to <workspace>, Copy next
  command for <spec>, Refresh now, Theme, Language, Show shortcuts, Open localhost:<port>), Archived. Ranking: exact
  ID > ID prefix > title word prefix > subsequence; matches as `<mark>`. "No match for “xyz” · try a spec ID like
  022". Enter navigates to `/w/:ws/s/:id`; focus returns to the trigger on close.
- **Keyboard map** (identical at every width, shown in the `?` sheet):

  | Key | Action |
  |---|---|
  | ⌘K / Ctrl+K / `/` | palette (`/` and Ctrl+K because cmux may claim ⌘K; a visible search control stays in the header) |
  | `?` | shortcut sheet |
  | ↓ ↑ · j k · Home End | move the selection in the focused list (roving tabindex, no wrap) |
  | ← → · h l | move between workspace columns on `/`, keeping the row index |
  | Enter | open the selected spec (`/w/:ws/s/:id`) |
  | Esc | close palette, sheet, popover or inspector; focus returns to the trigger or the row |
  | `c` | copy the selected spec's next command |
  | `r` | refresh now |
  | `[` `]` | previous / next spec while a spec is open |
  | `g a` · `g s` · `g n` · `g w` | all workspaces · Specs · Next up · Warnings (focus lands on the section heading, DS-APP-35) |
  | `1`–`3` | phase filter All / building / scoping while the list has focus |

  Single-key shortcuts never fire inside inputs or with a modifier held; a switch in the gear panel turns them off
  (WCAG 2.1.4). `g` sequences time out after 1000 ms. "Skip to specs" is the first tab stop; tab order is header →
  main → rail.

### States

- **First load:** `ui-skeleton` at the final geometry, shown only after 150 ms; 1600 ms shimmer, static under
  reduced motion.
- **Zero workspaces:** centred `ui-empty-state` (560 max): "Add your first workspace", `ui-command-chip`
  `spectant add <path-to-repo>`, "It appears here on the next refresh" (the registry is polled too).
- **Workspace without specs:** the Specs panel shows "No specs yet" with `/spec-idea`; the ring shows "—".
- **Nothing takeable:** "Nothing ready to build · 2 specs wait on fog" with a link to the fog filter. **Filter matches
  nothing:** "No spec in scoping" + "Clear filter".
- **Unreadable workspace:** its column or page stays, with `ui-notice tone=hover` (orange edge, `triangle-alert`,
  path tail, message, Retry); a spec that fails to parse stays in the list with a "parse error" chip.
- **Server unreachable:** a sticky `ui-notice` under the header ("Can't reach spectant on 127.0.0.1:7717 · showing
  data from 14:02", Retry; automatic retries at 5, 10, 30 s); data stays readable, not dimmed.
- **Live update (ISC-62, 62.1):** diff by stable keys; values swap in place inside fixed-width tabular boxes; ring
  and meters animate `stroke-dashoffset` / `transform` only; a changed value gets a `--disp-t` tint fading over
  `--motion-duration-highlight`; changed rows keep a 4 px cyan dot until hovered or focused; **new or removed specs
  never reflow under the reader**: a "1 new spec · show" pill applies them on user input; no reorder while focus is
  inside a list; one polite `ui-live-region` message per refresh, only when something changed; focus and scroll
  never move.

### Type, colour, focus, motion

- **Type:** local Inter Variable + JetBrains Mono (woff2, preloaded, `font-display: swap`; ISC-67). Scale: 11/16
  eyebrow (600, caps, .08em) · 12/16 meta · 13/20 small body and mono · 14/20 UI · 15/24 row title · 16/24 input and
  section heads · 20/28 page title · 28/32 KPI (medium) · 32/40 tile value · 40/48 hero value. Every number is
  `tabular-nums`; mono is for IDs, commands and ports only. German is the long case for layout ("Als Nächstes",
  "Jetzt nehmbar", "Abschluss").
- **Tokens:** the old values as OKLCH with the hex in a comment (ISC-18 covers these inherited tokens). Dark: `--bg
  #221f22`, `--surface #2d2a2e`, `--surface-2 #403e41`, `--line #4a474c`, `--disp #78dce8`, `--ques #ab9df2`,
  `--clos #a6e22e`, `--hover #fc9867`, `--fail #ff6188`, `--conc #ffd866`, `--badge #1d6878`; light from the old
  light block. daisyUI: `themes: false`, `--depth: 0`, `--noise: 0`; tokens without a daisyUI slot stay custom
  properties in the same theme block. No `@media (prefers-color-scheme)` block: the pre-paint script and the theme
  service set `data-theme` (system / light / dark; system follows `matchMedia` changes live, ISC-18.1).
- **Contrast (ISC-65), derived tokens, both themes, settled by the browser contrast spec:** `--muted` = `#939293`
  (4.57:1 on the card; the sampled `#8e8d8e` fails at 4.28:1); a new `--track` (≈ `#7f7d80`, 3.47:1) for the
  unfilled ring, meters and pending stage segments (the old `#4a474c` measures 1.55:1); in `spec-light` the accents
  fail as text (`--disp` 3.77, `--clos` 4.08, `--fail` 3.77, `--conc` 3.18), so `--disp-ink`, `--clos-ink`,
  `--fail-ink`, `--done-ink`, `--conc-ink` alias darker values there and the accent itself in dark; accents keep
  their values for edges, glows, fills and dots. Badge text stays `#fcfcfa` (6.19:1 on teal). This is recorded in
  spec.md Decisions because it applies everywhere.
- **Focus (ISC-64):** global `:focus-visible` = `outline: 2px solid var(--disp); outline-offset: 2px` plus
  `box-shadow: 0 0 0 4px var(--bg)` so it separates from the teal badge and glows; `outline-offset: -2px` inside
  scroll containers and rows.
- **Motion tokens (`src/styles/motion.css`, DS-APP-41; stylelint forbids literal durations elsewhere):**
  `--motion-duration-instant` 80 ms (hover, press) · `-fast` 160 ms (popover, row selection, copy → check) · `-base`
  240 ms (palette, dialog, sheet, inspector swap, disclosure) · `-slow` 400 ms (ring and meter morph, refresh turn,
  the ring's first draw on load only) · `-highlight` 1200 ms (changed-value tint) · `-skeleton` 1600 ms;
  `--motion-ease-standard cubic-bezier(.2,0,0,1)`, `-emphasized cubic-bezier(.05,.7,.1,1)`, `-exit
  cubic-bezier(.3,0,1,1)`. Under `prefers-reduced-motion: reduce` every duration is `0ms`, the skeleton is static,
  view transitions are skipped (`skipTransition()`), and the change tint becomes the static dot (ISC-66). Nothing
  moves on hover; glow intensifies under `(hover: hover)` only.
- **Forced colours:** glows, gradients and edges drop; the ring keeps its value as DOM text; meters get a border
  fallback (DS-APP-39).
- **Icons (ISC-18.2):** the same pinned `lucide-static` version as the old pages. The old pages used: activity,
  arrow-up-down, book-open, check, chevron-down, circle-check, cloud-fog, copy, file-text, filter, gauge, history,
  layers, layout-dashboard, list-checks, maximize-2, minimize-2, moon, notebook-pen, panel-left-close,
  panel-left-open, rotate-cw, scale, settings, shapes, square-kanban, sun, sun-moon, table, target, timer,
  triangle-alert, zap. The app adds from the same pinned version only what the new surfaces need (search, x,
  chevron-right, folder-plus, archive, keyboard); only used icons are inlined.
- **Hit areas:** controls are 40 px visual (32 px for the `?` and inline icon buttons); under `pointer: coarse` the
  shared `ui-button` / `ui-icon-button` primitive adds a transparent 44 × 44 `::before` hit area; in joined groups
  the hit area extends vertically to 44 px and horizontally to the segment width, with at least 24 px between
  neighbours (WCAG 2.5.8).

### Components (`web/src/app/shared/ui/`, each with at least two consumers)

`ui-card` · `ui-kpi-tile` (hero / default / sm) · `ui-ring` · `ui-meter` (single / split) · `ui-stage-track` (mini /
labelled) · `ui-chip` (tone, dot) · `ui-id-chip` · `ui-filter-chips` · `ui-segmented` · `ui-command-chip` (copy with
clipboard fallback) · `ui-button` / `ui-icon-button` / `ui-button-group` · `ui-badge-switcher` · `ui-popover` ·
`ui-sheet` · `ui-dialog` · `ui-kbd` · `ui-disclosure` · `ui-skeleton` · `ui-empty-state` · `ui-notice` ·
`ui-live-indicator` · `ui-live-region` · `ui-relative-time` · `ui-section-header` · `ui-icon` (raw pinned Lucide
nodes) · `uiRovingList` directive (j/k, arrows, Home/End). Feature components: `layout/{shell, header,
command-palette, shortcut-sheet, settings-popover}`, `features/dashboard/{kpi-band, spec-table, spec-row,
next-up-list, warnings-panel, context-rail, spec-inspector}`, `features/overview/{workspace-column, kpi-strip}`.

### WebKit (cmux web view, iPad Safari) — assumed floor WebKit 17

- **Needs a guard or fallback:** CSS anchor positioning (Safari 26; `@supports not (anchor-name: --a)` → JS
  placement in `ui-popover`); same-document View Transitions (18+; feature-detected, instant otherwise);
  `@starting-style` + `transition-behavior: allow-discrete` (17.4+; elements appear without animation otherwise);
  `dialog closedby`, invoker `commandfor` / `command`, `popover="hint"` (not relied on; `showPopover()`,
  `showModal()`, Esc and backdrop click handled in the primitives); `calc-size()` / `interpolate-size` (absent; the
  `grid-template-rows` technique animates disclosures); `backdrop-filter` (ship `-webkit-backdrop-filter` plus an
  opaque fallback); `line-clamp` (`-webkit-line-clamp` with `display: -webkit-box`);
  `navigator.clipboard.writeText` (may be refused in WKWebView; fall back to a hidden textarea, then to selecting
  the text and "Press ⌘C"); scroll-driven animations (not used; IntersectionObserver instead).
- **Safe without a guard:** container queries, `:has()`, `oklch()`, `color-mix()`, `dvh`, `inert`, native `popover`
  (the hard floor for ISC-19). `text-wrap: pretty` and `content-visibility: auto` are harmless enhancements.
- The ISC-19 manual check records the cmux WebKit version.

### Baselines

The visual baselines (ISC-17 / 17.1 / 16.1 / 16.2) are taken with a pinned fixture clock ("Updated n s ago", the
Brief's "stale" chip), skeletons disabled, animations disabled, a `data-ready` attribute awaited, no dev services
listening, and a fixture with a three-digit/three-digit master fraction; the rail's presence at 1440 and absence at
820 and 390 are part of the baselines.
