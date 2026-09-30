---
spec: 001-app-skeleton
plan: plan.md
updated: 2026-09-30T16:09:34Z
---

# Tasks 001 — App skeleton and dashboard

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

Re-cut after round 4 (2026-09-28): the first cut chained tasks with `(after: …)` edges to ordinary tasks, which
SpecRun runs one per round. This cut names five seams (the contracts every later task builds against) and gives every
other task `[P]`; ordering inside a lane comes from the seams, from the same-file rule, and from task numbering (a
test task is numbered after the feature it exercises). Done tasks keep their IDs; open tasks are renumbered.

Re-cut after round 10 (2026-09-29, Decisions in the master): the shell and the header moved to spec 002 (its T35, T36)
and `FORMAT.md` to spec 002 (ISC-68.1). T32 and T60 are struck; T33 lost its `(after: T32)` edge; T59 became an
operator prerequisite ("002's shell has landed") so the `(after: T59)` edges of T61–T82 stay meaningful and hold until
the principal ticks it. Only 002 builds the shell; 001 builds its views inside it.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

### ① Skeleton

- [x] T1 · ISC-8 · [P] · repo — root `package.json` with bun workspaces `core`, `server`, `web`, pinned bun, the script names from the plan, `bunfig.toml` excluding `web/src` from root `bun test` · `package.json`
- [x] T2 · ISC-5.1 · [P] · repo — root `CLAUDE.md` (only what applies everywhere) and the `README.md` skeleton · `CLAUDE.md`
- [x] T3 · ISC-5.1 · [P] · core — `core/CLAUDE.md`: lane probe, the one-parser rule, fixture conventions · `core/CLAUDE.md`
- [x] T4 · ISC-5.1 · [P] · server — `server/CLAUDE.md`: lane probe, loopback rule, no writes into repos · `server/CLAUDE.md`
- [x] T5 · ISC-5.1 · [P] · web — `web/CLAUDE.md`: lane probe, framework and design rules written out, container tiers, token rules · `web/CLAUDE.md`
- [x] T6 · ISC-8 · [seam] · server — build contract: the web output folder, base href, the embed manifest type and content-type map the server reads · `server/src/assets.contract.ts`
- [x] T7 · ISC-8 · [P] · web — Angular 22 zoneless standalone workspace with one hello route, Vitest builder, Tailwind 4 + daisyUI 5 wired, output where T6 says · `web/`
- [x] T8 · ISC-5.2 · [P] · repo — ESLint (Angular rules, template a11y), Stylelint (`color-no-hex` with the two theme files exempt, no literal durations outside `motion.css`), `tsc --noEmit`; `check:static`, `lint`, `lint:css`, `typecheck` become real · `eslint.config.js`
- [x] T9 · ISC-8 · [P] · server — embed generator writing `server/embedded.gen.ts` from the web output through `embeddedAssetFor()` of the contract · `scripts/embed.ts`
- [x] T10 · ISC-8 · [P] · server — loopback server taking the manifest as a parameter: embedded assets, content types, cache headers, SPA fallback, a `serve` entry · `server/src/http.ts`
- [x] T11 · ISC-8 · [seam] · server — build script: Angular build (system Node ≥ 22.22.3 for the Angular CLI), embed, `bun build --compile` for the four targets (`-baseline` for linux-x64, `codesign -s -` on macOS), version inlined with `--define` (after: T9, T10) · `scripts/build.ts`
- [x] T12 · ISC-8.1 · [P] · server — binary smoke: copy the host binary to an empty temp dir, `--no-browser --port 0`, three routes; `test:binary` (after: T11) · `tests/binary.test.ts`
- [x] T13 · ISC-9 · [P] · server — `--version` from the inlined build version, `check:version` (after: T11) · `server/src/cli.ts`
- [x] T14 · ISC-10 · [P] · server — `install.sh` (OS/arch, `SPECTANT_RELEASE_URL`, `/usr/local/bin` when writable else `~/.local/bin`, PATH hint, never edits an rc file) plus the non-root Ubuntu container run against a local release dir that also runs the binary smoke; `test:install:linux` (after: T11) · `install.sh`
- [x] T15 · ISC-12 · [P] · server — `INSTALL_DIR` override plus the "`/usr/local/bin` not writable → `~/.local/bin`" container case (after: T11) · `install.sh`
- [ ] T16 · ISC-11 · operator — macOS arm64 install on a throwaway user account, transcript into `.evidence/` (after: T11) · `tests/install/run-macos.md`

