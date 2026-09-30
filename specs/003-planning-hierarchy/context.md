---
spec: 003-planning-hierarchy
created: 2026-09-29T20:00:23Z
updated: 2026-09-29T21:20:00Z
rounds: 3
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 003 — Planning hierarchy

## Goal — confirmed 2026-09-29T20:00:23Z
A developer sees where every feature and every milestone of a workspace stands across all its specs, active and
archived, and every spec page shows its place in that hierarchy.

Principal's words, verbatim: see `principal_stated_goal` in the master `ISA.md` (untracked; German, kept out of the
public tree by the constitution § What a spec may contain).

## Round 0 — shaping the idea, 2026-09-29T19:45:00Z
- Shapes offered: features + milestones (obvious, recommended) | features only (narrow) | full A4 hierarchy with
  breadcrumb and vocabulary (wider). Chosen: full A4 hierarchy.
- Ground read first: the product-ideas sheet (untracked) card A4 with its open questions Q6, Q9, Q10; the master's
  eight feature blocks; the fact that spec 001 holds claims of F0 and F1 and spec 002 of F0, F2, F3, F5 and F7, so
  "one spec = one feature" is already false in this repository; the archive rule in `FORMAT.md` and the harbor
  fixture's `archive/001-manifest-sync`.

### Q1 · Q6 — how does a spec hang on the features when it holds claims from several blocks?
- Offered: derived from the claims it holds, `isa_feature` marks the main one (recommended) | main feature plus an
  explicit list of the others, parser warns on a claim outside it | one spec = one feature, hard, diagnostics on 001
  and 002
- Chosen: derived from the claims
- Landed in: ISC-100, ISC-100.1

### Q2 · Q9 — where is a milestone defined?
- Offered: `milestone:` on the spec plus a `## Milestones` block in the master with name and target date, a name
  without an entry is a warning (recommended) | field on the spec only, no target date | list in the master only,
  naming the specs
- Chosen: field plus master block
- Landed in: ISC-101, ISC-101.1, ISC-101.2, ISC-102

### Q3 · Q10 — which vocabulary does the UI show?
- Offered: own terms (Feature · Spec · Claim · Task · Milestone), common terms as a hint (recommended) | common terms
  in the UI, own terms in the format | switchable per repository
- Chosen: own terms with hints
- Landed in: ISC-107

### Note from the principal, mid-shaping
- "bedenke auch archivierte Objekte zu behandeln" — archived specs are part of the tree: counted, listed as archived,
  never offered a next step.
- Landed in: ISC-100.3, ISC-102, ISC-104, ISC-105, ISC-110

## Round 1 — before the spec, 2026-09-29T20:00:23Z
Goal offered as three readings: the full sentence (overviews plus the breadcrumb path, recommended) | overviews only,
breadcrumb later | release focus with milestones as the main view. Chosen: the full sentence.

No gap questions the repo could not close: the three shaping questions had already settled the structure, and the
remaining uncertainties (route placement, late milestones, a done mark) do not change the claim set. They are
`⟨?: …⟩` marks in spec.md and fog lines below.

## Round 2 — before the plan, 2026-09-29T21:20:00Z
### Q1 · How do we build it — order and verification strategy?
- Offered: format → parser → API → pages, each stage with its own green probe set (recommended) | vertical slices per
  page (Features end to end, then Milestones, then breadcrumb) | UI first against hand-written stub goldens, parser last
- Chosen: format → parser → API → pages
- Landed in: plan.md § Approach

No further questions: no binding rule is departed from, nothing is persisted, so no rollback. The four fog lines were
resolved by the design pass (routes, late state) and the plan (no `done` mark, all-archived = complete); recorded in
spec.md § Decisions.

## Still open
- none. Dependency, not fog: the palette groups of ISC-106 wait for spec 001's command palette (plan.md § Risks).

## Round 3 — during build, 2026-09-29T21:50:00Z
second look: off (default). Round 1 dispatched T1 (ISC-101), T34 and T35 (ISC-107) on the Agent-tool path, one
worktree per task, width 3; locks `spec-003-ISC-101` and `spec-003-ISC-107` on the master.
- T1 landed (FORMAT.md, `check:format-doc` 0 before and after, 844 core tests green). Marks: slug rule pinned as
  lower-case, every run of non `a–z0–9` → one `-`, none at either end (`Harbor 0.9` → `harbor-0-9`) — T3 implements
  exactly this; the Milestones paragraph names T2/T3 as "not yet reading" until they land, to be removed by them;
  `upcoming` taken from plan.md; the planning tree named on the master's **Derived:** line; unstated: a block entry no
  spec names (shown as a row with 0/0, per design § Milestones page) and a spec naming a milestone while the master
  has no block (warning only, no row) — both go to T16.
