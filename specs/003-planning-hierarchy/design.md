---
spec: 003-planning-hierarchy
type: feature
design_track: app
viewports: [390, 820, 1440]
updated: 2026-09-29T20:45:00Z
---

<!-- DESIGN PASS — holds no acceptance criterion. A target that must be checkable is a claim in spec.md. -->

# Design 003 — Planning hierarchy

The current state ("Ist") of this pass is the app as built by specs 001 and 002 at the time of the pass, served from
`web/dist/browser` with the e2e stub API on the harbor fixture (five active specs, one archived, no milestones):
the workspace page `/w/harbor`, where the Features and Milestones pages will sit, and the spec page of harbor 002
(Data › Claims), whose breadcrumb line and feature grouping are the visual ancestors of ISC-105 and ISC-103. The
target ("Soll") is the Angular 22 + daisyUI 5 design on the App track of the house `DESIGN.md`. Three Designers
worked one viewport each; the parent merged their cross-viewport concerns and the principal's two decisions in the
last section. Spec 001's dashboard page for `/w/:ws` (round 20, in flight during this pass) is designed against,
not captured.

[Prototyp](.design/prototype/index.html) — a static prototype of the Soll sections, built after the pass on the
principal's yes (gitignored, hash-routed: `#features`, `#milestones`, `#spec`, `#spec-archived`; `?theme=dark`,
`?milestones=off`). It shows the workspace-scope area menu, the Features and Milestones pages with the harbor
fixture's real feature blocks, the two derived milestone states, and the breadcrumb on an active and an archived
spec head, in both themes. Its numbers are read from the fixture by hand and prove nothing; the goldens of ISC-100
do.

## Mobile (390)

### Ist

![](.design/mobile-ist.png)

**Workspace page `/w/harbor`, light theme, 390 px (compact tier).** Features, Milestones and the extended breadcrumb do not exist yet, so this is the page the new ones will sit beside.

**Header, two sticky rows, about 92 px, with a hairline at the bottom.**
- **Row 1 (about 48 px):** the living ring (green, violet dot) on its own, with no wordmark. Next to it is a bordered pill with two segments, `folder` "harbor" and `file-text` "5", which is the spec count because no spec is open. The "/" between the segments sits about 8 px below the label baseline and crosses the pill's bottom border. It is misaligned, and you can see it in both captures. On the right: a 40 px bordered search button, a small grey live dot with no visible label, and the settings gear.
- **Row 2 (about 44 px):** the "Areas ⌄" trigger with a `layout-grid` icon (about 100 px, bordered) on the left, and the zen `maximize` icon on the right. There is no tab strip, so about 230 px of the row is empty. The trigger names no area. It is a menu label with nothing selected.

**Page.**
- H1 "Specs in harbor", display face, about 24/32, at x 16.
- Five rows follow, each a bright 44 px card with a 1 px border and 12 px radius on the tinted page, with 8 px between rows. Each row shows the mono id in cyan (004, 005, 006, 002, 003), then the title on one line with an ellipsis, then a cyan-tint stage chip (Code review, Review, Review, Build, Tasks).
- The titles are cut after roughly 26 to 30 characters ("Delete old manifests on …", "Read the config through one l…"). The chips differ in width, so every title is cut at a different point and the right edge of the text is ragged. At this width the title is the only content that carries meaning, and it loses most of it.
- The rows are in the order 004, 005, 006, 002, 003. Nothing on the page says what that order means.
- Nothing shows which feature a spec serves. No archived spec appears. There is no feature or milestone level anywhere.
- Below the list, about 480 px of the viewport is empty page.

![](.design/mobile-ist-spec.png)

**Spec page, harbor spec 002, area Data, tab Claims, same width.**
- **Header row 1:** the same shell. The pill now reads "harbor / 002": the spec picker shows the mono id only, and the "/" is again below the baseline.
- **Header row 2:**
  - Left: the area trigger "● Data ⌄" with a cyan dot.
  - Middle: the tab strip. "Claims 25/30" is active, with a cyan underline. "Tasks 27/32" is cut at the right edge before the zen button, so only "27/3" shows.
  - Right: zen.
- **No breadcrumb line at 390.** The header pill is the only place that names workspace and spec. The "harbor / 002 web-console / Data" line exists at the wider tiers only (spec 002 dropped it at compact).
- **Spec head:**
  - H1 "002 Web console", with the id in cyan mono.
  - A chip row: grey "feature", cyan "● Build", and a solid violet "Notes" pill.
  - A green outlined "Reviewed Mar 7, 2026, 4:30 PM" badge with a check-circle.
  - The description, clamped to two lines, with a cyan "more" link.
  - The meta line "updated 7 months ago · round 3".
  - The command chip "/spec-implement 002" with a copy icon. It is only as wide as its content, not full width.
  - The muted line "No agent source · writes check the file hash only".
- **Filters:**
  - Two rows of filter chips: "All 30" (selected, cyan tint), "open 5", "takeable 4", "taken 0"; then "All kinds 30" (selected), "Anti 0", "Antecedent 0".
  - A full-width "Search ID or text" field.
  - The count "30 of 30".
- **Feature block, the visual ancestor of the Features page:**
  - The heading "F2 · Web console" at about 17/24 semibold, with the count "30" right-aligned in muted text. The F-id is set in the heading face, not mono.
  - Below it, the muted Why line "Why: a teammate who never touches the CLI can see what was mirrored, when, and what failed."
  - Then the claim cards. Each has a green state dot, the cyan mono "ISC-51", and a violet count badge "1" on the right. Below that come the claim text, an "e2e" chip with the mono probe line (ending "● severity high"), and a "VERIFIED … passed, 2026-03-08" line. The next card, "ISC-52", starts at the fold.
- The feature grouping exists only inside one spec. Nothing links from "F2" to anything above the spec.

**Prototype of the Soll** ([Prototyp](.design/prototype/index.html)): Features page, spec head with the breadcrumb, Milestones page in dark.

![](.design/mobile-prototype.png)
![](.design/mobile-prototype-spec.png)
![](.design/mobile-prototype-milestones-dark.png)

### Soll

Compact tier (shell container < 640 px). Everything below also applies to the cmux side panel at 600 px, which is the same tier. Only daisyUI 5 components on the spec-light and spec-dark tokens and the existing `shared/ui` primitives are used (`ui-card`, `ui-meter`, `ui-chip`, `ui-id-chip`, `ui-empty-state`, `ui-skeleton`, `ui-disclosure`). No new colour and no literal value.

