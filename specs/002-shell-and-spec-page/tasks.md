---
spec: 002-shell-and-spec-page
plan: plan.md
updated: 2026-09-30T06:43:37Z
---

# Tasks 002 — Shell and spec page

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

**Prerequisite from spec 001** (Decisions 2026-09-29): 002 extends the parser, the API and the web infrastructure
that 001 builds. Stage ① needs 001's T33 (core module skeleton) and T39 (dashboard model) landed; stage ② needs 001's
T24–T28 (primitives, Playwright config), T57 (stub API) and T58 (theme service); stage ③ needs 001's T42, T43 and T47
(registry, settings, workspace routes). 001 continues those tasks; only 001's T32, T59 and T60 are struck (T31 here).
The edges below stay inside this spec; the parent schedules 001's rounds before the stages that need them.

The five seams are the contracts every later task builds against: T1 (core file kinds and model types), T35 (the
shell), T44 (the spec routes), T52 (the stub API for e2e), T67 (the writes) and T94 (notes). Ordering inside a lane
comes from the seams, from the same-file rule and from task numbering.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

### ① Contract

- [x] T1 · ISC-68 · [seam] · core — `files.ts`: the enumerated file kinds with their paths inside a spec folder, plus the exported model types and function stubs for spec, timeline, frames, live, evidence and locks, so the fill-ins build in parallel · `core/src/files.ts`
- [x] T2 · ISC-68.1 · core — `FORMAT.md`: one section per file kind with a real example from the fixtures, the stage table, the drift classes, the rounds line, the gate marks, the events line (after: T1) · `FORMAT.md`
- [x] T3 · ISC-68.1 · server — `check:format-doc`: section names of `FORMAT.md` against the kinds in `core/src/files.ts`, wired into `check:static` (after: T2) · `scripts/check-format-doc.ts`
- [x] T4 · ISC-69 · [P] · core — freeze this repository's spec 001 (spec, plan, tasks, context, design, rounds.jsonl, the F0/F1 master blocks, constitution) at a named commit with a `COMMIT` file · `core/fixtures/spectant-001/`
- [x] T5 · ISC-69 · [P] · core — freeze three leadgen specs of two types with their constitution, a reduced master holding only their feature blocks, and `LICENSE-leadgen.txt` · `core/fixtures/leadgen/`
- [x] T6 · ISC-69 · [P] · core — corpus test: the frozen trees, types, licence note and the synthetic trees are present · `core/tests/fixtures-corpus.test.ts`
- [x] T7 · ISC-69 · [P] · core — fixture rule narrowed to "never a copy of a private repository", refresh rule for `spectant-001` (named commit, on `/spec-complete 001`) in the lane notes and the fixtures README · `core/CLAUDE.md`
- [x] T8 · ISC-88 · [P] · core — harbor 002 `rounds.jsonl` and `tasks.md` extended so one fixture holds every one of the eleven card states, a retry with `retry with:`, a question, concerns, a fail, a `stop` reason and a re-cut between rounds · `core/fixtures/harbor/specs/002-web-console/rounds.jsonl`
- [x] T9 · ISC-68 · core — golden test over every fixture, snapshots regenerated only together with the parser change (after: T1, T4, T5, T8) · `core/tests/golden.test.ts`
- [x] T10 · ISC-70 · [P] · core — private corpus test: every spec under `SPECTANT_PRIVATE_CORPUS` parses with zero diagnostics; skipped, never passed, when unset · `core/tests/private-corpus.test.ts`
- [x] T11 · ISC-79 · core — stage table as data, next command with its reason, applied to every fixture spec (after: T2) · `core/src/stage.ts`
- [x] T12 · ISC-78 · [P] · core — spec page model: head, key numbers, idea quote (first sentence of § Goal, fallback `task:`), lanes, gates, warnings, waiting on you (after: T1) · `core/src/spec.ts`
- [x] T13 · ISC-71 · [P] · core — resolution of workspace slug and spec id returns not-found, never a fallback spec · `core/src/resolve.ts`
- [x] T14 · ISC-80 · [P] · core — timeline merge of context.md decisions, rounds, gate marks and the commits the server passes in, one entry per source event, time-ordered (after: T1) · `core/src/timeline.ts`
- [x] T15 · ISC-36 · [P] · core — derived stage transitions marked `derived`; `events.jsonl` transitions replace them when present · `core/src/derived-stages.ts`
- [x] T16 · ISC-32 · [P] · core — `events.jsonl` line validator against `{ts, from, to, command, actor}` · `core/src/events.ts`
- [x] T17 · ISC-87 · [P] · core — frames from rounds: dispatch and result frames, worst state per frame, task states carried forward (after: T1) · `core/src/frames.ts`
- [x] T18 · ISC-91 · core — re-cut detection between rounds (ids and texts compared), struck tasks as absent, no state attributed to a renumbered id (after: T17) · `core/src/recut.ts`
- [x] T19 · ISC-92 · core — matrix cells: tasks × frames with state glyph keys, absent and re-cut columns (after: T17) · `core/src/matrix.ts`
- [x] T20 · ISC-37 · [P] · core — lock sources: frontier lock files under a given LifeOS state directory, `.spectant/activity.jsonl` claim/release lines, `none` when neither exists · `core/src/locks.ts`
- [x] T21 · ISC-90 · core — live frame from tasks.md plus the lock sources; a locked task in flight with its session name (after: T17, T20) · `core/src/live.ts`
- [x] T22 · ISC-81 · [P] · core — claim view model: glyph state (open, takeable, taken, blocked, closed, dropped), kind, dependency edges, probe row, verification line (after: T1) · `core/src/claim-view.ts`
- [x] T23 · ISC-82 · [P] · core — task line grammar in full: flags, lane from the constitution's lane table, state, edges, paths, plus the probe mapping table (after: T1) · `core/src/tasks.ts`
- [x] T24 · ISC-83 · [P] · core — evidence listing of `artifacts/` and `.evidence/` grouped by claim with media type; path confinement to the spec folder (after: T1) · `core/src/evidence.ts`
- [x] T25 · ISC-84 · [P] · core — markdown for docs: tables, code blocks, mermaid fences as figures, TOC extraction · `core/src/markdown-docs.ts`
- [x] T26 · ISC-80 · core — timeline tests: sources merged in order, one entry per event (after: T14, T15) · `core/tests/timeline.test.ts`
- [x] T27 · ISC-87 · core — frames tests including the re-cut and matrix cases on spec 001's own `rounds.jsonl` and harbor 002 (after: T17, T18, T19) · `core/tests/frames.test.ts`
- [x] T28 · ISC-90 · core — live frame tests: frontier source, activity source, none (after: T21) · `core/tests/live.test.ts`
- [x] T29 · ISC-79 · core — stage tests row by row against `FORMAT.md` (after: T11) · `core/tests/stage.test.ts`
- [x] T30 · ISC-32 · core — events validator tests (after: T16) · `core/tests/events.test.ts`