### ② Design system and baseline

- [x] T17 · ISC-18 · [P] · web — themes `spec-light` / `spec-dark` from the old token blocks (OKLCH, hex in comments), daisyUI `themes: false`, `--depth: 0`, `--noise: 0`, plus the colour guard `web/tests/theme-colors.test.ts` (ΔE ≤ 0.5 round-trip, both themes) · `web/src/styles.css`
- [x] T18 · ISC-65 · [P] · web — derived tokens `--muted`, `--track`, `--*-ink` and the container tier names, values from design.md · `web/src/styles/tokens.css`
- [x] T19 · ISC-67 · [P] · web — Inter Variable and JetBrains Mono as local woff2 with `@font-face`, plus the "local" guard · `web/tests/fonts.test.ts`
- [x] T20 · ISC-67.1 · [P] · web — the "external font URL" guard · `web/tests/fonts.test.ts`
- [x] T21 · ISC-66 · [P] · web — motion tokens and the `prefers-reduced-motion` override to `0ms`, skeleton static, view transitions skipped · `web/src/styles/motion.css`
- [x] T22 · ISC-18.2 · [P] · web — icon module: only used icons from the pinned `lucide-static` version, plus the guard `web/tests/icons.test.ts` · `web/src/app/shared/icons/`
- [x] T23 · ISC-22 · [P] · web — Transloco with EN and DE catalogues (German formal), language from settings, plus the parity guard `web/tests/i18n-parity.test.ts` · `web/src/i18n/`
- [x] T24 · ISC-64 · [P] · web — `ui-button`, `ui-icon-button`, `ui-button-group` with the global `:focus-visible` ring and the coarse-pointer hit area · `web/src/app/shared/ui/button/`
- [x] T25 · ISC-17 · [P] · web — display primitives: `ui-card`, `ui-kpi-tile`, `ui-ring`, `ui-meter`, `ui-stage-track`, `ui-chip`, `ui-id-chip`, `ui-filter-chips`, `ui-segmented`, `ui-section-header`, `ui-kbd`, `ui-skeleton`, `ui-empty-state`, `ui-notice`, `ui-live-region`, `ui-relative-time`, `ui-command-chip` · `web/src/app/shared/ui/`
- [x] T26 · ISC-17 · [P] · web — overlay primitives: `ui-popover` (anchor positioning with the `@supports` fallback), `ui-sheet`, `ui-dialog`, `ui-disclosure` (`grid-template-rows` animation) · `web/src/app/shared/ui/overlay/`
- [x] T27 · ISC-61 · [P] · web — `uiRovingList` directive (arrows, j/k, Home/End, no wrap) · `web/src/app/shared/ui/roving-list.directive.ts`
- [x] T28 · ISC-17 · [seam] · web — Playwright config: chromium + webkit projects, the pinned Linux container runner behind `test:visual`, `e2e`, `test:browser`; clock pinned, animations disabled, `data-ready` awaited; the `web/e2e/` layout every later spec follows (after: T24, T25, T26, T27) · `web/e2e/playwright.config.ts`
- [x] T29 · ISC-64 · [P] · web — browser spec: focus ring on every interactive element, both themes (after: T28) · `web/src/app/shared/ui/focus.browser.spec.ts`
- [x] T30 · ISC-65 · [P] · web — browser spec: contrast of text and marks, both themes (after: T28) · `web/src/app/shared/ui/contrast.browser.spec.ts`
- [x] T31 · ISC-66 · [P] · web — browser spec: no animation or transition runs under reduced motion (after: T28) · `web/src/app/shared/ui/motion.browser.spec.ts`