#### Where the pages sit (answers the routing fog line; ISC-103, ISC-104)
- **Routes of their own:** `/w/:ws` (Specs, today's list), `/w/:ws/features` and `/w/:ws/milestones`. They are not tabs of the workspace page. Each page is deep-linkable and gives the breadcrumb and the palette (ISC-106) a real target.
- **Reached through the area menu, which gains a workspace level.** Today the row-2 trigger reads "Areas" on `/w/:ws` and names nothing. On workspace routes it instead names the current workspace page:
  - `list` Specs, `layers` Features, `flag` Milestones.
  - Its bottom sheet lists those pages as 56 px rows. Each row has its icon, name, a one-line summary ("4 features · 61/78 closed", "2 milestones · next Nov 30") and `aria-current="page"`.
  - The sheet uses the same registry, component and focus rules as the six spec areas (DS-APP-34, DS-APP-35). This is exactly the Dashboard pattern: an area with no tabs, so row 2 stays trigger · (empty) · zen.
  - The header keeps its seven controls (ISC-73).
- **On spec routes the area sheet stays the six spec areas.** Going up a level is the breadcrumb's job.
- **Milestones absent (ISC-104).** While no spec carries `milestone:`:
  - The sheet lists only Specs and Features. There is no disabled row and no "comes later" reason, because this is absence, not an unbuilt area.
  - The palette has no milestone entry.
  - `/w/:ws/milestones` renders the shell's not-found page in place, never a redirect and never an empty state.
  - If the last milestone disappears on a live refresh while the page is open, the page turns into not-found with a link to Features.

#### Features page `/w/:ws/features` (ISC-103, ISC-100.1, ISC-100.3)
- **Page head (scrolls):**
  - H1 "Features", Sora 24/32.
  - The word "Features" in the H1 is the glossary `<dfn>` of design 002 (dotted underline, hint popover on hover, focus-visible and tap): "Epic in a ticket tracker" (ISC-107; parent decision, § Viewport-übergreifend).
  - Then one summary line, 13/20 mono tabular: "4 features · 61/78 claims closed · 5 unheld". The totals are the master's recount (ISC-100.2).
- **Rows, one `ui-card` per feature block, in master order (F0, F1, …):**
  - Never re-sorted by progress, so the list reads like `ISA.md`.
  - 16 px padding at compact, 8 px between rows, 12 px radius, 1 px `--line`.
  - Each card carries `id="F2"` and `tabindex="-1"` so the breadcrumb and the palette can land on it. On arrival it gets a 2 px `primary` outline that fades over `--motion-duration-slow`; the outline is static under reduced motion.
- **Row anatomy, top to bottom:**
  1. A grid `auto minmax(0,1fr) auto`:
     - The F-id in mono 13/20, `--disp-ink`. This is new against the Ist block heading, where the id was set in the heading face.
     - The feature name, 15/24 weight 600, clamped to two lines.
     - The fraction "25/30", mono tabular 13/20, right-aligned.
  2. `ui-meter` at full width, 8 px high with a full radius, in the closed tone. `aria-valuetext` is "25 of 30 claims closed". The fraction above keeps the state from being colour-only. The fill meets 3:1 against the track and the card in both themes (DS-APP-33); the grey track is already near 3.3:1 and must not drift (ISC-65).
  3. The unheld line, 12/16:
     - Above zero: `circle-dashed` plus "2 claims unheld", in `base-content`.
     - At zero: `circle-check` plus "Every claim held", in `--muted-ink`.
     - It is text, not a link, because no unheld view exists.
  4. The Why line, 13/20 in `--muted-ink`, with the same wording as the Ist block heading. It is clamped to two lines with the spec head's "more" disclosure, and long tokens use `overflow-wrap: anywhere`.
  5. The holding specs, as `ui-chip` links that wrap with an 8 px gap. The visual size is 28 px; the hit area is 44 px under a coarse pointer.
     - An active spec's chip is the mono id plus the stage word ("002 Build").
     - A spec whose main feature is this block comes first, with a solid border.
     - A spec that only holds claims here has a dashed border. Its accessible name ends in ", main feature F7", so the difference is shape and text, not colour.
     - **An archived spec's chip is `archive` glyph + "001 Archived" in `--muted-ink` on `base-100`**, with no stage word, no command chip and no warning. It never carries a next step (ISC-100.3). It still links to the archived spec's page.
     - Past four chips, three show and a "+n more" chip expands the rest in place.
- **States:**
  - Loading: three skeleton cards.
  - No master, or no feature blocks: `ui-empty-state`, "Features come from the feature blocks of ISA.md", with no action.
  - An unreadable workspace: the shell's existing unavailable line.

#### Milestones page `/w/:ws/milestones` (ISC-102, ISC-104)
- **Head:**
  - H1 "Milestones".
  - The caption "Ordered by target date". Milestone is already the tracker word, so it needs no term hint.
  - The summary "2 milestones · next Nov 30, 2026".
- **Rows, one `ui-card` per milestone, by target date ascending:**
  - The card id is the milestone slug, as the breadcrumb target.
  - **Row anatomy:**
    1. `flag` + name (15/24 600, two-line clamp), with the target date on the right, formatted with `Intl` medium date in the UI language (ISC-22).
    2. A state line, 12/16, answering the late-state fog line:
       - Target in the future: "in 62 days", muted.
       - Target passed with open claims: a warning-tone chip `clock-alert` "12 days late", text plus glyph.
       - Every claim closed: a success chip `circle-check` "Done".
       - A milestone whose specs are all archived falls out of the same derivation. It is not a separate "archived" state.
    3. The meter and fraction across every feature the milestone touches, styled as on the Features page.
    4. The eyebrow "FEATURES" (11/16, uppercase, .08em), then chips "F2 12/14" that link to `/w/:ws/features#F2`.
    5. The eyebrow "SPECS", then the same spec chips as on Features, archived specs marked the same way and included (ISC-102).
- **Unknown milestones:** a spec naming a milestone the master's block lacks (ISC-101.1) adds no row here. Its warning lives in that spec's Status warnings.

#### Breadcrumb on every spec route (ISC-105)
- **It comes back at compact.** Spec 002 dropped the breadcrumb here, and ISC-105 now requires it on every spec route.
- **Placement:** one line at the top of the spec head, scrolling away with it. It is not sticky, because the 92 px header already costs enough.
- **Markup and type:** `<nav aria-label="Location"><ol>`, 13/20 in `--muted-ink`, 44 px high under a coarse pointer.
- **Levels at compact:** `flag` milestone · `F2` feature › `002` › `ISC-51` (or `T12` on a task).
  - Workspace and area are left out, because the header pill and the row-2 trigger already carry them.
  - The spec level is the mono id alone, because the H1 carries the title one line below.
  - The milestone is absent when the spec has none.
  - The separators are `aria-hidden`.
- **Links:**
  - Milestone → `/w/:ws/milestones#slug`.
  - Feature → `/w/:ws/features#F2`.
  - Spec → the spec dashboard.
  - Claim or task → its own anchor in Data, carrying `aria-current="page"` as the last level.
  - When no claim or task is open, the spec id is the last level.
- **Which feature:** on a claim or task, the feature level is that claim's own block. Otherwise it is the spec's main feature, the first word of `isa_feature`. A spec holding several blocks gets a "+4" chip after it, which opens a small sheet listing the other features as links (ISC-100.1).
- **Archived spec:** the spec level shows `archive` glyph + id, with an accessible name ending in ", archived". The word "Archived" is in the head's chip row directly below, in place of the stage chip. The levels are otherwise identical, and none offers a next step.
- **Fitting 358 px:** the line never wraps.
  - The ids (milestone name, F-id, spec id, claim id) never truncate.
  - The feature name truncates first, down to the F-id alone.
  - Next the milestone name truncates, to at most 96 px.
  - Truncated names keep their full text in the accessible name.

#### Term hints (ISC-107)
- Design 002's glossary `<dfn>` pattern, as decided by the principal (§ Viewport-übergreifend): the level word in the page head carries a dotted `--muted-ink` underline, `tabindex="0"` and a native `popover="hint"` that opens on hover, focus-visible and **tap**, so touch gets the hint too. Breadcrumb levels carry the hint as `aria-description` plus the same popover on focus-visible.
  - Feature → Epic.
  - Spec → Story.
  - Claim → Acceptance criterion.
  - Task → Sub-task.
- The visible vocabulary stays Feature · Spec · Claim · Task · Milestone, and both catalogues carry every hint.

#### 600 px container, the cmux panel (ISC-103.1)
- **Same layout, stretched to 568 px of content:** one column of cards, with no second column below 640. The Why line is capped at 72ch.
- **What keeps the page free of horizontal overflow:**
  - Every row grid uses `minmax(0,1fr)` and `min-inline-size: 0`.
  - Chips wrap.
  - Meters are fluid.
  - Names clamp or ellipsize.
  - Only icons have a fixed width.
  - Row 2 has no tab strip on workspace routes.
  - The breadcrumb truncates instead of wrapping.
- The only things that change between 390 and 600 are how many chips fit per line and fewer clamped names.

#### Themes
- **Light:** a tinted page with bright cards.
- **Dark:** the page is the darkest surface and cards sit one step lighter (DS-APP-06).
- **Contrast in dark:** the archived chip and the unheld line use `--muted-ink` on `base-100` only, never on a tint, which keeps them at about 4.6:1 (ISC-64, ISC-65).
- **Late and Done chips:** use the warning and success ink tokens for text.
- **Focus:** the global `:focus-visible` ring applies on every chip and breadcrumb link (ISC-66).
- **Baselines:** Features and Milestones get baselines at 390 in both themes (ISC-108, ISC-108.1).
- **Read-only:** no route or link on these pages writes anything (ISC-109).

## Tablet (820)

### Ist

![](.design/tablet-ist.png)

**Workspace page `/w/harbor`, light theme, 820 px (medium tier).** The header is one 64 px row with a hairline rule below it. On the left, one bordered, rounded group about 453 px wide (x 24–477) holds:
- the ring and the "spectant" wordmark with "ant" in lime,
- the workspace picker (folder icon, "harbor", chevron),
- the spec picker (file icon, the bare count "5", chevron), which shows no "active" word, so the number has no label,
- the area menu trigger (grid icon, "Areas", chevron).

On routes without a spec, the area trigger reads the generic "Areas". In code (`area-menu.ts`, `areaLink()` returns null without an open spec), each of its six entries renders as a non-link. The one menu trigger at workspace level therefore opens onto nothing to navigate to. On the right are the palette button (bordered 40 px square, magnifier), a grey live dot with no border, zen (expand arrows) and settings (gear). The palette button alone has a border, so the four tools do not share one visual weight.

The page body has these parts:
- **H1** "Specs in harbor", Sora, about 24/32, bold, at x 24.
- **Five full-width cards** (x 24–796), about 44 px tall, 8 px apart, 1 px border, 12 px radius, on a warm tinted page. Each card holds a mono cyan id, the spec's task sentence (not its title) and a cyan-tinted stage pill on the right: 004 Code review, 005 Review, 006 Review, 002 Build, 003 Tasks.
- **Order:** the rows are in neither id order nor stage order (004, 005, 006 above 002, 003).
- **Missing information:** no progress, no feature, no milestone and no archived spec. harbor's `archive/001-manifest-sync` does not appear anywhere.
- **Empty space:** below the list, roughly 520 px of the 900 px frame is empty page tint.

Nothing on this page places a spec in a feature or a release.

![](.design/tablet-ist-spec.png)

**Spec page `/w/harbor/s/002`, Data area, Claims tab, same width.**

*Header.* The group grows to about 569 px (x 24–593). The spec picker reads "002 Show every syn…", cut with an ellipsis, and the area trigger reads "● Data" with a cyan dot.

*Breadcrumb line.* It sits under the header at 13/20, muted: "← harbor / 002 web-console / Data". It has an arrow-left glyph before the workspace, "/" as the only separator, and the current area in body ink with `aria-current`. There is no feature and no milestone level.

*One spec, three names.* The same spec is named three ways on one screen:
- the picker uses the task sentence,
- the breadcrumb uses the slug "web-console",
- the head uses the title "Web console".

*Spec head.*
- A mono cyan "002" and the title "Web console" in Sora bold about 24 px.
- A grey "feature" chip and a cyan "● Build" chip.
- An action row: the command chip "/spec-implement 002" with a copy icon, a filled violet "Notes" pill, and a green-outlined "Reviewed Mar 7, 2026, 4:30 PM" with a check-circle.
- A two-line description, "updated 7 months ago · round 3", and "No agent source · writes check the file hash only".

*Tab bar.* A bright band with Claims 25/30 (current, cyan underline), Tasks 27/32 and Evidence.

*Filters.*
- The state chips: All 30 (selected, cyan outline), open 5, takeable 4, taken 0, blocked 1, closed 25, dropped 0.
- The kind chips: All kinds 30, Anti 0, Antecedent 0, then a search field "Search ID or text".
- A "30 of 30" count.

*Feature grouping, the ancestor of the Features page.* A block heading "F2 · Web console" in sans semibold about 16 px. "F2" is set in the same face as the name, not in mono. A bare "30" sits right-aligned with no unit, and it counts all claims, not closed/total. Under it is a muted Why line: "Why: a teammate who never touches the CLI can see what was mirrored, when, and what failed."

*Claim cards.* Each card shows a green state dot, a mono cyan id (ISC-51, ISC-52), a violet note-count pill "1" on the right, the claim text, and a probe row: an "e2e" chip plus wrapped mono text with a pink "● severity high" dot. A "VERIFIED" line gives the run and its date.

The grouping has no progress bar. The heading does not say which specs other than 002 hold F2's claims, and it is not a link.

**Prototype of the Soll** ([Prototyp](.design/prototype/index.html)): Features page, spec head with the breadcrumb, Milestones page in dark.

![](.design/tablet-prototype.png)
![](.design/tablet-prototype-spec.png)
![](.design/tablet-prototype-milestones-dark.png)

### Soll

Medium container tier (640–1119 px), 820 reference: 24 px gutters, 772 px content column, no context rail. daisyUI 5 on the `spec-light` / `spec-dark` theme blocks only; semantic aliases from `tokens.css`, no literal colour in a component (DS-APP-01/02). Primitives reused, none forked: `ui-card`, `ui-meter`, `ui-chip`, `ui-id-chip`, `ui-empty-state`, `ui-section-header`, the overlay/popover primitive. New lucide names go into `icon-names.ts`: `layers`, `flag`, `circle-help`, `circle-dashed`, `clock-alert`, `target`. `archive` exists.

#### Placement in the shell (fog line of the spec, ISC-103, ISC-104)

The recommendation is **own routes beside the spec list**: `/w/:ws` (Specs), `/w/:ws/features` and `/w/:ws/milestones`. They are reached through the **area menu, which on workspace routes becomes the workspace menu**:

```
| ◯ spectant | harbor ⌄ | 5 active ⌄ | ⊞ Features ⌄ |              [⌕] [●] [⛶] [⚙] |
                                       └ popover: ☰ Specs       all specs of harbor      g w
                                                  ≡ Features    7 · 142/188 closed       g f
                                                  ⚑ Milestones  2 · next Nov 14          g m   ← only when any spec carries one
```

- **Why the area menu, and not tabs on the workspace page.** Today the trigger at `/w/:ws` reads "Areas" and offers six spec areas that cannot be opened: a dead control in the most valuable slot of the header. Filling it with the workspace's own pages repeats the spec-route pattern: the menu names where you are, and the trigger label is the current page ("Specs", "Features", "Milestones"). No second navigation strip is needed. Tabs on the workspace page would give the same move two homes and put three pages into one component. Own routes keep router state explicit and deep-linkable (`/w/harbor/features#F2`).
- **Menu entries.** Each entry is a native `popover` entry with its icon, a one-line summary from the tree and its `g` key. The current entry carries `aria-current="page"` (DS-APP-37). The trigger label is capped at 120 px, like the pickers.
- **Milestones is absent, not disabled, while no spec names one** (ISC-104). There is no entry, no palette row, and `/w/:ws/milestones` renders the shell's not-found state with a link to Features. This differs on purpose from spec 002's disabled Live/Notes entries: those are unbuilt features, while here the data says the level does not exist. The trigger width does not move, because only the popover's content changes.
- **Other ways in.** The breadcrumb's feature and milestone crumbs (ISC-105) and the palette (ISC-106) reach the same routes. The spec picker at workspace level reads "5 active" (the Ist's bare "5" gets its unit).
- **Keys.** `g f` and `g m` are proposed as additions to ISC-97's list; `g s` already reaches the Specs panel on `/w/:ws` (001 design.md § Command palette and keyboard) and stays Status inside a spec.