### ② Shell

- [x] T31 · ISC-98 · operator — strike T32, T59 and T60 in spec 001's tasks.md with a note naming this spec, then run `/spec-review 001` so 001's reviewed mark is fresh again · `specs/001-app-skeleton/tasks.md`
- [x] T32 · ISC-74 · [P] · web — fonts: Manrope, Sora and JetBrains Mono as local variable woff2, Inter removed, `fonts.css` rewritten · `web/src/styles/fonts.css`
- [x] T33 · ISC-74 · web — fonts test rewritten for the three faces and the no-external-URL guard (after: T32) · `web/tests/fonts.test.ts`
- [x] T34 · ISC-74 · [P] · web — tokens: the prototype's hex converted to OKLCH theme slots with the hex in comments, `-ink` aliases for accent text, the two narrow dark values guarded, no glow · `web/src/styles/tokens.css`
- [x] T35 · ISC-73 · [seam] · web — shell: `container: shell` with the three tiers, the grid with the 352 px rail at wide, the tab-bar slot per tier (header row 2 at compact, under the spec head above), the `LockSource` signal, the area routes `/w/:ws/s/:id/:tab` (after: T32, T34) · `web/src/app/layout/shell/`
- [x] T36 · ISC-73 · web — header: wordmark with living ring, workspace picker, spec picker (name, id at compact), area-menu trigger, palette trigger (field from a 1280 px header container), live indicator, zen, settings with help; the collapse order; two rows at compact · Mobile, one row above · Tablet, Desktop (after: T35) · `web/src/app/layout/header/`
- [x] T37 · ISC-76 · web — area menu as native popover with `aria-current`, Live and Notes as disabled entries with their reason while unbuilt; tab bar showing only the current area's tabs with counts; deep link selects area and tab (after: T35) · `web/src/app/layout/area-menu/`
- [x] T38 · ISC-75 · web — zen: tools and rail hidden, navigation sticky, footer status bar; rail collapse toggle at wide with its state through `/api/settings` (after: T35) · `web/src/app/layout/zen/`
- [ ] T39 · ISC-77 · web — spec 001's dashboard, overview, inspector and palette rendered inside the shell; their routes unchanged (after: T35, T36) · `web/src/app/features/dashboard/`
- [x] T40 · ISC-73 · web — e2e shell: exactly one header with the seven controls at 390 and 1440 (after: T36) · `web/e2e/shell.spec.ts`
- [x] T41 · ISC-75 · web — e2e zen and rail persistence (after: T38) · `web/e2e/shell-zen.spec.ts`
- [x] T42 · ISC-76 · web — e2e deep link selects area and tab (after: T37) · `web/e2e/spec-deeplink.spec.ts`
- [ ] T43 · ISC-77 · web — 001's e2e suites run on the new shell; 001's dashboard and overview baselines re-recorded once (after: T39) · `web/e2e/__screenshots__/`