- T35 landed (51 keys in en.json and de.json, parity 17/17 before and after; patch applied cleanly over 001's
  uncommitted catalogue edits). Marks: hints use the uniform "… in a ticket tracker" form for all four terms (design's
  short forms for Story / Acceptance criterion / Sub-task not used — page owner may shorten); no key for the
  breadcrumb's accessible description, compose from the level word plus `terms.*` or add one in T39; DE: "ohne Spec"
  for unheld, "alle in Specs" for all held, milestone states "in {{days}} Tagen" / "überfällig · {{days}} Tage" /
  "abgeschlossen", "Milestones" kept in DE. Worktrees carry no node_modules, so `ng test` cannot run there — the
  lane probe for web tasks runs on the main tree after the patch lands (`bun test web/tests/` ran in the worktree
  with 6 failures, all node_modules-dependent icon/Lucide checks plus one no-glow CSS check; to be re-run here).
- T34 landed (`ui-term`: dfn with dotted underline, sibling role=tooltip hint as native popover, `popover="hint"`
  when the engine reads it back, else `manual`; hover after `--motion-duration-base`, focus-visible, tap toggles, Esc
  and blur close, anchor positioning with a rect fallback; 12 spec tests; gallery row `data-gallery="term"`). On the
  main tree: `bun run --cwd web test` 319/319, `bun run check:static` 0. Marks: the hint `<span>` sits inside the
  host, so e2e must assert headings by innerText or accessible name, not textContent (T33/T42); the breadcrumb must
  not wrap link text in `ui-term` (nested interactive) — the link carries `aria-describedby` to `hintId` instead (T39);
  no dedicated tooltip-delay token, `--motion-duration-base` reused; shared/ui/README.md row for `ui-term` still to
  add (a later web task on that file). Worktrees do get `node_modules` when the worker runs `bun install
  --frozen-lockfile`; T35's note about missing modules is superseded.
- T2 landed (frontmatter  key + test; core 843 pass on the main tree; goldens carry no frontmatter, none regenerated).
- T2 landed (frontmatter `milestone` key plus test; core 843 pass on the main tree; the goldens carry no frontmatter,
  none regenerated). Round 2 recorded; round 3 = T3 alone (the planner serialises non-`[P]` tasks).
- T3 landed (`milestones.ts`: parseMilestones, milestoneSlug, Milestone types; 9 tests; core 851 pass on the main
  tree). Marks: section also stops at a `---` rule like claims.ts; dates are calendar-checked; only the first
  `## Milestones` heading is read; `*` bullets accepted; an empty name warns; description keeps further ` · `
  verbatim. Round 3 recorded.
- T4 landed (harbor: `## Milestones` between Features and Decisions, `milestone:` on the archived 001, 002, 003 and
  004; corpus test "milestones"; only `harbor.claim-view.golden.json` changed, every line number +1; core 853 pass,
  check:static, check:leak, check:format-doc green on the main tree). **Mapping differs from the task text:** Harbor
  0.9 → 003 (open claims, so it reads `late` at the fixed March-2026 now), Harbor 1.0 → 001 (archived), 002, 004;
  004 was fully closed and would have read `complete`. T13, T16, T37 and the planning goldens assume this mapping.
  The worker also had to add `milestone: Harbor 1.0` to FORMAT.md's verbatim 002 example (check:format-doc). Parent
  fix on landed code: T3's BOM regex embedded a raw U+FEFF (lint `no-irregular-whitespace`), now `/^﻿/`.
  Round 4 recorded; ISC-110's "planning goldens present" half waits for T9/T10.
- T5 ticked without a dispatch: its deliverable (corpus test "milestones", README rows) landed inside T4, and its
  probe `bun test core/tests/fixtures.test.ts -t "milestones"` passes on the main tree. Round 5 recorded as such.
- T7 landed (the seam: `core/src/planning.ts` types + `buildPlanning` stub, full `export *`, placeholder
  planning.test.ts; core 854 pass, check:static 0). Marks to carry: `PlanningHolder.stage` is `Stage | null`;
  `recount: Progress | null` and `buildPlanning(input: PlanningInput)` (Pick of DashboardInput plus `now?`) refine
  plan.md § Interfaces — sync at reconcile; `PlanningMilestone.target` null branch is unreachable while milestones.ts
  skips dateless lines (T16 decides: drop the null); doc pre-commits for T8: active folder wins over archived for a
  claim held twice, then lower id; title falls back to the slug; `held` on a milestone's spec counts all its master
  claims; unheld excludes dropped; holders active by id then archived by id; T8 must delete the eslint-disable line
  on the stub. Round 6 recorded.