### ③ Core and API

- [x] T35 · ISC-6 · [P] · core — synthetic fixture spec trees with fixed dates: `.gates/`, `rounds.jsonl`, `tldr.md`, an archive, every warning class, a three-digit/three-digit master fraction; none copied from a real repository · `core/fixtures/`
- ~~T32 · ISC-6 · core — `FORMAT.md`: the file contract as far as the dashboard reads it~~ — struck 2026-09-29: `FORMAT.md` is owned by spec 002 (ISC-68.1, its T2); ISC-6 keeps its golden test here (T40)
- [x] T33 · ISC-6 · [seam] · core — frontmatter and claim parser plus the core module skeleton: exported types and function signatures (stubs) for status, gates, stage, takeable, diagrams, tldr, markdown, archive and dashboard, so the fill-ins can be built in parallel · `core/src/` (its former edge to T32 was dropped 2026-09-29: FORMAT.md follows the parser and is written by spec 002)
- [x] T34 · ISC-6 · [P] · core — status: claim partition and drift classes, ported from the old status tool (after: T33) · `core/src/status.ts`
- [x] T36 · ISC-15 · [P] · core — review and code-review marks with in-memory worktree hashing, no git object writes; `generate.ts` in the fixtures switches to this import (after: T33) · `core/src/gates.ts`
- [x] T37 · ISC-14 · [P] · core — stage derivation and next-command rules, ported from the old dashboard tool (after: T33) · `core/src/stage.ts`
- [x] T38 · ISC-16 · [P] · core — takeable set, diagram verdict, TL;DR staleness, markdown renderer, archive listing (after: T33) · `core/src/{takeable,diagrams,tldr,markdown,archive}.ts`
- [x] T39 · ISC-16 · [seam] · core — dashboard model assembly: the JSON the server returns and the web app renders (after: T34, T36, T37, T38) · `core/src/dashboard.ts`
- [x] T40 · ISC-6 · [P] · core — golden snapshot test writing and checking `core/fixtures/<name>.golden.json` (after: T39) · `core/tests/fixtures.test.ts`
- [x] T41 · ISC-14 · [P] · core — parity test over `SPECTANT_PARITY_TREES`, failing on zero comparisons (after: T39) · `core/tests/stage-parity.test.ts`
- [x] T45 · ISC-5 · [P] · server — `check:single-core`: fails on a frontmatter, claim or stage parser outside `core/` · `scripts/check-single-core.ts`
- [x] T46 · ISC-21 · [P] · server — data directory resolution with its tests · `server/src/paths.ts`
- [x] T42 · ISC-13 · [P] · server — SQLite workspace registry with slug deduplication · `server/src/registry.ts`
- [x] T43 · ISC-18.3 · [P] · server — settings table and the `/api/settings` GET + PUT handlers, with `tests/settings.test.ts` across a port change · `server/src/settings.ts`
- [x] T44 · ISC-13 · [P] · server — CLI `add`, `list`, `remove` with `tests/workspaces.test.ts` (after: T42) · `server/src/cli.ts`
- [x] T47 · ISC-16 · [P] · server — `/api/workspaces` and `/api/workspaces/:slug/dashboard` with ETag, plus the two-workspace `tests/dashboard.test.ts` (after: T39) · `server/src/api.ts`
- [x] T48 · ISC-16 · [P] · server — local listeners for the live indicator, empty when `lsof` is missing · `server/src/services.ts`
- [x] T49 · ISC-1 · [P] · server — loopback-only bind test · `tests/server.test.ts`
- [x] T50 · ISC-20 · [P] · server — port 7717 with fallback, URL printed, browser opened unless `--no-browser`, plus the start-up cases in `tests/cli.test.ts` · `server/src/cli.ts`
- [x] T51 · ISC-7 · [P] · server — rebuild test: delete the data directory, re-add, view equal (after: T39) · `tests/rebuild.test.ts`
- [x] T52 · ISC-15 · [P] · server — read-only test: recursive hash of the fixture repo incl. `.git/` before and after add + browse; `test:readonly` (after: T39) · `tests/readonly.test.ts`
- [x] T53 · ISC-2 · [P] · server — server-side offline run: the binary in `docker run --network none` through a scripted session; `test:offline:server` (after: T11) · `tests/offline-server.ts`
- [x] T54 · ISC-3 · [P] · server — `check:leak`: generic classes plus an optional private word list outside the repo · `scripts/check-leak.ts`
- [x] T55 · ISC-4 · [P] · repo — Apache-2.0 `LICENSE` and `THIRD_PARTY_NOTICES.md` · `LICENSE`
- [x] T56 · ISC-5.2 · [P] · repo — `.github/workflows/ci.yml` running `bun run verify` in the pinned Playwright container with Node ≥ 22.22.3 · `.github/workflows/ci.yml`