### ③ Read-only areas

- [x] T44 · ISC-78 · [seam] · server — spec routes contract: paths and response types for spec, timeline, claims, tasks, evidence, docs, frames and live, shared with the web client (after: T1) · `server/src/spec-routes.contract.ts`
- [x] T45 · ISC-71 · server — spec routes with ETag; 404 `{error: "not-found"}` for an unknown workspace or spec (after: T44, T13) · `server/src/spec-routes.ts`
- [x] T46 · ISC-80 · [P] · server — read-only `git log` for the commits touching a spec folder, limited and cached per ETag (after: T44) · `server/src/git.ts`
- [x] T47 · ISC-83 · server — evidence file serving with media types, 403 for any path outside the spec folder (after: T44, T24) · `server/src/evidence.ts`
- [x] T48 · ISC-71 · server — routes test: unknown spec and workspace → 404, no fallback body (after: T45) · `tests/routes.test.ts`
- [x] T49 · ISC-83 · server — traversal test: `..`, absolute and symlinked paths refused with 403 (after: T47) · `tests/evidence.test.ts`
- [x] T50 · ISC-36 · server — timeline route tests: derived marker without `events.jsonl`, recorded transitions with it (after: T45, T46) · `tests/timeline.test.ts`
- [x] T51 · ISC-37 · server — optional LifeOS detection: state directory present or not, nothing read when absent, `GET /api/lifeos` (after: T20) · `server/src/lifeos.ts`
- [x] T52 · ISC-78 · [seam] · web — stub API extended: every spec route from the golden JSON, lock fixtures (frontier, activity, none), scripted 409 and 423 for the writes (after: T44) · `web/e2e/stub-api.ts`
- [x] T53 · ISC-78 · web — spec dashboard: KPI band, idea quote, next step with reason, lanes, five area tiles, Brief reuse; layouts per `design.md` · Mobile, Tablet, Desktop (after: T35, T52) · `web/src/app/features/spec/dashboard/`
- [x] T54 · ISC-79 · web — Status tab: where it stands, progress and gates, what is open, activity; rail content at the top below wide · Mobile, Tablet (after: T35, T52) · `web/src/app/features/spec/status/`
- [x] T55 · ISC-80 · web — Timeline tab: one strand, source filters, day headers, round entries expanding, `derived` chip (after: T35, T52) · `web/src/app/features/spec/status/timeline/`
- [x] T56 · ISC-81 · web — Claims tab: six glyphs, kind, edges, probe row, verification line, filters, note count pill slot (after: T35, T52) · `web/src/app/features/spec/data/claims/`
- [x] T57 · ISC-82 · web — Tasks tab: rows with lane, flags, state, edges, paths, probe mapping, filters; stacked rows below wide · Mobile, Tablet (after: T35, T52) · `web/src/app/features/spec/data/tasks/`
- [x] T58 · ISC-83.1 · web — Evidence tab: groups by claim, image and markdown preview in the dialog primitive (after: T35, T52) · `web/src/app/features/spec/data/evidence/`
- [x] T59 · ISC-84 · web — Docs tabs: rendered markdown with TOC, figures, tables in their own scroll region · Mobile, type-aware empty state (after: T35, T52) · `web/src/app/features/spec/docs/`
- [x] T60 · ISC-88 · web — primitives this spec adds beside 001's: `ui-glyph` (eleven card states, six claim states), `ui-state-chip`, `ui-scrubber`, `ui-disclosure`, `ui-toast` (after: T34) · `web/src/app/shared/ui/glyph/`
- [x] T61 · ISC-72 · web — e2e counts: every counter on the spec dashboard and its tabs equals the golden JSON (after: T53, T54, T55, T56, T57, T58, T59) · `web/e2e/counts.spec.ts`
- [x] T62 · ISC-78 · web — e2e spec dashboard (after: T53) · `web/e2e/spec.spec.ts`
- [x] T63 · ISC-81 · web — e2e claims tab (after: T56) · `web/e2e/data-claims.spec.ts`
- [x] T64 · ISC-82 · web — e2e tasks tab (after: T57) · `web/e2e/data-tasks.spec.ts`
- [x] T65 · ISC-83.1 · web — e2e evidence tab (after: T58) · `web/e2e/data-evidence.spec.ts`
- [x] T66 · ISC-84 · web — e2e docs tabs including the empty state for a refactor (after: T59) · `web/e2e/docs.spec.ts`