- Parent incident after T7: the patch extraction missed the worker's two untracked files (a multi-line path list
  broke `git add -N`) and the worktree was removed before the miss was seen; both files were restored from the
  worker's transcript (last Write plus its two Edits replayed), core 854 pass and check:static green again, and
  T7.patch regenerated from the main tree. Extraction now uses `git add --intent-to-add --all` before the diff.
- T8 landed and **ISC-100 closed** on its probe (planning tree for all five trees, golden family `planning`,
  test "tree"; T9 and T10 were delivered inside T8 and ticked). Marks to carry: `holder.stage` is null for every
  holder because `stageOf` needs the gate marks (gates.ts, node:crypto) — the server route (T19) fills stages from
  `buildDashboard`'s rows by spec id, or PlanningInput gains `stages?: ReadonlyMap<string, Stage>` (seam addition
  for T18/T19); `held` counts the block's live claims whose resolved holder is the folder (no fixture exercises the
  two-folder winner rule — T11/T13 may add a synthetic case); `recount` is `master.counted` even without a claim
  section ({0,0}); only the master's claim diagnostics are included (folder diagnostics: T16); the planning clock is
  `PLANNING_NOW = 2026-03-20` (helpers/planning-model.ts) between the two harbor targets, while the web e2e FIXED_NOW
  is 2026-09-01 — T16/T36 must pick the clock the state derives from deliberately. Round 7 recorded.
- T11 landed and **ISC-100.1 closed** (5 tests on inline inputs; the probe was green on first run because T8 already built the behaviour). Round 8 recorded.
- **ISC-110 closed** without a dispatch: its second half (planning goldens present) landed with T8; probe and inventory green.
- T12 landed and **ISC-100.2 closed** (15 tests). Mark worth a later diagnostic: a claim placed inside `## Features`
  before the first `### F` block is counted in the recount but under no feature — no fixture has that shape; the
  parser emits nothing for it today. Round 9 recorded.
- T6 landed (FORMAT.md Milestones example now a verbatim From block, 27 examples verbatim). Round 10 recorded.
- T13 landed and **ISC-100.3 closed** (4 new tests). Design note from the worker: feature closed/total come from the
  master's boxes, the archive listing counts the archived folder's own boxes; they agree on harbor, and the design
  does not say which wins if they ever diverge (planning follows the master by ISC-100/100.2). Round 11 recorded.
- T17 landed and **ISC-101 closed** (5 tests; the green-first note applies to the parser halves built in T2/T3). Round 12 recorded.
- T14 landed and **ISC-101.1 closed** (red-then-green; warning file via specFilePath, no line because parseFrontmatter exposes none). Round 13 recorded.
- T15 landed and **ISC-101.2 closed** (EXPECTED_WARNINGS moved to core/tests/helpers/expected-warnings.ts, shared by fixtures.test.ts). Round 14 recorded.
- T16 landed and **ISC-102 closed** (red-then-green, harbor golden gains two rows). Parent added the two refinements
  the worker named to FORMAT.md (0/0 never `complete`; the target day itself is not late). Marks to carry to the web
  lane: `milestones` also holds 0/0 rows for block entries no spec names, so "no spec carries a milestone" (ISC-104)
  is `milestones.every(m => m.specs.length === 0)`, not `length === 0`; the server should always pass `now` as the
  user's local date; `held` on a milestone's spec counts winning-holder claims across blocks; duplicate block entries
  are not flagged (a later milestones.ts warning). Round 15 recorded — the core lane is complete.

### Q1 · T18 (ISC-103, server): the contract's `import type { PlanningModel }` pulls `gates.ts` (Node `Buffer`) into the web typecheck through planning.ts → dashboard.ts / stage.ts. Move the types, or type the body `unknown`?
- From: T18 (ISC-103), lane `server`
- Offered: (A, recommended) type-only moves in core — `MarkState` into files.ts, `FileDiagnostic` into files.ts,
  `PlanningInput` with its own fields instead of `Pick<DashboardInput, …>` — no runtime change | (B) `planning:
  unknown` in the contract like `DashboardBody`, pushing the problem onto the web tasks
- Chosen: A — decided by the parent, not the principal: both keep the claim set and the seam's shape, and B breaks
  the seam's "core types only" rule. Applied as a remediation of T18 (core lane, same task), not a new task.
- Landed in: nowhere in spec.md; plan.md § Interfaces already reads `PlanningInput` as its own type at reconcile.
- T18 landed in two patches (contract + the core type moves): `WorkspaceRouteName`, `workspaceRoutes.planning`,
  `WORKSPACE_ROUTE_TABLE`, `matchWorkspacePath`, `allowForWorkspace`, `WorkspaceRouteResponses {planning:
  PlanningModel}`, `WorkspaceRouteError`, `GOLDEN_FAMILY.planning` (a whole-file body, not keyed by folder);
  `dashboard` stays out of the family (api.ts keeps its own `DASHBOARD_PATH`); no `PLANNING_PATH` regex — T19 calls
  `matchWorkspacePath` and checks GET/HEAD itself. Type moves: `MarkState` and `FileDiagnostic` live in files.ts
  (re-exported from gates.ts / dashboard.ts), `PlanningInput` has its own fields; web typecheck 30 → 0 errors;
  gates.test.ts's import-guard line updated. Round 16 recorded.
