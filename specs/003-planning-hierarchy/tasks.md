---
spec: 003-planning-hierarchy
plan: plan.md
updated: 2026-09-30T07:06:01Z
---

# Tasks 003 — Planning hierarchy

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

**Order between specs** (plan.md § Risks, agreed with the 001 session 2026-09-29): T30 adds the two routes to
`app.routes.ts` only after 001's T63 (the dashboard page on `/w/:ws`) has landed; T44 and T45 wait for 001's command
palette (its group API is announced for ISC-106). Everything else touches files 001 leaves alone this round.

The two seams are T9 (the planning model's types and function stub in `core/`) and T20 (the workspace route in the
shared contract). Ordering inside a lane comes from the seams, the same-file rule and task numbering.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

### ① Format and fixtures

- [x] T1 · ISC-101 · [P] · core — `FORMAT.md`: the `milestone:` row in the `spec` frontmatter table and the `## Milestones` grammar (`- <name> · <YYYY-MM-DD> · <description?>`, slug = kebab-cased name, no `done` mark, completeness derived) in the `master` section with a fenced example · `FORMAT.md`
- [x] T2 · ISC-101 · core — `frontmatter.ts`: `milestone` typed key (`string`), field on `SpecFrontmatter`, `emptyData()` default (after: T1) · `core/src/frontmatter.ts`
- [x] T3 · ISC-101 · core — `milestones.ts`: parse the master's `## Milestones` section into `{name, slug, target, description, line}[]`; a line without the date part is a `master-milestone-line` warning and is skipped (after: T1) · `core/src/milestones.ts`
- [x] T4 · ISC-110 · core — harbor generator: emit the `## Milestones` block (Harbor 0.9 with a passed target and open claims, Harbor 1.0 ahead) and `milestone:` on 002, 004 and the archived 001; regenerate the tree; lantern untouched as the none case (after: T3) · `core/fixtures/harbor/generate.ts`
- [x] T5 · ISC-110 · core — corpus test `milestones`: one tree whose master carries `## Milestones` with an archived spec naming one, one tree without; fixtures README updated (after: T4) · `core/tests/fixtures.test.ts`
- [x] T6 · ISC-101 · core — `FORMAT.md`: the verbatim `From core/fixtures/harbor/ISA.md` block quoting the generated milestone lines, so `check:format-doc` holds the example to the fixture (after: T4) · `FORMAT.md`

### ② The tree in `core/`

- [x] T7 · ISC-100 · [seam] · core — `planning.ts`: the browser-safe types `PlanningModel`, `PlanningFeature`, `PlanningClaim`, `PlanningHolder`, `PlanningMilestone` (plan.md § Interfaces) and the `buildPlanning(input: DashboardInput)` stub, exported from `index.ts` · `core/src/planning.ts`
- [x] T8 · ISC-100 · core — `buildPlanning`: features in master order with their claims, each claim's holder from every folder (active and archived) or none, closed/total per feature, the master recount (after: T7) · `core/src/planning.ts`
- [x] T9 · ISC-100 · core — golden family `planning` in `FAMILIES`; goldens for all five trees (`UPDATE_GOLDEN=1`), trees without milestones carry `milestones: []` (after: T8) · `core/tests/golden.test.ts`
- [x] T10 · ISC-100 · core — `planning.test.ts` "tree": every fixture's tree equals its golden, claim by claim (after: T9) · `core/tests/planning.test.ts`
- [x] T11 · ISC-100.1 · core — a spec holding claims of several blocks appears under each; `main` from the first word of `isa_feature` (the `status.ts` split); test "main feature" on a fixture shaped like spec 002 (after: T8) · `core/src/planning.ts`
- [x] T12 · ISC-100.2 · core — test "recount": closed and total summed over features equal the master's own count (after: T8) · `core/tests/planning.test.ts`
- [x] T13 · ISC-100.3 · core — archived holders counted under their feature, listed with `archived: true`, no next step and no warning; test "archived" on harbor `archive/001-manifest-sync` against the archive listing's counts (after: T8, T4) · `core/tests/planning.test.ts`
- [x] T14 · ISC-101.1 · core — a `milestone:` naming no master entry yields one `spec-milestone-unknown` warning in `buildPlanning` and the spec still parses; test "unknown milestone" on an inline document (after: T3, T8) · `core/src/planning.ts`
- [x] T15 · ISC-101.2 · core — test "no milestone": diagnostics of every existing tree before and after the milestone parsers equal `EXPECTED_WARNINGS`, zero new (after: T2, T3, T8) · `core/tests/planning.test.ts`
- [x] T16 · ISC-102 · core — milestone grouping: specs per milestone (archived included), closed/total across features, order by target date ascending with undated last, derived state `upcoming` / `late` / `complete`; test "milestones"; planning goldens refreshed (after: T3, T4, T8) · `core/src/planning.ts`
- [x] T17 · ISC-101 · core — test "milestone format": the frontmatter key and the master block parse on harbor, the block's three fields per entry (after: T2, T3, T4) · `core/tests/planning.test.ts`