### ④ The two writes

- [x] T67 · ISC-26 · [seam] · server — writes contract: request bodies with the client's sha256, the 200 / 409 / 423 response shapes, the event line (after: T44) · `server/src/writes.contract.ts`
- [x] T68 · ISC-26 · server — `writes.ts`: read, compare sha256, write the target file with fsync, byte-identical on mismatch (after: T67) · `server/src/writes.ts`
- [x] T69 · ISC-24 · server — gate route: `.gates/reviewed.json` in the old skill's format plus exactly one `review → build` event line (after: T68, T16) · `server/src/gate-route.ts`
- [x] T70 · ISC-25 · server — checkbox route: exactly one task line changed in `tasks.md` (after: T68) · `server/src/checkbox-route.ts`
- [x] T71 · ISC-27 · server — lock guard: refuse a write while `.spectant/activity.jsonl` shows an open claim on the spec (after: T68, T20) · `server/src/lock-guard.ts`
- [x] T72 · ISC-86 · server — lock guard: frontier lock → 423 with the session name; no source available → proceed with source `none` (after: T71, T51) · `server/src/lock-guard.ts`
- [x] T73 · ISC-26 · server — writes test "cas": 409 and byte-identical file (after: T68) · `tests/writes.test.ts`
- [x] T74 · ISC-24 · server — writes test "reviewed": gate file plus one event (after: T69) · `tests/writes.test.ts`
- [x] T75 · ISC-25 · server — writes test "checkbox": one line changed (after: T70) · `tests/writes.test.ts`
- [x] T76 · ISC-27 · server — writes test "claim lock": refused under an activity line (after: T71) · `tests/writes.test.ts`
- [x] T77 · ISC-86 · server — writes test "frontier": 423 under a frontier lock, proceed with `none` (after: T72) · `tests/writes.test.ts`
- [x] T78 · ISC-85 · web — gate button in the spec head with ready, stale (changed files named), done, paused; the release dialog listing the three hashed files; the agent banner variants (after: T54, T67) · `web/src/app/layout/spec-head/`
- [x] T79 · ISC-85 · web — e2e gate: the four states, the dialog, scripted 409 and 423 (after: T78, T52) · `web/e2e/gate.spec.ts`
- [x] T80 · ISC-25 · web — checkbox write wiring in the Tasks tab: saving, locked with session name, conflict with Reload, operator rows tickable (after: T57, T67) · `web/src/app/features/spec/data/tasks/checkbox.ts`