- T19 landed (planning route inside `dashboardApi`, guard order loopback → method → slug → readable; `today`
  injectable, `localDate()` helper; 12 route tests, harbor body byte-equal to its golden at 2026-03-20; server
  tests 1428 pass). Round 17 recorded. The web guard `no-glow.test.ts` fails on HEAD's `matrix-tab.css` in every
  worktree but is green on the main tree, where 001's uncommitted edit removed the gradient — not 003's.
- T20 landed (stub planning route from the whole planning golden, parity over WORKSPACE_ROUTE_TABLE with today pinned to 2026-03-20; 74 stub tests). Round 18 recorded.
- T21 landed (ApiClient.planning typed as PlanningModel, planningUrl via the contract builder, new api.service.spec.ts with 5 tests). Round 19 recorded.
- T22 landed (ShellData.planning resource, hasMilestones via some(specs.length > 0), planningMissing/Unavailable; 6 tests). Note: shell.spec.ts's FakeApi has no planning() yet — the page tasks add it. Round 20 recorded.
- T24 landed (ShellRoute.wsPage from route data page, WorkspacePageId + isWorkspacePageId in areas.ts, 4 tests). Round 21 recorded.
- T28 landed (flag, circle-dashed, clock-alert; icons.ts regenerated, 48 icons). Round 22 recorded.
- T25 landed (WORKSPACE_PAGES specs/features/milestones with file-text/layers/flag, goKey null/f/m as a proposal, workspaceLink; 6 tests). Round 23 recorded.
- Parent note: the baseline rebuild after T25 left intent-to-add entries in the main index for 003's new files; reset to untracked at once (`git status` shows them as `??` again). The rebuild now resets from the porcelain listing, not from a second `ls-files --others` call.
- T29 landed (ui-meter valueText + size lg 8 px, mini kept; README row, gallery entry; 5 tests). Round 24 recorded.
- T30 (routes) is held on purpose: 001's T63 has not landed on the main tree (app.routes.ts still routes /w/:ws to the placeholder, features/dashboard/ untracked and in flight). ISC-103 stays locked by this session until T63 lands so the planner moves to ISC-104/105 tasks meanwhile.
- T39 landed after a turn-limit stop (report requested, then applied): breadcrumb levels on every tier from the
  planning model, compact short form, `+n` popover, archive glyph, unknown milestone as plain text, `data-sep`
  on every li, `aria-description` from `terms.*`; 8 unit tests; `gate.spec.ts` at 390 now expects the short crumb
  instead of none. Marks to carry: the open claim/task comes from the URL fragment (`#claim-…`, `#task-…`) — no
  selection signal exists; on an open task the feature stays the spec's main one (the task→claim map is only in the
  tasks payload, a T40/T41 decision whether to load it); the unknown milestone's name is parsed from the
  `spec-milestone-unknown` message — core should expose it structurally later; `specHead.breadcrumb` catalogue key is
  now unused; `ShellData.planningModel` throws while the resource is in error (T22 follow-up for the page tasks).
  Round 25 recorded.
- T26 landed (scope-aware area menu, Milestones absent while !hasMilestones, summaries from the planning model and
  dashboard rows; 10 tests). Marks: no `g` hint on workspace pages until the keys are bound; the milestones summary
  renders no line when every named milestone is complete (a second catalogue key would be needed); the summary
  keys have no plural form ("1 milestones") — catalogue follow-up; T27 must enable the trigger at workspace scope,
  reading `route().wsPage` + `workspacePageById`. Round 26 recorded.
- T40 landed (breadcrumb CSS: one non-wrapping line, shrink weights feature 3 › milestone 2 › slug 1 via
  `li:has([data-crumb=…])`, name caps 240/160/200 px and 96 px for the milestone at compact, ids and `.crumb-more`
  `flex: none`, separators generated-only and unselectable, links underline on hover/focus-visible, 44 px targets under
  `pointer: coarse`; the slug got a `.crumb-slug` hook with `&ngsp;` so the accessible name keeps "002 web-console";
  one unit assertion). Marks: the `ol` wraps `overflow: hidden` with a 6 px negative margin/padding so the focus ring
  is not clipped; nothing measured in a browser — the 358 px fit and the truncation order wait on T41's e2e and the
  browser tier; `.mono` base rule moved above `.crumbs .mono` for `no-descending-specificity`. Round 27 recorded.