#### Features page `/w/:ws/features` (ISC-103, ISC-100 to ISC-100.3)

**Page head.**
- H1 "Features in harbor", Sora 24/32, matching "Specs in harbor"; the word "Features" is the glossary `<dfn>` (see Vocabulary hint).
- One muted summary line at 14/20, tabular-nums: "7 features · 142 of 188 claims closed · 12 not held by a spec". The sum is the master recount (ISC-100.2), so it is safe to show once at the top.

**Rows.** One `ui-card` per feature block, in master order (F0, F1, …), 8 px apart, 16 px inner padding (740 px inner width). The row is not one big link: it contains several links.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ F2  Web console                                              25 / 30 closed  │
│ ████████████████████████████████████████████████████████░░░░░░░░░░░░░░░░░░░ │
│ Why: a teammate who never touches the CLI can see what was mirrored, when…   │
│ [◎ 002 web-console · 30]  [▣ 001 manifest-sync · 4 · archived]  ◌ 2 unheld ▸ │
└──────────────────────────────────────────────────────────────────────────────┘
```

1. **Line 1.**
   - The F-id in mono cyan 13/20 (`ui-id-chip` ink, fixing the Ist's sans "F2").
   - The name in Sora 16/24 semibold, wrapping with `overflow-wrap: anywhere` and never truncated.
   - On the right, the count "25 / 30 closed" in mono tabular-nums 13/20, muted, replacing the Ist's unlabelled "30".
   - A complete feature adds a `circle-check` glyph and the word "complete" in success ink: text plus icon, never colour alone.
2. **Line 2.** `ui-meter` single, 6 px, full width, lime→cyan fill, `aria-label` "F2 Web console: 25 of 30 claims closed". It uses `transform` only and is static under reduced motion.
3. **Line 3.** The Why line in muted 14/20, unclamped (one sentence by format), the direct descendant of the Ist's grouping line.
4. **Line 4.** A flex-wrap row with an 8 px gap:
   - **Holding-spec chips.** Each chip is a link to the spec dashboard: mono id plus slug, then "· n", the number of this feature's claims the spec holds.
     - *Main feature* (the first word of `isa_feature`, ISC-100.1): the chip is tinted `primary` at low alpha and leads with a 12 px `target` glyph. Shape and glyph carry it, and the accessible name ends in ", main feature".
     - *Also holds*: an outline chip with no glyph.
     - *Archived* (ISC-100.3): a leading `archive` glyph, muted ink on `base-200`, a dashed 1 px border and the visible word "archived". There is never a stage chip, next-step command or warning, and the link opens the archived spec read-only as today.
     - Order: active specs by id, archived ones last.
   - **Unheld count** at the row end: `circle-dashed` glyph plus "2 unheld". It is muted at 0 and in `warning-content` ink with the glyph when above 0. It is a native `<details>` disclosure (44 px target on coarse pointers). Opened, it lists the unheld claim IDs in mono with their text on one line each, below line 4. This is the one place such claims become visible without a drift run.
- **Deep links.** The row has `id="F2"` and `tabindex="-1"`. A `#F2` fragment scrolls it under the 64 px sticky header (`scroll-margin-top: 80px`), focuses it and shows the focus ring once. There is no flash animation.
- **Empty state.** When the workspace has no master or the master has no feature blocks, `ui-empty-state` explains that features come from the master's feature blocks and names the command. The palette then offers no features.

