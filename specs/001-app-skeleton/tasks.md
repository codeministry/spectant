---
spec: 001-app-skeleton
plan: plan.md
updated: 2026-09-28T13:02:35Z
---

# Tasks 001 — App skeleton and dashboard

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

Re-cut after round 4 (2026-09-28): the first cut chained tasks with `(after: …)` edges to ordinary tasks, which
SpecRun runs one per round. This cut names five seams (the contracts every later task builds against) and gives every
other task `[P]`; ordering inside a lane comes from the seams, from the same-file rule, and from task numbering (a
test task is numbered after the feature it exercises). Done tasks keep their IDs; open tasks are renumbered.

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
- [ ] T26 · ISC-17 · [P] · web — overlay primitives: `ui-popover` (anchor positioning with the `@supports` fallback), `ui-sheet`, `ui-dialog`, `ui-disclosure` (`grid-template-rows` animation) · `web/src/app/shared/ui/overlay/`
- [ ] T27 · ISC-61 · [P] · web — `uiRovingList` directive (arrows, j/k, Home/End, no wrap) · `web/src/app/shared/ui/roving-list.directive.ts`
- [ ] T28 · ISC-17 · [seam] · web — Playwright config: chromium + webkit projects, the pinned Linux container runner behind `test:visual`, `e2e`, `test:browser`; clock pinned, animations disabled, `data-ready` awaited; the `web/e2e/` layout every later spec follows (after: T24, T25, T26, T27) · `web/e2e/playwright.config.ts`
- [ ] T29 · ISC-64 · [P] · web — browser spec: focus ring on every interactive element, both themes (after: T28) · `web/src/app/shared/ui/focus.browser.spec.ts`
- [ ] T30 · ISC-65 · [P] · web — browser spec: contrast of text and marks, both themes (after: T28) · `web/src/app/shared/ui/contrast.browser.spec.ts`
- [ ] T31 · ISC-66 · [P] · web — browser spec: no animation or transition runs under reduced motion (after: T28) · `web/src/app/shared/ui/motion.browser.spec.ts`

### ③ Core and API