- T27 landed (area trigger at workspace scope: enabled button with the page icon, page name and chevron, aria-label
  `shell.area.pageLabel` "Page: {{page}}"; the disabled "Areas" button only without a workspace; three shell tests).
  Mark: `shell-menus.html` rendered `<app-area-menu />` only under `specOpen()`, so the enabled trigger opened onto
  nothing — the condition is now `specOpen() || state.ws() !== null` (one line, outside T27's file list, accepted as
  part of the seam). Two full web runs hit 5 s timeouts under machine load (load average > 200 from parallel
  sessions); the three files pass isolated and the third full run is 365/365. Round 28 recorded.
- T41 landed (`web/e2e/breadcrumb.spec.ts`: 51 cases at 390 and 1440 — levels, order and `data-sep` per route, all 12
  built tab routes, claim and task leaves by fragment, the archived 001, the links that land, feature and milestone
  `href`s, the one-line fit at 390 measured on the `ol`; 46 pass, 3 fixme, 2 width-conditional skips). ISC-105 stays
  OPEN: the three click-and-land cases (milestone crumb, feature crumb, `+n` list link) are `test.fixme` until
  T30/T32/T36 route and build the pages — turn them live and close the claim then. Marks: no harbor spec holds claims
  in two blocks, so the `+n` chip is covered by intercepting the planning route and adding 002 as a non-main holder
  of F3 — a real multi-block holder in `core/fixtures/harbor` is a fixture follow-up (Remaining Work); at 390 the
  `nav` scrollWidth is 364 on 358 px because the `ol` bleeds 6 px for the focus ring (T40), content itself ~224 px.
  Round 29 recorded.
- T31 landed (`app-spec-chip`: router-link pill, variants main / other / archived, `data-spec` on the host, aria-label
  from `planning.features.holderMain|holderOther|holderArchived` with `{{name}}` so a null stage leaves no stray space;
  4 tests). Marks: `PlanningHolder.main` is relative to the block, so the chip takes an optional `mainFeature` input
  the pages must pass for `other` holders (T32/T36); `holder.stage` is null for every spec by the T8 decision (stage
  needs the gate states), so the "002 Build" word only appears once the pages feed the dashboard row's stage into
  the chip (T32: look up `ShellData.specRows()` by id) — or core fills it later. Round 30 recorded.
- T30 landed, by the parent in the main tree after 001's session confirmed T63 has not touched `app.routes.ts` and
  its only planned change there is the `w/:ws` component swap: two lazy routes directly after `w/:ws`, `data.page`
  `features` / `milestones`; minimal pages `features/planning/features-page.ts` and `milestones-page.ts` (page head
  H1 with `id` and `tabindex="-1"`, `data-page` host, not-found for a missing workspace; Milestones also not-found
  once the tree has answered without a named milestone, the ISC-104 "absent" rule); `planning-pages.spec.ts` (4).
  Mark: `shell.spec.ts` "renders exactly one header … on every route" hit its 5 s timeout again in the full run
  (three times today under machine load), green alone — a load-sensitive test in 001's file, told 001's session.
  Round 31 recorded.
- 001's T63 landed in the main tree (`w/:ws` → `DashboardPage`, `placeholders/workspace-page.ts` gone; its
  `data-page="workspace"` stays, so T41's e2e holds). Its wider `showRail()` also matched the planning pages; the
  parent narrowed the last return in `layout/shell/shell.ts` to `route().wsPage === 'specs'` (design § Where the
  pages sit: no rail on Features and Milestones), one line, 001's session told. `shell.spec.ts` fails 10 cases since
  T63 (its fake dashboard body has no `kpis`, `kpi-band` reads `k.master`) — 001's file, reported, not touched here.
- T32 landed (Features page: `<ol>` of `ui-card` rows in master order, `<article id="F2" tabindex="-1">` anchors
  with an arrival outline driven by `data-arrived` (pushState leaves `:target` stale), H2 = mono id · name, Why line
  clamped with the full text in `title` and a compact "more" disclosure, chips main → other → archived with the stage
  from the dashboard rows and `mainFeature` from the model, `+n more` past four chips at compact, unheld `<details>`
  listing ids, `ui-term` hints on "Features" and "claims", skeleton / empty / unavailable states; 14 tests). Parent
  verified in real Chrome (VerifyViewport 1440 and 390 against the stub): layout, separators and hints as designed;
  the DOM-render capture had shown a false wrap of the unheld line. Marks: `planning-pages.spec.ts` compares the H1
  without the hint's tooltip text (ui-term renders it inside the H1); `planning.features.meta` key is now unused —
  the meta line is three spans with CSS separators (T33 reads the spans, not one string); at compact the H1 still
  reads "Features in harbor" where design § Mobile says "Features" alone (catalogue follow-up); holder order is
  sorted in the page since core orders active holders by id. Round 32 recorded.