#### Milestones page `/w/:ws/milestones` (ISC-102, ISC-104)

The page head is H1 "Milestones in harbor" (no term hint: Milestone is the tracker word already) and a summary line: "2 milestones · next: Harbor 1.0, Nov 14, 2026". Rows are ordered by target date, with the same card metrics as Features.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⚑ Harbor 1.0                                   Nov 14, 2026 · in 46 days     │
│   First release a teammate can install.                     38 / 52 closed   │
│ ██████████████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ Features  [F2 Web console 25/30] [F3 Config loader 9/14] [F5 Retention 4/8]  │
│ Specs     [◎ 002 web-console] [003 config-loader] [▣ 001 manifest-sync · archived] │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Line 1.** A `flag` glyph, the name in Sora 16/24 semibold and the optional master description in muted 14/20 below it. On the right, the target date formatted by `Intl` in the UI language plus a relative "in 46 days" (frozen clock in baselines).
- **Line 2.** A cross-feature meter plus "38 / 52 closed", archived specs included.
- **Lines 3 and 4.** Two labelled chip rows ("Features", "Specs"; the label is muted 12/16 uppercase-free at a fixed 72 px, and the chips wrap in `minmax(0,1fr)`).
  - Feature chips link to `/w/:ws/features#F2` and carry their own "n/m", mono.
  - Spec chips use the Features page's spec chip unchanged, archived treatment included.
- **Late state (fog line of the spec).** The recommendation is a text chip "late · 12 days" with `clock-alert` in `warning-content`, shown only when the date has passed and claims are open. A passed milestone with every claim closed shows `circle-check` "complete" instead. The date itself is never recoloured.
- **Unknown milestone.** A `milestone:` naming no master entry (ISC-101.1) adds no row here; its warning lives in that spec's Status warnings (parent decision, § Viewport-übergreifend; the designer had proposed a last row "Not in the master's Milestones block").
- **Anchors.** Each row has `id="m-<slug>"` for breadcrumb links.

#### Breadcrumb on every spec route (ISC-105)

It extends the existing line in `spec-head` (13/20, muted, flex-wrap, gap 4 × 8 px) and keeps its arrow-left and workspace crumb. The separators follow the spec's notation, each with a meaning:
- "/" separates the workspace scope from the plan path.
- "·" joins the milestone and the feature, which are peers (a milestone spans features).
- "›" descends a level.

```
← harbor / ⚑ Harbor 1.0 · F2 Web console +4 › 002 web-console › Data › ISC-51
```

- **Links and levels.**
  - The milestone links to `/w/:ws/milestones#m-…`, and the feature to `/w/:ws/features#F2` (F-id in mono).
  - The spec links to its dashboard: its display name comes from `spec.md` alone, so the Ist's three names become one.
  - The area links to the area's first tab.
  - A claim or task (open claim detail, a Tasks row or a `#ISC-…` fragment) is the last crumb, mono, with `aria-current="page"`. Without one, the area keeps `aria-current` as today.
- **Several features.** The spec's main feature is the feature crumb. When the open claim or task belongs to another block, that block becomes the crumb, because the path is where you stand. A "+4" button after it (a native `popover`, 44 px coarse target, accessible name "4 more features") lists the other blocks as links.
- **No milestone.** The segment and its "·" are not rendered, so no separator dangles.
- **Unknown milestone.** The name is plain text with `triangle-alert` and hint text, not a link.
- **Archived spec.** The same full path. The spec crumb leads with the `archive` glyph and reads "001 manifest-sync (archived)". There is no stage or next-step affordance in the line.
- **Separators** are CSS generated content on `li + li::before`, chosen per level by a data attribute. Screen readers get a `<nav aria-label="Breadcrumb">` with `<ol>`, so the separators are not announced.
- **Width at 820.** The longest realistic line is about 520 px of 772, one line. Longer names wrap at crumb boundaries, never truncate, and never scroll.

#### Vocabulary hint (ISC-107)