- [x] T35 · ISC-6 · [P] · core — synthetic fixture spec trees with fixed dates: `.gates/`, `rounds.jsonl`, `tldr.md`, an archive, every warning class, a three-digit/three-digit master fraction; none copied from a real repository · `core/fixtures/`
- [ ] T32 · ISC-6 · [P] · core — `FORMAT.md`: the file contract as far as the dashboard reads it · `FORMAT.md`
- [ ] T33 · ISC-6 · [seam] · core — frontmatter and claim parser plus the core module skeleton: exported types and function signatures (stubs) for status, gates, stage, takeable, diagrams, tldr, markdown, archive and dashboard, so the fill-ins can be built in parallel (after: T32) · `core/src/`
- [ ] T34 · ISC-6 · [P] · core — status: claim partition and drift classes, ported from the old status tool (after: T33) · `core/src/status.ts`
- [ ] T36 · ISC-15 · [P] · core — review and code-review marks with in-memory worktree hashing, no git object writes; `generate.ts` in the fixtures switches to this import (after: T33) · `core/src/gates.ts`
- [ ] T37 · ISC-14 · [P] · core — stage derivation and next-command rules, ported from the old dashboard tool (after: T33) · `core/src/stage.ts`
- [ ] T38 · ISC-16 · [P] · core — takeable set, diagram verdict, TL;DR staleness, markdown renderer, archive listing (after: T33) · `core/src/{takeable,diagrams,tldr,markdown,archive}.ts`
- [ ] T39 · ISC-16 · [seam] · core — dashboard model assembly: the JSON the server returns and the web app renders (after: T34, T36, T37, T38) · `core/src/dashboard.ts`
- [ ] T40 · ISC-6 · [P] · core — golden snapshot test writing and checking `core/fixtures/<name>.golden.json` (after: T39) · `core/tests/fixtures.test.ts`
- [ ] T41 · ISC-14 · [P] · core — parity test over `SPECTANT_PARITY_TREES`, failing on zero comparisons (after: T39) · `core/tests/stage-parity.test.ts`
- [x] T45 · ISC-5 · [P] · server — `check:single-core`: fails on a frontmatter, claim or stage parser outside `core/` · `scripts/check-single-core.ts`
- [x] T46 · ISC-21 · [P] · server — data directory resolution with its tests · `server/src/paths.ts`
- [ ] T42 · ISC-13 · [P] · server — SQLite workspace registry with slug deduplication · `server/src/registry.ts`
- [ ] T43 · ISC-18.3 · [P] · server — settings table and the `/api/settings` GET + PUT handlers, with `tests/settings.test.ts` across a port change · `server/src/settings.ts`
- [ ] T44 · ISC-13 · [P] · server — CLI `add`, `list`, `remove` with `tests/workspaces.test.ts` (after: T42) · `server/src/cli.ts`
- [ ] T47 · ISC-16 · [P] · server — `/api/workspaces` and `/api/workspaces/:slug/dashboard` with ETag, plus the two-workspace `tests/dashboard.test.ts` (after: T39) · `server/src/api.ts`
- [ ] T48 · ISC-16 · [P] · server — local listeners for the live indicator, empty when `lsof` is missing · `server/src/services.ts`
- [ ] T49 · ISC-1 · [P] · server — loopback-only bind test · `tests/server.test.ts`
- [ ] T50 · ISC-20 · [P] · server — port 7717 with fallback, URL printed, browser opened unless `--no-browser`, plus the start-up cases in `tests/cli.test.ts` · `server/src/cli.ts`
- [ ] T51 · ISC-7 · [P] · server — rebuild test: delete the data directory, re-add, view equal (after: T39) · `tests/rebuild.test.ts`
- [ ] T52 · ISC-15 · [P] · server — read-only test: recursive hash of the fixture repo incl. `.git/` before and after add + browse; `test:readonly` (after: T39) · `tests/readonly.test.ts`
- [ ] T53 · ISC-2 · [P] · server — server-side offline run: the binary in `docker run --network none` through a scripted session; `test:offline:server` (after: T11) · `tests/offline-server.ts`
- [ ] T54 · ISC-3 · [P] · server — `check:leak`: generic classes plus an optional private word list outside the repo · `scripts/check-leak.ts`
- [ ] T55 · ISC-4 · [P] · repo — Apache-2.0 `LICENSE` and `THIRD_PARTY_NOTICES.md` · `LICENSE`
- [ ] T56 · ISC-5.2 · [P] · repo — `.github/workflows/ci.yml` running `bun run verify` in the pinned Playwright container with Node ≥ 22.22.3 · `.github/workflows/ci.yml`

### ④ Views