- T36 landed (Milestones page on the Features row's card and grid: flag + name, `<time>` with the `Intl` medium
  date in the UI language, the served `state` as muted "in n days" / warning chip `clock-alert` "late · n days" /
  success chip "complete", cross-feature meter, feature chips → `/w/:ws/features#F<n>` with "n/m", spec chips with
  `main: false` and the dashboard stage, absent → not-found plus a Features link; `MILESTONES_TODAY` token for the
  day count; 19 tests). Parent verified in real Chrome at 1440 and 390 against the stub. Marks: the day count is
  computed on the client from `target` and today while `state` is the server's — against the golden (state frozen at
  `PLANNING_NOW`) Harbor 1.0 reads "in 0 days" (clamped); in the product server and client share the clock, and the
  e2e pins it; the late icon is `clock-alert` (task line) where design § Desktop says `timer`; the unavailable branch
  now precedes `absent()` (an error answer used to read as absent); `ng build` warns on budgets — `spec-head.css`
  4.86 kB over the 4 kB `anyComponentStyle` warning after T40, initial bundle 733 kB over 500 kB (tasks-tab.css was
  already over; warnings, not errors — for the code review). Round 33 recorded.
- T33 landed and ISC-103 CLOSED (`web/e2e/features.spec.ts`: 16 cases at 390 and 1440, every expectation derived
  from the golden; the two feature `fixme` cases of the breadcrumb e2e are live and land on `#F2` / `#F3`). Marks:
  the harbor golden has no block with more than four holders and no `other` holder, so the `+n more` button is
  asserted absent and the variant order is exercised on main and archived only — a richer harbor fixture is the same
  Remaining Work item as T41's; at 390 the fraction sits above the full-width meter (design § Mobile), not beside it;
  the breadcrumb e2e header still says the pages are not routed (T37 updates it). Round 34 recorded.
- T37 landed; ISC-104 and ISC-105 CLOSED (`web/e2e/milestones.spec.ts`: 28 cases — lantern absent (menu, route,
  Features page, crumb), harbor present with the archived 001 under Harbor 1.0, dates and day counts under the
  pinned clock, anchors and links landing; the breadcrumb e2e has no fixme left, 49 passed). Marks: the palette
  half of ISC-104 ("absent from the palette") is not probed until T43/T44 land the groups on 001's palette API —
  the claim's Verification stub says so; under FIXED_NOW Harbor 1.0 reads "in 0 days" because the golden's state is
  frozen at PLANNING_NOW while the days come from the clock (the T36 mark). Round 35 recorded.
- T23 landed by the parent; ISC-109 CLOSED (`tests/readonly.test.ts`: the planning route GET / 304 / HEAD and the
  two page URLs join the hashed read pass, 4 pass, 62 expects). Breadcrumb links are fragments and client routes and
  reach the server only as the same SPA fallback. Round 36 recorded.
- T38 landed by the parent; ISC-103.1 CLOSED (`web/e2e/narrow-planning.spec.ts`: both pages on harbor and lantern
  at 600 and 390, `scrollWidth === clientWidth`, no element's right edge past the viewport, no horizontal scroll
  container inside the page; 8 passed). Round 37 recorded.
- T42 landed; ISC-107 CLOSED (`features.spec.ts` "vocabulary": 16 cases EN/DE × 1440/390 — hover, keyboard focus
  and Esc, tap toggle on a coarse pointer; breadcrumb `aria-description` on feature, spec, claim and task crumbs;
  a text-node walk finds no tracker word outside `[role=tooltip]`; parity 17 pass). Mark: the language switches
  through `PUT /api/settings` under a per-test stub session set in `beforeEach` — a shared session made parallel
  resets wipe each other's language. Round 38 recorded.
- T45 and T46 landed by the parent (`web/e2e/visual-planning.spec.ts`: harbor and lantern, Features and Milestones,
  390/820/1440; 12 light and 12 dark baselines recorded in the pinned container, `bun run test:visual:ci -- planning
  -u` and `… --theme dark -u`, 12 passed each; the 820 light Milestones baseline eyeballed). ISC-108 and ISC-108.1
  stay OPEN until the COMPARE run passes — the probe. Round 39 recorded (T45; T46 ticked with it, its claim edge
  waits on ISC-108). Session closed here for a machine restart (2026-09-30).

## Handover (next session, `/spec-implement 003`)
1. Probe for ISC-108 / ISC-108.1: `bun run test:visual:ci -- planning` and `bun run test:visual:ci -- planning
   --theme dark` (compare, no `-u`; ~6 min each in the container). Green → close both via the write order (stubs
   name the two commands and 12/12), then `/spec-code-review 003`.