### ⑤ Live and Notes

- [x] T81 · ISC-87 · web — board: toolbar, scrubber with frame kinds and labels, Lanes view with sections and lane order from the constitution, frame chip and progress line (after: T35, T52, T60) · `web/src/app/features/spec/live/board/`
- [x] T82 · ISC-87 · web — Flow view: four columns with band headers, FLIP moves, segmented control at compact · Mobile (after: T81) · `web/src/app/features/spec/live/flow/`
- [x] T83 · ISC-88 · web — card anatomy in both densities and the card detail dialog, every state with glyph, chip text and colour (after: T81) · `web/src/app/features/spec/live/card/`
- [x] T84 · ISC-89 · web — waiting groups by reason, collapsible, no card hidden (after: T81) · `web/src/app/features/spec/live/waiting/`
- [x] T85 · ISC-90 · web — live frame rendering: agent chips with elapsed time, stale marker, lock source name, probe status (after: T81) · `web/src/app/features/spec/live/live-frame.ts`
- [x] T86 · ISC-91 · web — re-cut marker on the scrubber and absent cards (after: T81) · `web/src/app/features/spec/live/recut.ts`
- [x] T87 · ISC-92 · web — Matrix tab: sticky first column, frame columns, glyph cells, cell click jumps the scrubber (after: T81) · `web/src/app/features/spec/live/matrix/`
- [x] T88 · ISC-87 · web — This frame and Needs you: rail blocks at wide, the bottom bar and sheet below wide merged with the zen footer · Mobile, Tablet (after: T81) · `web/src/app/features/spec/live/this-frame/`
- [x] T89 · ISC-87 · web — e2e board: scrubbing changes frames and no file (`git status --porcelain` empty) (after: T81, T82) · `web/e2e/board.spec.ts`
- [x] T90 · ISC-88 · web — e2e board states: all eleven card states on the harbor 002 fixture (after: T83) · `web/e2e/board-states.spec.ts`
- [x] T91 · ISC-89 · web — e2e waiting: shown cards equal the frame's tasks (after: T84) · `web/e2e/board-waiting.spec.ts`
- [x] T92 · ISC-92 · web — e2e matrix cell jump (after: T87) · `web/e2e/board-matrix.spec.ts`
- [x] T93 · ISC-93 · web — e2e narrow board at 600 px: no horizontal overflow, no lane scroller (after: T81) · `web/e2e/narrow-board.spec.ts`
- [x] T94 · ISC-94 · [seam] · server — notes contract: the note shape with workspace and at most one anchor, the CRUD routes, migration 2 with `schema_version` 2 · `server/src/notes.contract.ts`
- [x] T95 · ISC-94 · server — `note` table migration and CRUD; orphaning on workspace removal (after: T94) · `server/src/notes.ts`
- [x] T96 · ISC-94 · server — notes test "store": row present, repository tree unchanged (after: T95) · `tests/notes.test.ts`
- [x] T97 · ISC-52 · server — notes test "persist": create, edit, pin, restart, unchanged (after: T95) · `tests/notes.test.ts`
- [x] T98 · ISC-53 · server — CLI `import-notes <file>` from the old notes page's JSON, `export-notes <file>`, `db rollback 2` (after: T95) · `server/src/cli-notes.ts`
- [x] T99 · ISC-53 · server — notes test "import": count equal (after: T98) · `tests/notes.test.ts`
- [x] T100 · ISC-95 · web — Notes area: list and editor routes, anchor picker, import notice, stacked below wide · Mobile, Tablet, two panes at wide · Desktop (after: T35, T94, T52) · `web/src/app/features/spec/notes/`
- [x] T101 · ISC-95 · web — note count on claim cards and e2e notes (after: T100, T56) · `web/e2e/notes.spec.ts`