### ④ Views

- [x] T57 · ISC-17 · [P] · web — stub API serving the fixtures' golden JSON for e2e and visual runs (after: T28, T39) · `web/e2e/stub-api.ts`
- [x] T58 · ISC-18.1 · [P] · web — pre-paint `data-theme` script, theme service (system / light / dark, live `matchMedia`), settings service · `web/src/app/core/theme.service.ts`
- [x] T59 · ISC-16 · operator — prerequisite from spec 002: its shell seam (002-T35: container tiers, routes `/`, `/w/:ws`, `/w/:ws/s/:id`, tab-bar slot, API client) has landed in the main tree — tick when it has; every task below that carried `(after: T59)` waits on it (re-cut 2026-09-29, the shell moved to spec 002) · `specs/002-shell-and-spec-page/tasks.md`
- ~~T60 · ISC-16 · web — the old header~~ — struck 2026-09-29: the header is spec 002's T36 (ISC-73), built to the prototype
- [x] T61 · ISC-17 · [P] · web — `kpi-band` in its three container forms, tiles as links (after: T59) · `web/src/app/features/dashboard/kpi-band/`
- [x] T62 · ISC-17 · [P] · web — Brief disclosure (TL;DR markdown, stale chip, command chip) (after: T59) · `web/src/app/features/dashboard/brief/`
- [x] T63 · ISC-61 · [P] · web — Specs panel: toolbar (phase / type filters, sort, phase strip), `spec-row` in normal, compact and dense forms, archive fold, roving list, plus e2e `keyboard.spec.ts` "move" (after: T59) · `web/src/app/features/dashboard/spec-table/`
- [x] T64 · ISC-17 · [P] · web — `next-up-list`, `warnings-panel`, `context-rail` (rail at wide, cards below wide) (after: T59) · `web/src/app/features/dashboard/next-up-list/`
- [x] T65 · ISC-16 · [P] · web — overview `/` ported from the prototype's `index.html` (`app.js` `pageOverview` / `wsColumn`): `workspace-column` with ws-head (logo badge, name, mono path, updated), `kpi-strip` 2×2 at 96 px (master ring 56 + fraction, spec claims + lime meter, specs + building/scoping split meter, warnings + open fog with an orange edge above 0), Next up card with up to three `next-row`s, 40 px dense list, "Open <name> →"; auto-fit grid ≥ 360 px, three columns from 1300 px; empty and unreadable states; no cover image (after: T59, T85, T86) · `web/src/app/features/overview/`
- [x] T66 · ISC-60 · [P] · web — command palette: dialog, combobox, groups, ranking, actions; ⌘K / Ctrl+K / `/`, plus e2e `palette.spec.ts` "open" (after: T59) · `web/src/app/layout/command-palette/`
- [x] T67 · ISC-61.2 · [P] · web — extend spec 002's `SHORTCUTS` table and shortcut sheet with the dashboard context (`c`, `r`, `/`, `j k`, `h l`, `1`–`3`, `g a/s/n/w` bound to `/w/:ws`, single-key switch), no second service; e2e `keyboard.spec.ts` "help" (after: T59) · `web/src/app/core/keyboard-bindings.ts`, `web/src/app/features/shortcuts/`
- [x] T68 · ISC-62 · [P] · web — refresh service: ETag polling, refresh on visibility, in-place diff, changed-value tint, changed-row dot, "n new" pill, one polite announcement, plus e2e `refresh.spec.ts` "in-place" (after: T59) · `web/src/app/core/refresh.service.ts`
- [x] T69 · ISC-61.1 · [P] · web — spec preview on `/w/:ws?spec=<id>`: `spec-inspector` in the rail (wide), `ui-sheet` side (medium) and full-screen (compact), Open to `/w/:ws/s/:id`, Esc clears the query and returns focus, `[` `]`, plus e2e `keyboard.spec.ts` "enter" (after: T59, T63) · `web/src/app/features/dashboard/spec-inspector/`
- [x] T70 · ISC-60.1 · [P] · web — palette filtering plus e2e `palette.spec.ts` "filter" (after: T59) · `web/src/app/layout/command-palette/filter.ts`
- [ ] T71 · ISC-60.2 · [P] · web — palette Enter navigation plus e2e `palette.spec.ts` "enter" (after: T59) · `web/src/app/layout/command-palette/navigate.ts`
- [ ] T72 · ISC-62.1 · [P] · web — e2e `refresh.spec.ts` "cls": layout shift 0 during a refresh (after: T59) · `web/e2e/refresh.spec.ts`
- [ ] T73 · ISC-63 · [P] · web — narrow container behaviour of the dashboard at 600 px plus e2e `narrow.spec.ts` "dashboard" (after: T59) · `web/e2e/narrow.spec.ts`
- [ ] T74 · ISC-63.1 · [P] · web — e2e `narrow.spec.ts` "column": workspace column at 600 px (after: T59) · `web/e2e/narrow.spec.ts`
- [ ] T75 · ISC-18.1 · [P] · web — e2e `theme.spec.ts` "system": follows `emulateMedia` live (after: T59) · `web/e2e/theme.spec.ts`
- [ ] T76 · ISC-18.3 · [P] · web — e2e `theme.spec.ts` "persist": chosen mode survives reload on another port (after: T59) · `web/e2e/theme.spec.ts`
- [x] T77 · ISC-2 · [P] · web — e2e `offline.spec.ts`: `route('**')` fails every non-loopback host across every route in both themes (after: T59) · `web/e2e/offline.spec.ts`
- [ ] T78 · ISC-19.1 · [P] · web — e2e `smoke.spec.ts` on the webkit project: `/` and `/w/:ws`, zero console errors (after: T59) · `web/e2e/smoke.spec.ts`
- [x] T79 · ISC-17 · [P] · web — visual baseline: dashboard, light, three widths, committed under `web/e2e/__screenshots__/` (after: T59) · `web/e2e/visual.spec.ts`
- [x] T80 · ISC-17.1 · [P] · web — visual baseline: dashboard, dark (after: T59) · `web/e2e/visual.spec.ts`
- [x] T81 · ISC-16.1 · [P] · web — visual baseline: overview, light, three states (after: T59) · `web/e2e/visual.spec.ts`
- [x] T82 · ISC-16.2 · [P] · web — visual baseline: overview, dark (after: T59) · `web/e2e/visual.spec.ts`
- [ ] T83 · ISC-19 · operator — cmux web view check with Interceptor, WebKit version recorded (after: T11, T78) · `tests/visual/cmux-check.md`