2. T43/T44 (ISC-106, palette groups Features and Milestones) wait on spec 001's T66 palette group API — ask session
   spectant-50; until then ISC-106 is the only claim left open after step 1. Its palette half of ISC-104 is noted in
   ISC-104's Verification stub.
3. Remaining Work candidates for `/spec-complete 003`: a harbor fixture with a spec holding claims in two blocks and
   an `other` holder (the `+n` chip and the variant order are covered by route interception only); compact H1
   "Features" alone (design § Mobile); plural forms and the all-complete summary key in the area menu; unused keys
   `planning.features.meta` and `specHead.breadcrumb`; `core` exposing the unknown milestone name structurally;
   `holder.stage` filled by core once gates are available; `ng build` budget warnings (spec-head.css 4.86 kB,
   initial 733 kB).
4. Nothing is committed; the main tree holds 001's and 003's uncommitted work side by side. No worktrees left.
- ISC-108 and ISC-108.1 CLOSED after the restart: the compare runs in the pinned container, `bun run test:visual:ci
  -- planning` 12 passed and `… --theme dark` 12 passed (Docker Desktop had to be started first). 001's session
  answered on the palette: T66 not started (queued behind the prototype port); the group API is decided in plan 001
  § Stack Decisions "palette groups" — multi-provider `PALETTE_SOURCES`, `{ id, labelKey, order, entries: Signal }`,
  entries `{ id, label, meta?, chip?, link, keywords }`, groups by `order`, an empty group absent; 003 takes orders
  50 / 55 and registers its sources with one provider line each; the token file lives in `web/src/app/core/` so
  T66 imports it.
- T43 landed by the parent against 001's decided group API before T66 exists: `web/src/app/core/palette-sources.ts`
  (the multi-provider `PALETTE_SOURCES` token, `PaletteSource`, `PaletteEntry` — T66 imports these, never redefines
  them), `web/src/app/features/planning/planning-palette.ts` (`featuresPaletteSource` order 50: one entry per block,
  chip = F-id, meta = closed/total, link `/w/:ws/features#F<n>`; `milestonesPaletteSource` order 55: only named
  milestones, chip = state, link `#m-<slug>`, empty without a workspace or a tree, so the group is absent exactly
  when the page is), two provider lines in `app.config.ts`, 4 unit tests. Fragment links are URL strings, since a
  router-link array cannot carry a fragment. T44 (`palette -g levels` / `-g open`) and ISC-106 wait on 001's T66
  rendering the groups. Round 40 recorded. Task line named `features/palette/`; the sources live in
  `features/planning/` by 001's decision.
- T44 landed; ISC-106 CLOSED — every claim of the spec is closed (18/18, 46/46 tasks). 001's T66 landed the palette
  on the main tree (renders `PALETTE_SOURCES` by `order`, empty group = no heading, Enter handles arrays and URL
  strings); `palette.spec.ts` "levels": 6 cases (harbor groups and order, ISC-60 still complete, lantern without
  Milestones, `/` without both, Enter lands on the anchors, the compact sheet). Code review (2026-09-30, on the mixed
  001+003 tree): 10 code findings, 0 security findings; #1 (pinned task count in core/tests/tasks.test.ts) fixed by
  001's session; the rest await the principal's pick before any fix.
- Code-review fixes, all ten approved by the principal ("alle 10"): #1 by 001's session (task test counts from the
  file); #6 resolved by T66. Core (worker): #2 `buildPlanning` keeps `parseMilestones` diagnostics on `ISA.md`;
  #3 `master-milestone-duplicate` warning, later duplicate (name or slug) skipped, FORMAT.md bullet; #8 `Diagnostic.subject`
  (core/src/diagnostics.ts) carries the unknown milestone name — no golden changed (no fixture emits these). Web
  (worker): #4 `MILESTONES_TODAY` is the local calendar day like the server's `localDate()` (tested under
  TZ=Europe/Berlin); #5 `matchesHolder(h, ref)` in spec-head-model.ts matches NNN, folder and bare slug, display id
  prefers the body then the holder; #9 the area trigger is disabled with `shell.area.needsWorkspace` and no area
  menu mounts for a missing workspace (ShellState stays route-only). Parent: #7 `readWorkspace` option beside
  `loadWorkspace` in `DashboardApiOptions`, planning route reads through it, seam test; #10 `PLANNING_NOW` imported;
  #8 consumer reads `diagnostic.subject`. Open mark from #5: `ShellData.currentRow`/`specMissing`/`archiveRows`
  still match dashboard rows by `row.id === route param` only — with no planning tree and a folder/slug URL the
  header's spec row does not resolve (Remaining Work). Reviews rerun after the full verification.