### ⑥ Cross-cutting

- [x] T102 · ISC-97 · web — keyboard service: `g` sequences for areas and tabs, `[` `]`, `v`, `◂ ▸`, `m`, `n`, `f`; shortcut sheet lists them; hints hidden on coarse pointers (after: T35) · `web/src/app/core/keyboard.service.ts`
- [x] T103 · ISC-97 · web — e2e keyboard on spec pages (after: T102) · `web/e2e/keyboard-spec.spec.ts`
- [x] T104 · ISC-2 · web — offline e2e extended to every new route in both themes (after: T53, T54, T55, T56, T57, T58, T59, T81, T100) · `web/e2e/offline.spec.ts`
- [ ] T105 · ISC-23 · web — visual baseline: spec page (Status, Claims, Tasks), light, three widths (after: T54, T56, T57) · `web/e2e/visual-spec.spec.ts`
- [ ] T106 · ISC-23.1 · web — visual baseline: spec page, dark (after: T105) · `web/e2e/visual-spec.spec.ts`
- [ ] T107 · ISC-49 · web — visual baseline: board Lanes and Flow, light, three widths (after: T81, T82) · `web/e2e/visual-board.spec.ts`
- [ ] T108 · ISC-49.1 · web — visual baseline: board, dark (after: T107) · `web/e2e/visual-board.spec.ts`
- [ ] T109 · ISC-96 · web — visual baseline: spec dashboard and Notes area, light, three widths (after: T53, T100) · `web/e2e/visual-spec-notes.spec.ts`
- [ ] T110 · ISC-96.1 · web — visual baseline: spec dashboard and Notes area, dark (after: T109) · `web/e2e/visual-spec-notes.spec.ts`
- [x] T111 · ISC-68.1 · repo — root `CLAUDE.md`: the read-only rule names its two exceptions (reviewed gate, task checkbox) and the guard (after: T2) · `CLAUDE.md`
- [x] T112 · ISC-68.1 · server — `server/CLAUDE.md`: the write path, the lock sources, the spec routes (after: T2) · `server/CLAUDE.md`
- [x] T113 · ISC-68.1 · web — `web/CLAUDE.md`: the shell tiers, the tab-bar slot, the area routes, the new primitives (after: T35) · `web/CLAUDE.md`
- [x] T114 · ISC-99 · core — takeable gated on a fresh reviewed mark: rule in `status.ts`/`stage.ts`, dashboard row, claims tab counts and `takeableSet` follow, goldens regenerated (after: T1) · `core/src/status.ts`
- [x] T115 · ISC-90 · [P] · core — `DashboardSpecRow.taken: {id, session, since}[]` and lock diagnostics surfaced as row warnings, so the board can name the session (after: T20) · `core/src/dashboard.ts`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1, T9 | ISC-68 | `bun test core/tests/golden.test.ts` |
| T2, T3, T111, T112, T113 | ISC-68.1 | `bun run check:format-doc` |
| T4, T5, T6, T7 | ISC-69 | `bun test core/tests/fixtures.test.ts -t "corpus"` |
| T10 | ISC-70 | `bun test core/tests/private-corpus.test.ts` |
| T13, T45, T48 | ISC-71 | `bun test tests/routes.test.ts -t "not found"` and `bun run e2e -- spec -g "not found"` |
| T61 | ISC-72 | `bun run e2e -- counts` |
| T35, T36, T40 | ISC-73 | `bun run e2e -- shell -g header` |
| T32, T33, T34 | ISC-74 | `bun test web/tests/fonts.test.ts` |
| T38, T41 | ISC-75 | `bun run e2e -- shell -g zen` |
| T37, T42 | ISC-76 | `bun run e2e -- spec -g "deep link"` |
| T39, T43 | ISC-77 | `bun run e2e -- dashboard overview palette keyboard` |
| T12, T44, T52, T53, T62 | ISC-78 | `bun run e2e -- spec -g dashboard` |
| T11, T29, T54 | ISC-79 | `bun test core/tests/stage.test.ts` |
| T14, T26, T46, T55 | ISC-80 | `bun test core/tests/timeline.test.ts -t "sources"` |
| T22, T56, T63 | ISC-81 | `bun run e2e -- data -g claims` |
| T23, T57, T64 | ISC-82 | `bun run e2e -- data -g tasks` |
| T24, T47, T49 | ISC-83 | `bun test tests/evidence.test.ts -t "traversal"` |
| T58, T65 | ISC-83.1 | `bun run e2e -- data -g evidence` |
| T25, T59, T66 | ISC-84 | `bun run e2e -- docs` |
| T78, T79 | ISC-85 | `bun run e2e -- gate` |
| T72, T77 | ISC-86 | `bun test tests/writes.test.ts -t "frontier"` |
| T17, T27, T81, T82, T88, T89 | ISC-87 | `bun test core/tests/frames.test.ts` and `git status --porcelain` empty after `bun run e2e -- board -g scrub` |
| T8, T60, T83, T90 | ISC-88 | `bun run e2e -- board -g states` |
| T84, T91 | ISC-89 | `bun run e2e -- board -g waiting` |
| T21, T28, T85, T115 | ISC-90 | `bun test core/tests/live.test.ts` |
| T18, T86 | ISC-91 | `bun test core/tests/frames.test.ts -t "recut"` |
| T19, T87, T92 | ISC-92 | `bun run e2e -- board -g matrix` |
| T93 | ISC-93 | `bun run e2e -- narrow -g board` |
| T94, T95, T96 | ISC-94 | `bun test tests/notes.test.ts -t "store"` |
| T100, T101 | ISC-95 | `bun run e2e -- notes` |
| T109 | ISC-96 | `bun run test:visual -- spec notes` |
| T110 | ISC-96.1 | `bun run test:visual -- spec notes --theme dark` |
| T102, T103 | ISC-97 | `bun run e2e -- keyboard -g spec` |
| T31 | ISC-98 | `rg -c "shell with container tiers\|header: eyebrow" specs/001-app-skeleton/tasks.md` → 0 and the Spec skill's `SpecGate check reviewed 001` exits 0 |
| T104 | ISC-2 | `bun run e2e -- offline` plus `bun run test:offline:server` |
| T105 | ISC-23 | `bun run test:visual -- review` |
| T106 | ISC-23.1 | `bun run test:visual -- review --theme dark` |
| T69, T74 | ISC-24 | `bun test tests/writes.test.ts -t "reviewed"` |
| T70, T75, T80 | ISC-25 | `bun test tests/writes.test.ts -t "checkbox"` |
| T67, T68, T73 | ISC-26 | `bun test tests/writes.test.ts -t "cas"` |
| T71, T76 | ISC-27 | `bun test tests/writes.test.ts -t "claim lock"` |
| T16, T30 | ISC-32 | `bun test core/tests/events.test.ts` |
| T15, T50 | ISC-36 | `bun test core/tests/timeline.test.ts` |
| T20, T51 | ISC-37 | `bun test tests/lifeos-optional.test.ts` |
| T107 | ISC-49 | `bun run test:visual -- report` |
| T108 | ISC-49.1 | `bun run test:visual -- report --theme dark` |
| T114 | ISC-99 | `bun test core/tests/status.test.ts -t "review gate"` |
| T97 | ISC-52 | `bun test tests/notes.test.ts -t "persist"` |
| T98, T99 | ISC-53 | `bun test tests/notes.test.ts -t "import"` |