The visible words stay Feature · Spec · Claim · Task · Milestone everywhere.
- **Page heads.** Design 002's glossary `<dfn>` pattern, as decided by the principal (§ Viewport-übergreifend): the level word in the H1 ("Features") and "claims" in the meta line carry a dotted `--muted-ink` underline, `tabindex="0"` and a native `popover="hint"` that opens on hover, focus-visible and tap, with `aria-describedby`; focus returns to the term (DS-APP-34/35). The designer's alternative, one `circle-help` term card per page head, was not chosen.
- **Breadcrumb.** Each level carries the term in its accessible description (`aria-describedby` to a visually hidden "Feature, called Epic in ticket trackers") plus a `title` for fine pointers. Adding icons to every crumb would be noise.
- **Catalogues.** Both EN and DE (ISC-22) hold these strings; DE keeps the English tracker terms, since that is what Jira shows.

#### 600 px container: cmux side panel (ISC-103.1)

600 px falls in the **compact** tier (below 640), so the panel gets the compact header of spec 002 and not this layout. What this viewport guarantees is that none of the above holds a fixed width.
- **Rows.** Row grids are `minmax(0,1fr) auto`, and names wrap.
- **Count on line 1.** The count ("25 / 30 closed") drops to the meter's line when line 1 is narrower than about 360 px, through a container query on the card.
- **Chip rows** wrap, and the Milestones "Features" and "Specs" labels move above their chips.
- **Other widths.** The unheld disclosure and the term popover are `max-inline-size: 100%`, and the meter has no minimum width.

The result is `scrollWidth == clientWidth` on both pages with no inner scroller.

#### Themes and accessibility (ISC-108, ISC-108.1, ISC-64 to ISC-66)

- **Theme values.**
  - In light, the cards are `base-100` on the tinted page. In dark, the page is the darkest surface (DS-APP-06).
  - The archived chip's muted ink on `base-200` must hold 4.5:1 in dark, because it sits next to the already narrow muted-on-card value (about 4.6:1) and must not drift.
  - The meter track and the dashed archived border hold 3:1 (DS-APP-33).
- **Not colour alone.** Main, archived, late, complete and unheld each carry a glyph and a word.
- **Targets and focus.** Every chip link and disclosure has a 44 px hit area under `pointer: coarse`. Focus uses the global cyan ring.
- **Motion.** No motion beyond the meter's transform, which is off under reduced motion.
- **Baselines.** At 820, in both themes, on the harbor fixture with milestones and on the fixture without, so both states of the menu are pinned.

## Desktop (1440)

### Ist

![](.design/desktop-ist.png)

**Workspace page `/w/harbor`, light theme, 1440 × 900.** The page is the warm tinted `base-200`; nothing on it is a planning view yet.

**Header (64 px, hairline under it).**
- **Left group:** one bordered field from x 32 to about x 481 that holds:
  - the wordmark (ring, "spect" in ink, "ant" in lime ink);
  - a rule;
  - the workspace picker (`folder-git-2`, "harbor", chevron);
  - the spec picker (`file-text`, a bare "5", chevron). The number has no noun, although design 002 names "6 specs".
  - the area menu (`layout-grid`, "Areas", chevron). With no spec open, it still shows a generic label.
- **Right group:**
  - the palette field (240 px), whose placeholder is cut to "Jump to spec, workspa…", with a `⌘K` key;
  - a grey live dot with no "Updated n s ago" text;
  - zen (`maximize-2`);
  - the gear.

**Content.**
- H1 "Specs in harbor" in Sora 24/32 at x 32.
- Five rows with 8 px gaps. They are about 44 px high and 1000 px wide (x 32 to 1031), each a 1 px bordered card:
  - a mono id in cyan;
  - the spec's task line;
  - one teal stage chip on the right ("Code review", "Review", "Review", "Build", "Tasks").
- The rows run 004, 005, 006, 002, 003, so they are sorted by stage, not by id.
- The fixture's archived `001-manifest-sync` does not appear anywhere.
- No row shows progress, a feature or a milestone.
- There is no rail. The right 376 px and the lower 520 px are empty.

![](.design/desktop-ist-spec.png)

**Spec page, harbor 002, Data › Claims, same width.**
- **Header.** The spec picker widens the left group to about x 727: `002` in muted mono, then "Show every sync run and its failures …" cut with an ellipsis. The area menu shows a cyan dot and "Data".
  - The picker shows the spec's task line, while the head below shows the title "Web console". Design 002 wants one name in the picker, the head and the breadcrumb, and these two do not match yet.
- **Breadcrumb (row 1, 13/20 muted):**
  - `arrow-left`, then "harbor", "/", mono "002" plus "web-console", "/", then "Data" in full ink as the current item.
  - It has three levels: workspace, spec and area. It has no feature, milestone or claim level.
- **Title row:**
  - mono "002" 24/32 in cyan, "Web console" in Sora;
  - a grey "feature" chip and a "• Build" stage chip;
  - on the right: the command chip `/spec-implement 002` with copy, a solid violet "Notes" pill, and a green outlined "Reviewed Mar 7, 2026, 4:30 PM".
- **Below the title:**
  - the description (two lines) and the meta line "updated 7 months ago · round 3";
  - the no-source line.
- **Tab bar:** Claims 25/30 (active, cyan underline), Tasks 27/32, Evidence. It sits on a light band that ends at x 1031.
- **Filters:**
  - state chips: All 30 (selected), open 5, takeable 4, taken 0, blocked 1, closed 25, dropped 0;
  - kind chips: All kinds 30, Anti 0, Antecedent 0;
  - a search field;
  - "30 of 30".
- **Feature group, the visual ancestor of the Features page:**
  - the heading "F2 · Web console" (17/24, 600) with a bare muted "30" at the right edge. The 30 is the group's total; nothing shows closed against total, and there is no bar.
  - under it, the line "Why: a teammate who never touches the CLI can see what was mirrored, when, and what failed." (13/20 muted), about 24 px below the heading. That gap is looser than the 16 px step between the heading and the cards.
  - The heading is plain text, not a link, and no other feature is listed on the page.
- **Claim cards:**
  - a green state dot, a cyan mono `ISC-51`, and the claim text;
  - a probe row: an `e2e` chip, the mono probe, and "• severity high" with a pink dot;
  - a "VERIFIED …" eyebrow line;
  - a violet count badge "1" at the top right.
- **Rail (x 1056 to 1407):** a `panel-right-close` toggle at the top right. Below it, a "Spec context" card still carries its placeholder text ("…come with a later task.").

**Prototype of the Soll** ([Prototyp](.design/prototype/index.html)): Features page, spec head with the breadcrumb, Milestones page in dark.

![](.design/desktop-prototype.png)
![](.design/desktop-prototype-spec.png)
![](.design/desktop-prototype-milestones-dark.png)

### Soll

The design follows the app track of DESIGN.md:
- **Colours:** only the `spec-light` and `spec-dark` slots and the aliases in `tokens.css`; accent text uses its `-ink` token (DS-APP-01/02/06).
- **Components:** own primitives from `shared/ui/` and lucide icons (DS-APP-21/24).
- **Accessibility:** native semantics first (DS-APP-37).
- **Motion:** motion tokens only (DS-APP-41/42).

At 1440 the shell is in the wide tier, the page is tinted and the cards are bright (dark: the page is darkest, DS-APP-06). Spacing stays on the 8 px scale, and the type scale is design 002's.

**New primitives and icons.** No new primitive is needed. The pages reuse:
- `ui-meter`
- `ui-chip`
- `ui-id-chip`
- `ui-section-header`
- `ui-empty-state`
- the glossary `<dfn>` pattern of design 002

Two lucide icons are added through `icon-names.ts` (ISC-18.2): `flag` for milestones and `circle-dashed` for unheld claims. `archive`, `layers`, `timer`, `circle-check` and `chevron-down` already exist.

#### Where the pages sit (resolves the fog line of the spec; see crossViewport)

**Routes.** Features and Milestones get routes of their own, `/w/:ws/features` and `/w/:ws/milestones`, beside `/w/:ws`. That keeps the working assumption of ISC-103. They are not tabs of the workspace page.