### ③ Contract, server, stub

- [x] T18 · ISC-103 · [seam] · server — contract: workspace route `planning` (`/api/workspaces/:ws/planning`, GET/HEAD), `WORKSPACE_ROUTE_TABLE`, `matchWorkspacePath`, `GOLDEN_FAMILY.planning`, typed 200 body `PlanningModel` (after: T7) · `server/src/spec-routes.contract.ts`
- [x] T19 · ISC-103 · server — the handler: loopback guard, `readWorkspaceInput`, `buildPlanning`, `json()` with ETag and 304, 404 unknown slug, 409 unreadable, 405 with `Allow` (after: T18, T8) · `server/src/api.ts`
- [x] T20 · ISC-103 · web — e2e stub: `planning` family reader, a branch before the spec catch-all, parity case in `stub-api.test.ts` against the real handler (after: T18, T9) · `web/e2e/stub-api.ts`
- [x] T21 · ISC-103 · web — `ApiClient.planning(ws)` typed method and URL helper (after: T18) · `web/src/app/core/api.service.ts`
- [x] T22 · ISC-103 · web — `ShellData.planning` resource keyed by the workspace, exposing `hasMilestones` (after: T21) · `web/src/app/layout/shell/shell-data.service.ts`
- [x] T23 · ISC-109 · server — `readonly.test.ts`: the planning route joins the read routes hashed before and after (after: T19, T36, T39) · `tests/readonly.test.ts`

### ④ Web