### ⑤ Prototype port (principal 2026-09-29: tile split, data, visualisation, colours, typefaces and edge + glow are binding)

Source: `.design/prototype/prototyp/public/spectant-ui/` (`styles.css`, `app.js`, `pages.js`); inventory with line numbers in `.design/handover-003/` (`tiles.md`, `tokens.md`, `compare/`). Each task ports the named function and rule range instead of re-deriving it; data comes from the dashboard model, mocked only where the parser has none (none known for these tiles).

- [x] T84 · ISC-17 · [seam] · web — tokens the themes still lack, from `styles.css:16-45`: the `-text` inks (light cyan `#027892`, lime `#417c02`, green `#007e50`, yellow `#a15e01`, red `#ca3063`), teal / teal-t, badge (light `#007e9a`), track (dark `#7f7d80`), the seven tints, scrim and shadow colour, both themes, as theme variables the components use; `web/tests/theme-colors.test.ts` extended to them · `web/src/styles.css`
- [x] T85 · ISC-17 · [seam] · web — card primitive: `edge` (3 px top bar in `--edge`, default cyan) and `glow` (corner `radial-gradient` at 14 % of `--edge`, opacity .7, 1 on a linked card's hover) variants of `ui-card` per `styles.css:112-123`; `web/tests/no-glow.test.ts` re-scoped to "glow only in `ui-card`'s glow variant" and its anchor corrected (master Decisions 2026-09-29, glow) · `web/src/app/shared/ui/card/`, `web/tests/no-glow.test.ts`
- [x] T86 · ISC-17 · [seam] · web — type scale from `styles.css` as utilities: eyebrow 11/16 600 uppercase .08em, meta 12/16, page h1 24/32, section h2 16/24, card h3 15/24 Sora, KPI value 32/40, hero 40/48, strip 22/28, ring percentage 22 (15 small), chip 11 600 .06em · `web/src/styles.css`
- [x] T87 · ISC-17 · web — KPI band ported from `app.js` `pageWorkspace` (l.194-212) and `styles.css:297-328` (band and Pulse): `352px repeat(3, 1fr)` with 120 px rows at wide, hero spanning two columns and two rows at medium; hero "Master claims" ring 112 + fraction + "n % closed · m open"; Spec claims + lime meter (lime edge); Specs + split meter + building/scoping legend; Takeable now (cyan edge); Attention `span-wide` (orange edge, warnings · open fog); Archive (violet edge); every tile `card edge glow`; below 640 px the Pulse card (ring 72, spec-claims meter, Specs / Takeable / Attention row) (after: T85, T86) · `web/src/app/features/dashboard/kpi-band/`
- [x] T88 · ISC-17 · web — Brief card ported from `styles.css:342-349`: violet left edge, header "TL;DR · as of <date>" with the stale chip and `/spec-tldr`, body clipped with a "More…" expander instead of the collapsed disclosure (after: T85, T86) · `web/src/app/features/dashboard/brief/`
- [x] T89 · ISC-17 · web — Specs table ported from `styles.css:362-400` (`spec-table`, `spec-row`, `phase-strip` 365-368): head "Specs n · k archived" with phase filter chips and a sort popover (Stage / ID / Progress), phase strip, rows `40px | title + one-line description | agent dot + mini five-segment stage track + phase chip | meter + a/b` at 48–64 px, current row cyan tint with the 3 px inset edge, archived footer; keyboard behaviour of T63 unchanged (after: T86) · `web/src/app/features/dashboard/spec-table/`
- [x] T90 · ISC-17 · web — rail ported from `styles.css` (`next-card` 356-358, `next-row` 480-481, `rail-card` 617-618, `fog-line` ~660-663, `warn-line` 1197-1198): Next up `next-card`s (cyan left edge, id chip + title, labelled five-stage track, command chip + takeable chip), Warnings lines (alert icon, spec link, text) and fog lines (cloud icon, violet) (after: T85, T86) · `web/src/app/features/dashboard/{next-up-list,warnings-panel}/`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1, T6, T7, T9, T10, T11 | ISC-8 | `bun run build && test $(ls dist/spectant-{darwin,linux}-{arm64,x64} \| wc -l) -eq 4` |
| T2–T5 | ISC-5.1 | `test -f CLAUDE.md -a -f core/CLAUDE.md -a -f server/CLAUDE.md -a -f web/CLAUDE.md` |
| T8, T56 | ISC-5.2 | `bun run check:static` |
| T12 | ISC-8.1 | `bun run test:binary` |
| T13 | ISC-9 | `bun run check:version` |
| T14 | ISC-10 | `bun run test:install:linux` |
| T15 | ISC-12 | `bun run test:install:linux -- INSTALL_DIR=/opt/x/bin` |
| T16 | ISC-11 | transcript with a throwaway user account (manual) |
| T17 | ISC-18 | `bun test web/tests/theme-colors.test.ts` |
| T18, T30 | ISC-65 | `bun run test:browser -- contrast` |
| T19 | ISC-67 | `bun test web/tests/fonts.test.ts -t "local"` |
| T20 | ISC-67.1 | `bun test web/tests/fonts.test.ts -t "external"` |
| T21, T31 | ISC-66 | `bun run test:browser -- motion` |
| T22 | ISC-18.2 | `bun test web/tests/icons.test.ts` |
| T23 | ISC-22 | `bun test web/tests/i18n-parity.test.ts` |
| T24, T29 | ISC-64 | `bun run test:browser -- focus` |
| T25, T26, T28, T57, T61, T62, T64, T79, T84–T90 | ISC-17 | `bun run test:visual -- dashboard` |
| T80 | ISC-17.1 | `bun run test:visual -- dashboard --theme dark` |
| T27, T63 | ISC-61 | `bun run e2e -- keyboard -g move` |
| T32, T33, T34, T35, T40 | ISC-6 | `bun test core/` |
| T36, T52 | ISC-15 | `bun run test:readonly` |
| T37, T41 | ISC-14 | `bun test core/tests/stage-parity.test.ts` |
| T38, T39, T47, T48, T59, T60, T65 | ISC-16 | `bun test tests/dashboard.test.ts -t "multi-workspace"` |
| T42, T44 | ISC-13 | `bun test tests/workspaces.test.ts` |
| T43, T76 | ISC-18.3 | `bun run e2e -- theme -g persist` |
| T45 | ISC-5 | `bun run check:single-core` |
| T46 | ISC-21 | `bun test tests/cli.test.ts -t "data dir"` |
| T49 | ISC-1 | `bun test tests/server.test.ts -t "loopback"` |
| T50 | ISC-20 | `bun test tests/cli.test.ts -t "start"` |
| T51 | ISC-7 | `bun test tests/rebuild.test.ts` |
| T53, T77 | ISC-2 | `bun run e2e -- offline` plus `bun run test:offline:server` |
| T54 | ISC-3 | `bun run check:leak` |
| T55 | ISC-4 | `test -f LICENSE && rg -q 'Apache License' LICENSE && test -f THIRD_PARTY_NOTICES.md` |
| T58, T75 | ISC-18.1 | `bun run e2e -- theme -g system` |
| T66 | ISC-60 | `bun run e2e -- palette -g open` |
| T70 | ISC-60.1 | `bun run e2e -- palette -g filter` |
| T71 | ISC-60.2 | `bun run e2e -- palette -g enter` |
| T67 | ISC-61.2 | `bun run e2e -- keyboard -g help` |
| T69 | ISC-61.1 | `bun run e2e -- keyboard -g enter` |
| T68 | ISC-62 | `bun run e2e -- refresh -g in-place` |
| T72 | ISC-62.1 | `bun run e2e -- refresh -g cls` |
| T73 | ISC-63 | `bun run e2e -- narrow -g dashboard` |
| T74 | ISC-63.1 | `bun run e2e -- narrow -g column` |
| T78 | ISC-19.1 | `bun run e2e -- --project webkit smoke` |
| T81 | ISC-16.1 | `bun run test:visual -- overview` |
| T82 | ISC-16.2 | `bun run test:visual -- overview --theme dark` |
| T83 | ISC-19 | Interceptor / cmux screenshot (manual) |