**Area menu.** The header's area menu becomes scope-aware:
- **At workspace scope** its entries are Specs (`file-text`, `/w/:ws`), Features (`layers`) and Milestones (`flag`). The trigger's label is the current page name instead of the generic "Areas" seen in the Ist.
- **At spec scope** it keeps the six areas of spec 002.

This is the one home of the page switch. ISC-104 already speaks of "the area menu" at this level, and design 002's rule stays intact: the area menu says where you are, and the tab bar picks a sub-view inside an area. The workspace pages therefore draw no tab bar, because a three-item tab bar would be a second home for the same switch.

**Other ways in:**
- the palette (ISC-106);
- the feature and milestone links in every breadcrumb (ISC-105);
- the `#specs` anchor pattern: each row carries its id (`#F2`, `#m-<slug>`) as a `tabindex="-1"` target that the router scrolls to and focuses.

**Page frame.** All three workspace pages use the spec route's main column: 992 px, left edge x 32, no rail. The left edges of the heading and the rows match every spec route, and switching Specs ↔ Features ↔ Milestones never shifts the column. A rail would need content that no claim asks for, so none is added.

**Page head** (the same on both pages):
- **H1:** Sora 24/32, "Features in harbor" or "Milestones in harbor", in the pattern of the Ist's "Specs in harbor". It carries `id` and `tabindex="-1"`.
- **Meta line:** 13/20 muted, all counts mono tabular. Features: "12 features · 187/240 claims closed · 9 unheld". Milestones: "3 milestones · next: v0.3, Oct 31, 2026".
- **Gap:** 24 px to the first row.

#### Features page `/w/:ws/features` (ISC-103, ISC-100 to ISC-100.3)

**List and order.** An `<ol>` with one `<li><article>` per feature block, in master order (F0, F1, …). The rows are cards: `base-100`, 1 px `--line`, 12 px radius, padding 16/24, 16 px apart.

**Row grid.** `grid-template-columns: minmax(0,1fr) 240px`, column gap 32, `align-items: start`.