- [ ] T57 · ISC-17 · [P] · web — stub API serving the fixtures' golden JSON for e2e and visual runs (after: T28, T39) · `web/e2e/stub-api.ts`
- [ ] T58 · ISC-18.1 · [P] · web — pre-paint `data-theme` script, theme service (system / light / dark, live `matchMedia`), settings service · `web/src/app/core/theme.service.ts`
- [ ] T59 · ISC-16 · [seam] · web — shell with container tiers, routes `/`, `/w/:ws`, `/w/:ws/s/:id`, the redirect, query-state filters, the API client with ETag (after: T24, T25, T26, T27, T39, T58) · `web/src/app/layout/shell/`
- [ ] T60 · ISC-16 · [P] · web — header: eyebrow + title, `ui-badge-switcher` (two levels), palette trigger, `ui-live-indicator` (status, refresh, interval, services), gear with the settings popover, `?` (after: T59) · `web/src/app/layout/header/`
- [ ] T61 · ISC-17 · [P] · web — `kpi-band` in its three container forms, tiles as links (after: T59) · `web/src/app/features/dashboard/kpi-band/`
- [ ] T62 · ISC-17 · [P] · web — Brief disclosure (TL;DR markdown, stale chip, command chip) (after: T59) · `web/src/app/features/dashboard/brief/`
- [ ] T63 · ISC-61 · [P] · web — Specs panel: toolbar (phase / type filters, sort, phase strip), `spec-row` in normal, compact and dense forms, archive fold, roving list, plus e2e `keyboard.spec.ts` "move" (after: T59) · `web/src/app/features/dashboard/spec-table/`
- [ ] T64 · ISC-17 · [P] · web — `next-up-list`, `warnings-panel`, `context-rail` (rail at wide, cards below wide) (after: T59) · `web/src/app/features/dashboard/next-up-list/`
- [ ] T65 · ISC-16 · [P] · web — overview `/`: `workspace-column` with `kpi-strip`, dense list, auto-fit grid capped at three, empty and unreadable states (after: T59) · `web/src/app/features/overview/`
- [ ] T66 · ISC-60 · [P] · web — command palette: dialog, combobox, groups, ranking, actions; ⌘K / Ctrl+K / `/`, plus e2e `palette.spec.ts` "open" (after: T59) · `web/src/app/layout/command-palette/`
- [ ] T67 · ISC-61.2 · [P] · web — shortcut sheet and the keyboard service (`c`, `r`, `g` sequences, `1`–`3`, single-key switch), plus e2e `keyboard.spec.ts` "help" (after: T59) · `web/src/app/layout/shortcut-sheet/`
- [ ] T68 · ISC-62 · [P] · web — refresh service: ETag polling, refresh on visibility, in-place diff, changed-value tint, changed-row dot, "n new" pill, one polite announcement, plus e2e `refresh.spec.ts` "in-place" (after: T59) · `web/src/app/core/refresh.service.ts`
- [ ] T69 · ISC-61.1 · [P] · web — spec open: `spec-inspector` in the rail (wide), `ui-sheet` side (medium) and full-screen (compact), Esc returns focus, `[` `]`, plus e2e `keyboard.spec.ts` "enter" (after: T59) · `web/src/app/features/dashboard/spec-inspector/`
- [ ] T70 · ISC-60.1 · [P] · web — palette filtering plus e2e `palette.spec.ts` "filter" (after: T59) · `web/src/app/layout/command-palette/filter.ts`
- [ ] T71 · ISC-60.2 · [P] · web — palette Enter navigation plus e2e `palette.spec.ts` "enter" (after: T59) · `web/src/app/layout/command-palette/navigate.ts`
- [ ] T72 · ISC-62.1 · [P] · web — e2e `refresh.spec.ts` "cls": layout shift 0 during a refresh (after: T59) · `web/e2e/refresh.spec.ts`
- [ ] T73 · ISC-63 · [P] · web — narrow container behaviour of the dashboard at 600 px plus e2e `narrow.spec.ts` "dashboard" (after: T59) · `web/e2e/narrow.spec.ts`
- [ ] T74 · ISC-63.1 · [P] · web — e2e `narrow.spec.ts` "column": workspace column at 600 px (after: T59) · `web/e2e/narrow.spec.ts`
- [ ] T75 · ISC-18.1 · [P] · web — e2e `theme.spec.ts` "system": follows `emulateMedia` live (after: T59) · `web/e2e/theme.spec.ts`
- [ ] T76 · ISC-18.3 · [P] · web — e2e `theme.spec.ts` "persist": chosen mode survives reload on another port (after: T59) · `web/e2e/theme.spec.ts`
- [ ] T77 · ISC-2 · [P] · web — e2e `offline.spec.ts`: `route('**')` fails every non-loopback host across every route in both themes (after: T59) · `web/e2e/offline.spec.ts`
- [ ] T78 · ISC-19.1 · [P] · web — e2e `smoke.spec.ts` on the webkit project: `/` and `/w/:ws`, zero console errors (after: T59) · `web/e2e/smoke.spec.ts`
- [ ] T79 · ISC-17 · [P] · web — visual baseline: dashboard, light, three widths, committed under `web/e2e/__screenshots__/` (after: T59) · `web/e2e/visual.spec.ts`
- [ ] T80 · ISC-17.1 · [P] · web — visual baseline: dashboard, dark (after: T59) · `web/e2e/visual.spec.ts`
- [ ] T81 · ISC-16.1 · [P] · web — visual baseline: overview, light, three states (after: T59) · `web/e2e/visual.spec.ts`
- [ ] T82 · ISC-16.2 · [P] · web — visual baseline: overview, dark (after: T59) · `web/e2e/visual.spec.ts`
- [ ] T83 · ISC-19 · operator — cmux web view check with Interceptor, WebKit version recorded (after: T11, T78) · `tests/visual/cmux-check.md`

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
| T25, T26, T28, T57, T61, T62, T64, T79 | ISC-17 | `bun run test:visual -- dashboard` |
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