- [x] T24 · ISC-104 · web — `ShellState.route()` gains `wsPage: 'specs' | 'features' | 'milestones' | null` (after: T16) · `web/src/app/layout/shell/shell-state.service.ts`
- [x] T25 · ISC-104 · web — `areas.ts`: `WORKSPACE_PAGES` registry (specs, features, milestones: icon, summary key, go-key candidate) and `workspaceLink(ws, page)` (after: T16) · `web/src/app/layout/shell/areas.ts`
- [x] T26 · ISC-104 · web — area menu and trigger at workspace scope: the trigger names the current page, the menu lists `WORKSPACE_PAGES`, Milestones only while `hasMilestones`, spec scope unchanged (design § Where the pages sit; sheet at compact · Mobile) (after: T24, T25, T22) · `web/src/app/layout/area-menu/area-menu.ts`
- [x] T27 · ISC-104 · web — `shell-nav`: the workspace-scope branch of the area trigger replaces the disabled "Areas" button (after: T26) · `web/src/app/layout/shell/shell-nav.html`
- [x] T28 · ISC-103 · web — icons `flag`, `circle-dashed`, `clock-alert` added and regenerated (after: T8) · `web/src/app/shared/icons/icon-names.ts`
- [x] T29 · ISC-103 · web — `ui-meter`: `valueText` (`aria-valuetext`) and `size` inputs for the 8 px bar (after: T8) · `web/src/app/shared/ui/meter/meter.ts`
- [x] T30 · ISC-103 · web — routes `w/:ws/features` and `w/:ws/milestones` as lazy pages beside `w/:ws`; only after 001's T63 has landed (after: T24) · `web/src/app/app.routes.ts`
- [x] T31 · ISC-103 · web — `spec-chip`: the holding-spec chip as a router link with `main` (primary tint and 6 px dot), `other` (outline) and `archived` (glyph, word, dashed border, muted ink) variants (design § Archived specs, main feature) (after: T29) · `web/src/app/features/planning/spec-chip.ts`
- [x] T32 · ISC-103 · web — Features page: H1 with the level word as `ui-term`, meta line from the recount, one `ui-card` per feature in master order with anchor id and `tabindex="-1"`, F-id mono, meter with fraction, Why line, holder chips, unheld `<details>`; grid `minmax(0,1fr) 240px` at wide · Desktop, one column with the fraction under the meter · Mobile (after: T21, T22, T28, T30, T31) · `web/src/app/features/planning/features-page.ts`
- [x] T33 · ISC-103 · web — e2e `features.spec.ts`: one row per block, counts equal the golden, archived chip marked, unheld count, anchors (after: T32, T20) · `web/e2e/features.spec.ts`
- [x] T34 · ISC-107 · [P] · web — `ui-term`: `<dfn>` with dotted underline, native `popover="hint"` on hover, focus-visible and tap, `aria-describedby`; consumers: the page heads and the breadcrumb · `web/src/app/shared/ui/term/term.ts`
- [x] T35 · ISC-107 · [P] · web — catalogue keys `terms.*` (Feature → Epic, Spec → Story, Claim → Acceptance criterion, Task → Sub-task), `planning.*`, `shell.pages.*`, `palette.groups.features` / `milestones` in both languages · `web/src/i18n/en.json`, `web/src/i18n/de.json`
- [x] T36 · ISC-104 · web — Milestones page: rows by target date with `flag`, name, `Intl` date, state chip (`upcoming` muted, `late` warning with `clock-alert`, `complete` success), cross-feature meter, feature chips linking to `#F<n>`, spec chips with the archived treatment; renders `app-not-found` with a link to Features while the tree has no milestone (after: T26, T30, T31) · `web/src/app/features/planning/milestones-page.ts`
- [x] T37 · ISC-104 · web — e2e `milestones.spec.ts`: absent on lantern (no menu entry, not-found route), present on harbor with one row per milestone, the archived spec's milestone included (after: T36, T20) · `web/e2e/milestones.spec.ts`
- [x] T38 · ISC-103.1 · web — e2e `narrow-planning.spec.ts`: both pages at the 600 px panel, `scrollWidth` equals `clientWidth` (after: T32, T36) · `web/e2e/narrow-planning.spec.ts`
- [x] T39 · ISC-105 · web — spec head breadcrumb: levels milestone · feature (+n popover for the other held blocks) › spec › area › claim/task from the planning resource and the open tab, the claim's own block when one is open, rendered at compact in the short form, archived glyph in the spec crumb (design § The breadcrumb; · Mobile compact form) (after: T22, T8) · `web/src/app/layout/spec-head/spec-head.ts`
- [x] T40 · ISC-105 · web — `spec-head.css`: separators via `data-sep` (`/`, `·`, `›`), one line, truncation order feature name → milestone name → slug, ids never (after: T39) · `web/src/app/layout/spec-head/spec-head.css`
- [x] T41 · ISC-105 · web — e2e `breadcrumb.spec.ts`: every spec route incl. an archived spec at 390 and 1440, levels present, links resolve (after: T39, T40, T20) · `web/e2e/breadcrumb.spec.ts`
- [x] T42 · ISC-107 · web — e2e `features -g vocabulary`: the hint opens on hover, focus and tap in EN and DE, breadcrumb links carry the description; parity test green (after: T32, T34, T35, T39) · `web/e2e/features.spec.ts`
- [x] T43 · ISC-106 · web — palette groups Features and Milestones after Workspaces and Specs, Milestones absent under the page's rule; waits for 001's palette group API (after: T32, T36) · `web/src/app/features/palette/`
- [x] T44 · ISC-106 · web — e2e `palette -g levels` and `palette -g open` stay complete (after: T43) · `web/e2e/palette.spec.ts`
- [x] T45 · ISC-108 · web — `visual-planning.spec.ts`: Features and Milestones at 390/820/1440 on harbor and lantern with the pinned clock, light baselines produced in the container (after: T32, T36) · `web/e2e/visual-planning.spec.ts`
- [x] T46 · ISC-108.1 · web — the same baselines in the dark theme (after: T45) · `web/e2e/__screenshots__/chromium/dark/visual-planning.spec.ts/`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T7, T8, T9, T10 | ISC-100 | `bun test core/tests/planning.test.ts -t "tree"` |
| T11 | ISC-100.1 | `bun test core/tests/planning.test.ts -t "main feature"` |
| T12 | ISC-100.2 | `bun test core/tests/planning.test.ts -t "recount"` |
| T13 | ISC-100.3 | `bun test core/tests/planning.test.ts -t "archived"` |
| T1, T2, T3, T6, T17 | ISC-101 | `bun run check:format-doc` plus `bun test core/tests/planning.test.ts -t "milestone format"` |
| T14 | ISC-101.1 | `bun test core/tests/planning.test.ts -t "unknown milestone"` |
| T15 | ISC-101.2 | `bun test core/tests/planning.test.ts -t "no milestone"` |
| T16 | ISC-102 | `bun test core/tests/planning.test.ts -t "milestones"` |
| T18, T19, T20, T21, T22, T28, T29, T30, T31, T32, T33 | ISC-103 | `bun run e2e -- features` |
| T38 | ISC-103.1 | `bun run e2e -- narrow -g "features\|milestones"` |
| T24, T25, T26, T27, T36, T37 | ISC-104 | `bun run e2e -- milestones` |
| T39, T40, T41 | ISC-105 | `bun run e2e -- breadcrumb` |
| T43, T44 | ISC-106 | `bun run e2e -- palette -g levels` and `bun run e2e -- palette -g open` |
| T34, T35, T42 | ISC-107 | `bun run e2e -- features -g vocabulary` plus `bun test web/tests/i18n-parity.test.ts` |
| T45 | ISC-108 | `bun run test:visual -- features milestones` |
| T46 | ISC-108.1 | `bun run test:visual -- features milestones --theme dark` |
| T23 | ISC-109 | `bun run test:readonly` |
| T4, T5 | ISC-110 | `bun test core/tests/fixtures.test.ts -t "milestones"` |