**Left stack:**
1. **H2 (17/24, 600):** the mono F-id in `--disp-ink` ("F2"), a "·", then the block name ("Web console"). This is the same line as the Ist's group heading, now with its progress next to it. Long names wrap; they are never cut.
2. **Why line:** "Why: …" in 13/20 muted, `max-inline-size: 72ch`, clamped to two lines with the full text in `title`. It sits 4 px under the heading, closing the loose 24 px gap seen in the Ist.
3. **Holding specs:** a flex-wrap chip row, 8 px gaps, 12 px above it. The row is labelled by a visually hidden "Specs" (the `<dfn>` hint sits on the page's level header, see below). Each chip is a link to `/w/:ws/s/:id`:
   - **Content:** mono `002`, the slug, then "· 8" for the claims of this block that it holds (tabular).
   - **Main-feature chip** (ISC-100.1): comes first, in `primary` tint with `--disp-ink` text and a leading 6 px `primary` dot. Its accessible name ends "main feature". Colour is never the only signal: the dot and the accessible-name suffix carry it too.
   - **Other active holders:** neutral outline chips.
   - **Archived holder** (ISC-100.3): comes last. It has a transparent background, a solid 1 px `--line` border, a 14 px `archive` icon, and text in `--held-ink`. `title` and the accessible name read "archived". It has no stage chip, no command chip, no next step and no warning tone, and it is still a link, because the archived spec route exists (ISC-105).
   - Held text never sits on `--held-t`, following the note in `tokens.css`. The chip's slug gets an ellipsis at 200 px; the id never does.

**Right stack**, right-aligned:
1. **Progress:** `ui-meter`, 160 × 6 (lime → cyan fill, `--track` track, `aria-label` "F2 claims closed"), then "25/30" in 13/20 mono tabular, 12 px apart, on the heading's first line box.
   - A complete feature swaps the count's ink for `--done-ink` and adds a 14 px `circle-check`.
   - A block with no claims shows an empty track and a muted "0/0".
2. **Unheld claims**, 8 px below:
   - 14 px `circle-dashed`, then "4 unheld" in `--conc-ink`, tabular. This is a concern, not a warning, so there is no fill.
   - At 0 it reads "all held" in `--muted-ink` with no icon.
   - The count is a link to the master drift view only if one exists. Until then it is text, never a dead link.

**Keyboard and focus.** Rows are not whole-row links, because they contain several links (the chips). Tab order runs through the chip links in reading order, and every chip has the global `:focus-visible` ring (DS-APP-38).

**Empty and error states.**
- A master with no feature blocks shows `ui-empty-state`: "No feature blocks in ISA.md", with a mono hint to `## Features`.
- A workspace that is unavailable shows the existing `shell.unavailable` text.

**Themes.**
- Dark: cards are `base-100` on the darker page, and the meter track is `--track` (about 3.3:1; it must not drift darker, ISC-65).
- Main chip `--disp-ink` on its tint: 4.5:1 or better in both themes.
- Archived chip text: `--held-ink` on the card (4.57 in dark). It must stay on the card surface, never on a tint.

#### Milestones page `/w/:ws/milestones` (ISC-104, ISC-102)

**List and order.** An `<ol>` with one card row per milestone, ordered by target date, ascending. A milestone without a date comes last. The card and grid are the Features row's.

**Left stack:**
1. **H2:** 16 px `flag` in `--muted-ink`, then the name, 17/24 600.
2. **Date line**, 13/20: the target date via `Intl` in the UI language ("Oct 31, 2026"), then a "·", then the relative part:
   - **upcoming:** muted "in 32 days";
   - **passed with open claims:** 14 px `timer` plus "late · 12 days" in `--hover-ink`. This is my recommendation for the fog line: a derived state carried by icon and word, never colour alone.
   - **every claim closed:** `circle-check` plus "complete" in `--done-ink`.
   - **every spec archived:** also "complete", derived from the claims. The archive is a property of the specs, not of the milestone, which answers the last fog line together with ISC-101's "derived is the default".
3. **Description:** the master's optional description in 13/20 muted, 72ch, clamped to two lines.
4. **Features touched:** a chip row labelled by a hidden "Features". Chips read mono `F2` plus the name (ellipsis at 200 px) plus "· 8/10". Each links to `/w/:ws/features#F2`.
5. **Specs:** a chip row with the same chips as on the Features page, archived ones marked the same way, no main-feature dot. Each links to the spec.

**Right stack:** the same meter and count as a Features row, closed/total across every feature the milestone touches (ISC-102). There is no unheld line, because a milestone is defined by the specs that name it.

**Absence** (ISC-104). While no spec of the workspace, archived ones included, carries `milestone:`:
- the area menu has no Milestones entry. It is absent, not disabled (see crossViewport);
- the palette has no milestone group;
- `/w/:ws/milestones` renders the existing not-found page;
- the Features page and the breadcrumb show no milestone anywhere.

The area menu is then two entries. The header's left group does not change width, because the trigger's label is the current page's name.

An unknown `milestone:` name (ISC-101.1) does not create a row. Its diagnostic stays where spec 002 shows warnings, never on this page.

#### Breadcrumb on every spec route (ISC-105)

**Placement.** It extends the existing row 1 of the spec head: 13/20, `--muted-ink`, one line, `<nav aria-label>` with an `<ol>`. Levels:

`arrow-left` harbor / `flag` v0.3 · F2 Web console +4 › 002 web-console › Data › ISC-51

**Separators (principal's decision, § Viewport-übergreifend).** "/" separates the workspace scope from the plan path, as in the Ist; "·" sits between the milestone and the feature, because a milestone is a tag of the spec that spans features, not the feature's parent; "›" descends a level. The designer had proposed "/" throughout. Separators are CSS `::before`, `aria-hidden`.

**Levels and links:**

| Level | Rendering | Links to |
|---|---|---|
| Milestone | only when the spec names one; `flag` 12 px plus name, at most 160 px with ellipsis | `/w/:ws/milestones#m-<slug>` |
| Feature | mono `F2` plus the name (ellipsis at 240 px, full name in `title`) | `/w/:ws/features#F2` |
| Spec | as today | the spec's dashboard |
| Area | as today | its first tab (a link now whenever a deeper level follows) |
| Claim or task | mono `ISC-51` or the task id, only while the open tab has one open or selected | — (last item: `aria-current="page"`, full ink) |

**Link styling.** Links underline on hover only, and never with a dotted line (design 002 reserves that for glossary terms).

**Which feature.** The crumb shows the spec's main feature (the first word of `isa_feature`).
- When a claim is open, it shows that claim's own block, so the path stays true.
- A spec holding claims of several blocks adds a "+4" `ui-chip` button after the feature. It opens a native `popover` listing the other features as links, with focus returned to the chip (DS-APP-34/35).

**Archived specs.** The spec crumb gets a 12 px `archive` icon, and its accessible name ends "archived". Every other level is unchanged. Next steps are already absent on archived routes, and the crumb adds none.

**Width.** The row lives in the 992 px main column and never wraps at wide. Truncation order when it overflows: feature name, then milestone name, then the spec slug. Ids are never truncated.

#### Common-term hints (ISC-107)

The visible vocabulary stays Feature · Spec · Claim · Task · Milestone. The common terms appear only as hints, in both catalogues:

| Term | Hint (EN) | Hint (DE) |
|---|---|---|
| Feature | "Epic in a ticket tracker" | "Epic im Ticket-Tracker" |
| Spec | "Story" | — |
| Claim | "Acceptance criterion" | "Akzeptanzkriterium" |
| Task | "Sub-task" | — |

**Level headers.** These use design 002's glossary pattern: a `<dfn>` with a dotted `--muted-ink` underline and `tabindex="0"`, the hint in a native `popover="hint"` that opens on hover, focus-visible and tap, plus `aria-describedby`, so it never lives in `title` alone. The terms:
- the "Features" word in the H1 of the Features page;
- "claims" in the page meta ("187/240 claims closed");
- "Features" and "Milestones" in the H1 of the Milestones page. "Milestone" needs no hint, as it is the common term itself.

The hidden chip-row labels are covered by the H1 hint and do not repeat it.

**Breadcrumb.** Links cannot carry a dotted underline, so each level's link carries the hint as `aria-description` and shows the same hint popover on hover and focus-visible after the standard tooltip delay. The words on screen stay the file vocabulary.

#### 600 px container: the cmux side panel (ISC-103.1)

At 600 px the shell container is in the compact tier (< 640), so the rows follow the compact rules of the shell. I name the rules here because the panel is a desktop surface.

**Rows.**
- One column: `grid-template-columns: minmax(0,1fr)`, padding 16.
- Order in the row: the H2, then the meter full width with the count on its right (`minmax(0,1fr) auto`), then the Why line, then the chip rows, then the unheld line.
- Every grid and flex child sets `min-inline-size: 0`.
- Chips wrap and never scroll. Slugs cut at `max-inline-size: 100%`.
- Feature names wrap. Dates never wrap mid-token.

**Page head.** The H1 wraps to two lines. The meta line wraps at its "·" separators, each part `white-space: nowrap`.

**Result.** `scrollWidth` equals `clientWidth` in both themes, with no horizontal scroll container anywhere on either page.

#### Motion, baseline, palette

**Motion.** The meter fill morphs on `--motion-duration-slow` and is static under reduced motion. Anchor focus to `#F2` scrolls with `scroll-behavior` from the motion tokens, instantly under reduced motion.

**Visual baselines** (ISC-108, ISC-108.1). The fixtures pin a frozen clock so that "in n days" and "late" are stable. They also pin:
- a harbor tree with `## Milestones` and an archived spec that names one (ISC-110);
- a tree with no milestones, whose baseline shows the two-entry area menu.

**Palette** (ISC-106). Two new groups after workspaces and specs:
- **Features:** mono `F2`, the name, and "25/30" on the right;
- **Milestones:** `flag`, the name, and the date on the right. This group is absent under the same rule as the page.

ISC-60's entries keep their order and completeness.

## Viewport-übergreifend

Three Designers worked one viewport each. Where they agreed, the rule is stated once here; where they contradicted
each other, the principal decided (2026-09-29, design pass 003) and the decision is marked. Nothing here is an
acceptance criterion; the claims of ISC-100 to ISC-110 hold those.

### Where the pages sit (resolves the first fog line of spec.md)

All three viewports recommend the same thing, and it is adopted:

- **Own routes**, `/w/:ws/features` and `/w/:ws/milestones`, beside `/w/:ws`. They are not tabs of the workspace
  page. Every row carries an anchor (`#F2`, `#m-<slug>`) with `tabindex="-1"` and `scroll-margin-top` under the
  sticky header, so the breadcrumb and the palette have a real target (ISC-103, ISC-104, ISC-105, ISC-106).
- **Reached through the area menu, which becomes scope-aware.** Today the row-2 trigger on `/w/:ws` reads "Areas"
  and opens six spec areas that cannot be opened, a dead control. At workspace scope the menu lists **Specs ·
  Features · Milestones** and its trigger names the current page; at spec scope it keeps the six areas of spec 002.
  Same registry, same popover component, same focus rules (DS-APP-34/35, ISC-76). No workspace-level tab bar: the
  area menu is the one home of the page switch, and a three-item tab bar would be a second one.
- **The Specs entry is spec 001's dashboard page.** Spec 001 (round 20) builds `/w/:ws` as the workspace dashboard
  page with slots (`features/dashboard/dashboard-page.*`, kpi band, brief, next up, warnings, context rail) and the
  spec preview as `?spec=<id>` query state (001 plan.md § Stack Decisions, 2026-09-29). This spec adds the two
  routes and the menu scope beside it and touches none of those files; the "Specs in harbor" list in the Ist
  captures is the placeholder that page replaces.
- **Page frame.** The two pages use the same main column as the spec routes and the dashboard page (992 px at wide,
  left edge x 32; 772 px at medium; full width minus 16 px gutters at compact). They draw no rail of their own: no
  claim asks for rail content, and the left edge never moves when switching Specs ↔ Features ↔ Milestones or
  entering a spec.
- **Header.** Unchanged in its seven controls (ISC-73). The breadcrumb does not enter the header (see below), and
  the spec picker keeps its place; at workspace scope the picker reads "5 specs" instead of a bare "5" (a wording
  fix for the existing control, no new element).

### Milestones absent, not disabled (ISC-104)

While no spec of the workspace, archived ones included, carries `milestone:`: no menu entry, no palette group, no
milestone crumb anywhere, and `/w/:ws/milestones` renders the shell's not-found page (never a redirect, never an
empty state). This deliberately departs from design 002's rule that unbuilt areas stay as disabled entries: absence
here is a data fact, not an unbuilt feature. The header width is unaffected, because the trigger shows only the
current page name. If the last milestone disappears on a live refresh while the page is open, the page turns into
not-found with a link to Features.

### The breadcrumb (ISC-105)

- **Placement, every tier:** row 1 of the spec head, extending the existing line, scrolling with the head, never in
  the header (the header stays spec 002's; principal 2026-09-29: "ich will den neuen header"). At compact the row
  returns: spec 002 dropped it below 640 (design 002, `spec-head.css` comment "dropped at compact"), and ISC-105
  overrides that; both notes are to be amended by 002's owner when 002 is next edited. One component, whose
  visible levels depend on the tier.
- **Grammar — principal's decision (conflict 1):** `/` separates the workspace scope from the plan path, `·` joins
  milestone and feature (peers: a milestone spans features), `›` descends a level. Chosen over "`›` throughout"
  (Mobile) and "`/` throughout as today" (Desktop) because it matches ISC-105's wording and keeps the existing
  workspace crumb. Separators are CSS `li + li::before` chosen by a data attribute, `aria-hidden`; the markup is
  `<nav aria-label="Breadcrumb"><ol>`.
  - wide and medium: `← harbor / ⚑ v0.3 · F2 Web console +4 › 002 web-console › Data › ISC-51`
  - compact (390 and the 600 px cmux panel): `⚑ v0.3 · F2 › 002 › ISC-51` — workspace and area are left out because
    the header pill and the row-2 trigger already carry them; the spec is its mono id, the H1 carries the title one
    line below.
- **Levels and links:** milestone → `/w/:ws/milestones#m-<slug>` (only when the spec names one; no dangling `·`);
  feature → `/w/:ws/features#F2` (mono F-id plus name at medium and wide, F-id alone at compact); spec → its
  dashboard, display name from `spec.md` alone; area → its first tab (a link whenever a deeper level follows); claim
  or task → mono id as the last crumb with `aria-current="page"` while the open tab has one; otherwise the area (or
  at compact the spec id) is last.
- **Which feature:** the spec's main feature (the first word of `isa_feature`); when the open claim or task belongs
  to another block, that block, because the path is where you stand. A spec holding several blocks gets a "+n" chip
  button after the feature crumb that opens a native `popover` listing the other blocks as links, focus returning to
  the chip (ISC-100.1).
- **Archived spec:** the same path; the spec crumb leads with a 12 px `archive` glyph and its accessible name ends
  ", archived". The word "Archived" sits in the head's chip row in place of the stage chip. No level offers a next
  step (ISC-100.3).
- **Unknown milestone name (ISC-101.1):** plain text with `triangle-alert`, not a link.
- **Width:** one line at every tier, never wrapping. Truncation order: feature name (down to the F-id), then the
  milestone name (at most 160 px wide, 96 px compact), then the spec slug; ids never truncate; truncated names keep
  their full text in the accessible name. Links underline on hover only, never dotted (design 002 reserves dotted
  for glossary terms).

### Archived specs, main feature, unheld claims (ISC-100.1, ISC-100.3)

- **Archived chip, every page and tier:** leading `archive` glyph, the visible word "archived", `--muted-ink` on the
  card surface (never on a tint, to hold 4.5:1 in dark), dashed 1 px border; never a stage chip, command chip, next
  step or warning; still a link, because the archived spec route exists. Archived holders come last in a chip row.
- **Main-feature chip (parent's resolution of three markers):** `primary` tint at low alpha with a leading 6 px
  `primary` dot and an accessible name ending ", main feature"; other active holders are neutral outline chips.
  Shape, dot and text carry it, never colour alone. Mobile's solid-versus-dashed border is not used, because dashed
  is the archived marker.
- **Unheld claims:** `circle-dashed` plus "n unheld" in the concern ink when above 0, "all held" muted at 0; text
  (Mobile, Desktop) or a `<details>` listing the IDs (Tablet) — the disclosure is adopted at every tier, since it is
  the one place such claims become visible without a drift run.

### Milestone states (resolves the late-milestone and all-archived fog lines)

Derived on every tier, never colour alone: target in the future → muted "in n days"; target passed with open claims
→ a warning-tone chip `clock-alert` "late · n days"; every claim closed → success chip `circle-check` "complete",
also when every spec of the milestone is archived (the archive is a property of the specs, not of the milestone).
There is no `done` mark in the master; this is the input to ISC-101's FORMAT.md section, where "derived" is the
default. An unknown milestone name adds no row on the Milestones page (Mobile, Desktop over Tablet's extra row); its
warning lives in the spec's Status warnings.

### Common-term hints (ISC-107) — principal's decision (conflict 2)

Design 002's glossary `<dfn>` pattern at every tier, chosen over a `circle-help` term card per page head (Tablet) and
a visible caption under the H1 (Mobile): dotted `--muted-ink` underline on the level word ("Features" and "claims"
in the Features head, "Features" in the Milestones head; "Milestone" is the tracker word already), `tabindex="0"`, a
native `popover="hint"` opening on hover, focus-visible and tap, plus `aria-describedby`, never `title` alone.
Breadcrumb links cannot carry a dotted underline, so each level carries the hint as `aria-description` and shows the
same popover on hover and focus-visible. Hints in both catalogues; DE keeps the English tracker terms (Epic, Story)
where that is what the tracker shows: Feature → "Epic in a ticket tracker" / "Epic im Ticket-Tracker", Spec →
"Story", Claim → "Acceptance criterion" / "Akzeptanzkriterium", Task → "Sub-task". The visible vocabulary stays
Feature · Spec · Claim · Task · Milestone.

### Rows, order, widths

- Features in master order (F0, F1, …), never re-sorted by progress; Milestones by target date ascending, undated
  last (ISC-102). No sort control in this spec.
- One `ui-card` per row with `ui-meter` (closed tone, `aria-valuetext` "25 of 30 claims closed"), the fraction in
  mono tabular beside it, the Why line in muted ink, then the chip rows. A container query on the card (not the shell
  tier) moves the fraction under the meter below about 360 px of card width, so the 600 px cmux panel and the
  compact tier share one rule.
- 600 px is the compact tier (container < 640): the ISC-103.1 run exercises the Mobile layout. Every row grid uses
  `minmax(0,1fr)` and `min-inline-size: 0`, chips wrap, meters are fluid, names clamp or ellipsize, the breadcrumb
  truncates instead of wrapping; only icons have a fixed width.
- Dark: the page is the darkest surface and cards sit one step lighter (DS-APP-06); the meter track stays at its
  current 3.3:1 and must not drift (ISC-65).

### Keyboard, palette, icons, baselines

- **Keys, proposal for `/spec-review 003`, not required by any claim:** `g f` Features and `g m` Milestones at
  workspace scope. No `g w`: 001 binds it to Warnings on the dashboard, and `g s` already reaches the Specs panel
  there (001 design.md § Command palette and keyboard; clash reported by the 001 session 2026-09-29). They go into the one `SHORTCUTS` table
  (`core/keyboard-bindings.ts`, `g` + letter context-bound, 1500 ms window; 001 design.md § Command palette and
  keyboard) and the `?` sheet lists them per context; never a second keyboard service.
- **Palette (ISC-106):** two groups after Workspaces and Specs — Features (mono F-id, name, "25/30") and
  Milestones (`flag`, name, date), the latter absent under the same rule as the page; ISC-60's entries keep their
  order and completeness.
- **Icons (ISC-18.2):** `flag`, `circle-dashed` and `clock-alert` are added through `icon-names.ts`; `archive`,
  `layers`, `circle-check` and `triangle-alert` already exist. To be verified at implement, not assumed.
- **Baselines (ISC-108, ISC-108.1):** both pages at 390/820/1440 in both themes, on a fixture with `## Milestones`
  and an archived spec naming one and on a fixture with none (ISC-110), so both states of the menu are pinned; a
  frozen clock keeps "in n days" and "late" stable.
- **Read-only:** no route, link or popover on these pages writes anything (ISC-109).

### Observed in the Ist, for spec 002's owner (not in this spec's write scope)

- The spec picker shows the spec's task line ("Show every sync run and its failures …") while the head shows the
  title "Web console" and the breadcrumb the slug; design 002 wants one display name in picker, head, breadcrumb and
  palette. The new feature and milestone crumbs make the mismatch more visible.
- At compact the "/" between the picker segments sits about 8 px below the label baseline and crosses the pill's
  border, and "Tasks 27/32" in the tab strip is cut before the zen button.