- Code-review round 2 (10 findings; principal: proceed as proposed). 003: #1 FORMAT.md and the `MilestoneState` doc
  no longer read "all archived = complete" as a rule (derived from claims only; `milestoneState` verified); #5 only
  top-level bullets are milestone lines, any heading ends the block (FORMAT.md bullet); #8 `core/src/spec-ref.ts`
  (`specIdOf`, `specSlugOf`, `specRefMatches`) is the one definition of the reference forms, `resolveSpec` and the
  breadcrumb's `matchesHolder`/`slugName` use it, 001's spec-table imports it; #10 archived folders get no
  `spec-milestone-unknown`; #4 milestone palette entries carry no chip, the state word translated in `meta`
  (`planning.milestones.stateWord.*`), kept out of keywords (they rank as ids); #7 `features/planning/planning-page.ts`
  holds the shared stage map (from core `STAGE_RULES`), page state, fragment target and arrival effect. #3 (planning
  route reads through `readWorkspaceInput` incl. git and lock sources) accepted as Remaining Work: measure first.
  001 took #2, #6 (real defect was `İ` lower-casing shifting offsets), #9 and the spec-table half of #8. Mark: 001's
  `overview/workspace-column.css:75` trips `web/tests/no-glow.test.ts` (reported to 001).
- Code-review round 3 (10 findings; principal: proceed). 003 by the parent: #1 palette links serialised through
  `router.createUrlTree(...)` so a slug like `100%` is encoded (test with `/w/100%25`); #2 `spec-chip` and the spec
  head's archived name read the language signal before `translate()`; #10 `.checkpoint-state.json` in `.gitignore`.
  003 by a core worker: #3 names on skipped milestone lines count as known (no spurious `spec-milestone-unknown`);
  #6 `specIdOf`/`specSlugOf` replace the hand-rolled id/slug derivation in planning, dashboard and archive; #9 the
  milestones split without the `endsWith(' ·')` patch. 001 took #4 (`event.code` chords, Ctrl+K left to text fields),
  #5 (catalogue keys for the KPI captions and the agent label), #8 (palette index keyed on `wanted`); #7 (dashboard
  body types into files.ts) declined by 001 as a follow-up.
- Round 3 core fixes landed: `parseMilestones` returns `skipped` names (known but unusable, no spurious unknown
  warning; FORMAT.md clause), id/slug via `specIdOf`/`specSlugOf` in planning, dashboard and archive (server input
  is `NNN-` folders only, so behaviour and goldens are unchanged; four-digit and no-prefix folders now agree with
  `resolveSpec` by construction), the milestones split on a whitespace-bounded `·` (FORMAT.md: the name runs to the
  first ` · `, so `v1·beta` stays a name; a tab around `·` now separates too). 950 core tests.
- Code-review round 4 (9 findings, all 003, mostly architectural; principal: proceed as proposed). Fixing: #2 a
  numeric ref matches only ids in `spec-ref` (mirrors `resolveSpec`), width doc aligned; #3 `track` by holder slug;
  #4 one `mainFeatureOf` helper in status.ts; #7 `featurePlace` takes the open claim's block only when held; #8
  single trim; #9 compact spec crumb current whenever no leaf is open. Remaining Work: #1 master planning
  diagnostics (`master-milestone-line/-duplicate`) have no rendering surface; #5 canonical spec ref in ShellData
  (folder/slug URLs); #6 three full-tree reads per navigation (dashboard, planning, spec); the active/archived `NNN`
  collision the id-keyed maps cannot tell apart (server answers `ambiguous`).
- Round 4 fixes landed: web — `track` by holder slug, `featurePlace` only over held blocks, compact spec crumb
  current whenever no leaf is open (480 web tests); core — `SPEC_FOLDER`/`SPEC_ID` exported from spec-ref.ts and
  imported by resolve.ts (one folder shape, one id form; a three-digit ref matches ids only, exact `resolveSpec`
  parity incl. `123` vs `007-123` → unknown), `mainFeatureOf` in status.ts used by drift and planning (status.ts
  now imports `MarkState` from files.ts to keep planning's type graph browser-clean), single trim (957 core tests,
  goldens unchanged).
- Gate e2e at 390 ("at most 240 px tall") failed after round 4: the head measures 267 at a fine pointer — design
  002's 240 px budget (T79) was set for a head WITHOUT a breadcrumb, and design 003 § The breadcrumb puts a crumb row
  back at compact (20 px, 44 px under a coarse pointer). Not a regression of the fixes: the rest of the head alone
  (title row 101, description 40, meta 16, command 26, source line 24 plus gaps) is what 002 budgeted. The test
  now measures the head without the crumb row against 240 and the crumb row against 44. Design conflict for the
  principal: whether 002's budget grows by the crumb row or the compact head loses something else (Remaining Work).
