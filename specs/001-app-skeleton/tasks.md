---
spec: 001-app-skeleton
plan: plan.md
updated: 2026-09-28T10:39:35Z
---

# Tasks 001 — App skeleton and dashboard

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

### ① Skeleton

- [x] T1 · ISC-8 · [P] · repo — root `package.json` with bun workspaces `core`, `server`, `web`, pinned bun, the script names from the plan, `bunfig.toml` excluding `web/src` from root `bun test` · `package.json`
- [x] T2 · ISC-5.1 · [P] · repo — root `CLAUDE.md` (only what applies everywhere) and the `README.md` skeleton · `CLAUDE.md`
- [x] T3 · ISC-5.1 · [P] · core — `core/CLAUDE.md`: lane probe, the one-parser rule, fixture conventions · `core/CLAUDE.md`
- [x] T4 · ISC-5.1 · [P] · server — `server/CLAUDE.md`: lane probe, loopback rule, no writes into repos · `server/CLAUDE.md`
- [x] T5 · ISC-5.1 · [P] · web — `web/CLAUDE.md`: lane probe, house FRONTEND/DESIGN pointers, container tiers, token rules · `web/CLAUDE.md`
- [ ] T6 · ISC-8 · [seam] · server — build contract: the web output folder, base href, the embed manifest type and content-type map the server reads (after: T1) · `server/src/assets.contract.ts`
- [ ] T7 · ISC-8 · web — Angular 22 zoneless standalone workspace with one hello route, Vitest builder, output where T6 says (after: T6) · `web/`
- [ ] T8 · ISC-5.2 · web — ESLint (Angular rules, template a11y), Stylelint (`color-no-hex`, no literal durations outside `motion.css`), `check:static` wired (after: T7) · `eslint.config.js`
- [ ] T9 · ISC-8 · server — embed generator writing `server/embedded.gen.ts` from the web output (after: T6, T7) · `scripts/embed.ts`
- [ ] T10 · ISC-8 · server — minimal server on loopback: embedded assets, content types, SPA fallback, a CLI entry that serves (after: T6, T9) · `server/src/http.ts`
- [ ] T11 · ISC-8 · server — build script: Angular build, embed, compile the four targets (`-baseline` for linux-x64, `codesign -s -` on macOS) (after: T6, T10) · `scripts/build.ts`
- [ ] T12 · ISC-8.1 · server — binary smoke: copy the host binary to an empty temp dir, `--no-browser --port 0`, three routes; `test:binary` (after: T11) · `tests/binary.test.ts`
- [ ] T13 · ISC-9 · server — version inlined at build (`--define`), `--version`, `check:version` (after: T11) · `server/src/cli.ts`
- [ ] T14 · ISC-10 · server — `install.sh`: OS/arch detection, `SPECTANT_RELEASE_URL`, `/usr/local/bin` when writable else `~/.local/bin`, PATH hint, never edits an rc file (after: T11) · `install.sh`
- [ ] T15 · ISC-10 · server — clean Ubuntu x64 container as a non-root user, local release directory served from the host, runs the binary smoke after install; `test:install:linux` (after: T14) · `tests/install/`
- [ ] T16 · ISC-12 · server — `INSTALL_DIR` override plus the "`/usr/local/bin` not writable → `~/.local/bin`" case in the container (after: T15) · `install.sh`
- [ ] T17 · ISC-11 · operator — macOS arm64 install on a throwaway user account, transcript into `.evidence/` (after: T14) · `tests/install/run-macos.md`

### ② Design system and baseline

- [ ] T18 · ISC-18 · web — themes `spec-light` / `spec-dark` from the old token blocks (OKLCH, hex in comments), daisyUI `themes: false`, `--depth: 0`, `--noise: 0`; inherited tokens only (after: T7) · `web/src/styles.css`
- [ ] T19 · ISC-65 · web — derived tokens `--muted`, `--track`, `--*-ink` in `tokens.css`, container tier names (after: T18) · `web/src/styles/tokens.css`
- [ ] T20 · ISC-18 · web — colour guard: every inherited token round-trips to its hex comment within ΔE 0.5, in both themes (after: T18) · `web/tests/theme-colors.test.ts`
- [ ] T21 · ISC-67 · web — Inter Variable and JetBrains Mono as local woff2 with `@font-face` (after: T7) · `web/public/fonts/`
- [ ] T22 · ISC-67 · web — fonts guard: two local faces present (after: T21) · `web/tests/fonts.test.ts`
- [ ] T23 · ISC-67.1 · web — fonts guard: no external font URL in any stylesheet (after: T21) · `web/tests/fonts.test.ts`
- [ ] T24 · ISC-66 · web — motion tokens and the `prefers-reduced-motion` override to `0ms`, skeleton static, view transitions skipped (after: T7) · `web/src/styles/motion.css`
- [ ] T25 · ISC-18.2 · web — icon module: only used icons from the pinned `lucide-static` version, plus the guard test (after: T7) · `web/src/app/shared/icons/`
- [ ] T26 · ISC-22 · web — Transloco with EN and DE catalogues (German formal), language from settings, plus the parity guard (after: T7) · `web/src/i18n/`
- [ ] T27 · ISC-64 · web — `ui-button`, `ui-icon-button`, `ui-button-group` with the global `:focus-visible` ring and the coarse-pointer hit area (after: T19) · `web/src/app/shared/ui/button/`
- [ ] T28 · ISC-17 · web — `ui-card`, `ui-kpi-tile`, `ui-ring`, `ui-meter`, `ui-stage-track`, `ui-chip`, `ui-id-chip`, `ui-filter-chips`, `ui-segmented`, `ui-section-header`, `ui-kbd`, `ui-skeleton`, `ui-empty-state`, `ui-notice` (after: T27) · `web/src/app/shared/ui/`
- [ ] T29 · ISC-17 · web — `ui-popover` (anchor positioning with the `@supports` fallback), `ui-sheet`, `ui-dialog`, `ui-disclosure` (`grid-template-rows` animation) (after: T27) · `web/src/app/shared/ui/overlay/`
- [ ] T30 · ISC-61 · web — `uiRovingList` directive (arrows, j/k, Home/End, no wrap) (after: T27) · `web/src/app/shared/ui/roving-list.directive.ts`
- [ ] T31 · ISC-17 · [seam] · web — Playwright config: chromium + webkit projects, the pinned Linux container runner for `test:visual`, `e2e`, `test:browser`; clock pinned, animations disabled, `data-ready` awaited (after: T7) · `web/e2e/playwright.config.ts`
- [ ] T32 · ISC-64 · web — browser spec: focus ring on every interactive element, both themes (after: T28, T29, T31) · `web/src/app/shared/ui/focus.browser.spec.ts`
- [ ] T33 · ISC-65 · web — browser spec: contrast of text and marks, both themes (after: T19, T28, T31) · `web/src/app/shared/ui/contrast.browser.spec.ts`
- [ ] T34 · ISC-66 · web — browser spec: no animation or transition runs under reduced motion (after: T24, T29, T31) · `web/src/app/shared/ui/motion.browser.spec.ts`

### ③ Core and API

- [x] T35 · ISC-6 · [P] · core — synthetic fixture spec trees with fixed dates: `.gates/`, `rounds.jsonl`, `tldr.md`, an archive, every warning class, a three-digit/three-digit master fraction; none copied from a real repository · `core/fixtures/`
- [ ] T36 · ISC-6 · core — `FORMAT.md`: the file contract as far as the dashboard reads it (after: T35) · `FORMAT.md`
- [ ] T37 · ISC-6 · core — frontmatter and claim parser (after: T36) · `core/src/frontmatter.ts`
- [ ] T38 · ISC-6 · core — claim partition and drift classes, ported from the old status tool (after: T37) · `core/src/status.ts`
- [ ] T39 · ISC-15 · core — review and code-review marks with **in-memory** worktree hashing, no git object writes (after: T37) · `core/src/gates.ts`
- [ ] T40 · ISC-14 · core — stage derivation and next-command rules, ported from the old dashboard tool (after: T38, T39) · `core/src/stage.ts`
- [ ] T41 · ISC-16 · core — takeable set, diagram verdict, TL;DR staleness, markdown renderer, archive listing (after: T38) · `core/src/{takeable,diagrams,tldr,markdown,archive}.ts`
- [ ] T42 · ISC-6 · core — golden snapshot test over every fixture (after: T40, T41) · `core/tests/fixtures.test.ts`
- [ ] T43 · ISC-14 · core — parity test over `SPECTANT_PARITY_TREES`, failing on zero comparisons (after: T40) · `core/tests/stage-parity.test.ts`
- [ ] T44 · ISC-16 · [seam] · core — dashboard model type: the JSON the server returns and the web app renders, assembled from T37–T41 (after: T40, T41) · `core/src/dashboard.ts`
- [x] T45 · ISC-5 · [P] · server — `check:single-core`: fails on a frontmatter, claim or stage parser outside `core/` · `scripts/check-single-core.ts`
- [x] T46 · ISC-21 · [P] · server — data directory resolution · `server/src/paths.ts`
- [ ] T47 · ISC-13 · server — SQLite workspace registry with slug deduplication (after: T46) · `server/src/registry.ts`
- [ ] T48 · ISC-18.3 · server — settings table and `/api/settings` GET + PUT (after: T47) · `server/src/settings.ts`
- [ ] T49 · ISC-13 · server — CLI `add`, `list`, `remove` (after: T13, T47) · `server/src/cli.ts`
- [ ] T50 · ISC-16 · server — `/api/workspaces` and `/api/workspaces/:slug/dashboard` with ETag (after: T10, T44, T47) · `server/src/api.ts`
- [ ] T51 · ISC-16 · server — local listeners for the live indicator, empty when `lsof` is missing (after: T44) · `server/src/services.ts`
- [ ] T52 · ISC-16 · server — two-workspace dashboard test (after: T50) · `tests/dashboard.test.ts`
- [ ] T53 · ISC-1 · server — loopback-only bind test (after: T10) · `tests/server.test.ts`
- [ ] T54 · ISC-20 · server — port 7717 with fallback, URL printed, browser opened unless `--no-browser` (after: T49) · `server/src/open-browser.ts`
- [ ] T55 · ISC-20 · server — start-up tests (after: T54) · `tests/cli.test.ts`
- [ ] T56 · ISC-21 · server — data directory tests (after: T46, T55) · `tests/cli.test.ts`
- [ ] T57 · ISC-13 · server — registry round-trip tests (after: T49) · `tests/workspaces.test.ts`
- [ ] T58 · ISC-18.3 · server — settings persistence test across a port change (after: T48) · `tests/settings.test.ts`
- [ ] T59 · ISC-7 · server — rebuild test: delete the data directory, re-add, view equal (after: T50) · `tests/rebuild.test.ts`
- [ ] T60 · ISC-15 · server — read-only test: recursive hash of the fixture repo incl. `.git/` before and after add + browse; `test:readonly` (after: T50) · `tests/readonly.test.ts`
- [ ] T61 · ISC-2 · server — server-side offline run: the binary in `docker run --network none` through a scripted session; `test:offline:server` (after: T12, T50) · `tests/offline-server.ts`
- [ ] T62 · ISC-3 · [P] · server — `check:leak`: generic classes plus an optional private word list outside the repo · `scripts/check-leak.ts`
- [ ] T63 · ISC-4 · [P] · repo — Apache-2.0 `LICENSE` and `THIRD_PARTY_NOTICES.md` · `LICENSE`
- [ ] T64 · ISC-5.2 · [P] · repo — `.github/workflows/ci.yml` running `bun run verify` in the pinned Playwright container · `.github/workflows/ci.yml`

### ④ Views

- [ ] T65 · ISC-17 · web — stub API serving the fixtures' golden JSON for e2e and visual runs (after: T31, T44) · `web/e2e/stub-api.ts`
- [ ] T66 · ISC-18.1 · web — pre-paint `data-theme` script, theme service (system / light / dark, live `matchMedia`), settings service (after: T18, T29) · `web/src/app/core/theme.service.ts`
- [ ] T67 · ISC-16 · web — shell with container tiers, routes `/`, `/w/:ws`, `/w/:ws/s/:id`, the redirect, query-state filters (after: T28, T29, T44) · `web/src/app/layout/shell/`
- [ ] T68 · ISC-16 · web — header: eyebrow + title, `ui-badge-switcher` (two levels), palette trigger, `ui-live-indicator` (status, refresh, interval, services), gear, `?` · all viewports (after: T29, T51, T66, T67) · `web/src/app/layout/header/`
- [ ] T69 · ISC-17 · web — `kpi-band` in its three container forms, tiles as links · all viewports (after: T28, T67) · `web/src/app/features/dashboard/kpi-band/`
- [ ] T70 · ISC-17 · web — Brief disclosure (TL;DR markdown, stale chip, command chip) (after: T28, T29, T67) · `web/src/app/features/dashboard/brief/`
- [ ] T71 · ISC-61 · web — Specs panel: toolbar (phase / type filters, sort, phase strip), `spec-row` in normal, compact and dense forms, archive fold, roving list (after: T28, T30, T67) · `web/src/app/features/dashboard/spec-table/`
- [ ] T72 · ISC-17 · web — `next-up-list` and `warnings-panel`, rail at wide / cards below wide (after: T28, T67) · `web/src/app/features/dashboard/next-up-list/`
- [ ] T73 · ISC-61.1 · web — spec open: `spec-inspector` in the rail (wide), `ui-sheet` side (medium) and full-screen (compact), Esc returns focus, `[` `]` (after: T29, T71, T72) · `web/src/app/features/dashboard/spec-inspector/`
- [ ] T74 · ISC-16 · web — overview `/`: `workspace-column` with `kpi-strip`, dense list, auto-fit grid capped at three, empty and unreadable states · all viewports (after: T28, T67) · `web/src/app/features/overview/`
- [ ] T75 · ISC-60 · web — command palette: dialog, combobox, groups, ranking, actions; ⌘K / Ctrl+K / `/` (after: T29, T67, T74) · `web/src/app/layout/command-palette/`
- [ ] T76 · ISC-61.2 · web — shortcut sheet and the keyboard service (`c`, `r`, `g` sequences, `1`–`3`, single-key switch) (after: T29, T71, T75) · `web/src/app/layout/shortcut-sheet/`
- [ ] T77 · ISC-62 · web — refresh service: ETag polling, refresh on visibility, in-place diff, changed-value tint, changed-row dot, "n new" pill, one polite announcement (after: T69, T71, T72) · `web/src/app/core/refresh.service.ts`
- [ ] T78 · ISC-63 · web — narrow container behaviour of the dashboard at 600 px (after: T69, T71, T72) · `web/src/app/layout/shell/`
- [ ] T79 · ISC-18.1 · web — e2e theme: system mode follows `emulateMedia` live (after: T31, T65, T66, T68) · `web/e2e/theme.spec.ts`
- [ ] T80 · ISC-18.3 · web — e2e theme: chosen mode survives reload on another port (after: T48, T79) · `web/e2e/theme.spec.ts`
- [ ] T81 · ISC-60 · web — e2e palette: opens and lists workspaces plus specs (after: T65, T75) · `web/e2e/palette.spec.ts`
- [ ] T82 · ISC-60.1 · web — e2e palette: typing narrows the list (after: T81) · `web/e2e/palette.spec.ts`
- [ ] T83 · ISC-60.2 · web — e2e palette: Enter navigates (after: T81) · `web/e2e/palette.spec.ts`
- [ ] T84 · ISC-61 · web — e2e keyboard: arrows and j/k move the selection (after: T65, T71, T76) · `web/e2e/keyboard.spec.ts`
- [ ] T85 · ISC-61.1 · web — e2e keyboard: Enter opens the spec (after: T73, T84) · `web/e2e/keyboard.spec.ts`
- [ ] T86 · ISC-61.2 · web — e2e keyboard: `?` opens the shortcut sheet (after: T76, T84) · `web/e2e/keyboard.spec.ts`
- [ ] T87 · ISC-62 · web — e2e refresh: value updated in place, no navigation (after: T65, T77) · `web/e2e/refresh.spec.ts`
- [ ] T88 · ISC-62.1 · web — e2e refresh: CLS 0 (after: T87) · `web/e2e/refresh.spec.ts`
- [ ] T89 · ISC-63 · web — e2e narrow: dashboard at 600 px, no horizontal overflow (after: T65, T78) · `web/e2e/narrow.spec.ts`
- [ ] T90 · ISC-63.1 · web — e2e narrow: workspace column at 600 px, no horizontal overflow (after: T74, T89) · `web/e2e/narrow.spec.ts`
- [ ] T91 · ISC-2 · web — e2e offline: `route('**')` fails every non-loopback host across every route in both themes (after: T65, T75, T77) · `web/e2e/offline.spec.ts`
- [ ] T92 · ISC-19.1 · web — e2e smoke on the webkit project: `/` and `/w/:ws`, zero console errors (after: T65, T74) · `web/e2e/smoke.spec.ts`
- [ ] T93 · ISC-17 · web — visual baseline: dashboard, light, three widths, committed (after: T65, T69, T70, T71, T72) · `web/e2e/visual.spec.ts`
- [ ] T94 · ISC-17.1 · web — visual baseline: dashboard, dark (after: T93) · `web/e2e/visual.spec.ts`
- [ ] T95 · ISC-16.1 · web — visual baseline: overview, light, three states (after: T65, T74) · `web/e2e/visual.spec.ts`
- [ ] T96 · ISC-16.2 · web — visual baseline: overview, dark (after: T95) · `web/e2e/visual.spec.ts`
- [ ] T97 · ISC-19 · operator — cmux web view check with Interceptor, WebKit version recorded (after: T11, T92) · `tests/visual/cmux-check.md`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1, T6, T7, T9–T11 | ISC-8 | `bun run build && test $(ls dist/spectant-{darwin,linux}-{arm64,x64} \| wc -l) -eq 4` |
| T2–T5 | ISC-5.1 | `test -f CLAUDE.md -a -f core/CLAUDE.md -a -f server/CLAUDE.md -a -f web/CLAUDE.md` |
| T8, T64 | ISC-5.2 | `bun run check:static` |
| T12 | ISC-8.1 | `bun run test:binary` |
| T13 | ISC-9 | `bun run check:version` |
| T14, T15 | ISC-10 | `bun run test:install:linux` |
| T16 | ISC-12 | `bun run test:install:linux -- INSTALL_DIR=/opt/x/bin` |
| T17 | ISC-11 | transcript with a throwaway user account (manual) |
| T18, T20 | ISC-18 | `bun test web/tests/theme-colors.test.ts` |
| T19, T33 | ISC-65 | `bun run test:browser -- contrast` |
| T21, T22 | ISC-67 | `bun test web/tests/fonts.test.ts -t "local"` |
| T23 | ISC-67.1 | `bun test web/tests/fonts.test.ts -t "external"` |
| T24, T34 | ISC-66 | `bun run test:browser -- motion` |
| T25 | ISC-18.2 | `bun test web/tests/icons.test.ts` |
| T26 | ISC-22 | `bun test web/tests/i18n-parity.test.ts` |
| T27, T32 | ISC-64 | `bun run test:browser -- focus` |
| T28, T29, T31, T65, T69, T70, T72, T93 | ISC-17 | `bun run test:visual -- dashboard` |
| T94 | ISC-17.1 | `bun run test:visual -- dashboard --theme dark` |
| T30, T71, T84 | ISC-61 | `bun run e2e -- keyboard -g move` |
| T35–T38, T42 | ISC-6 | `bun test core/` |
| T39, T60 | ISC-15 | `bun run test:readonly` |
| T40, T43 | ISC-14 | `bun test core/tests/stage-parity.test.ts` |
| T41, T44, T50–T52, T67, T68, T74 | ISC-16 | `bun test tests/dashboard.test.ts -t "multi-workspace"` |
| T45 | ISC-5 | `bun run check:single-core` |
| T46, T56 | ISC-21 | `bun test tests/cli.test.ts -t "data dir"` |
| T47, T49, T57 | ISC-13 | `bun test tests/workspaces.test.ts` |
| T48, T58, T80 | ISC-18.3 | `bun run e2e -- theme -g persist` |
| T53 | ISC-1 | `bun test tests/server.test.ts -t "loopback"` |
| T54, T55 | ISC-20 | `bun test tests/cli.test.ts -t "start"` |
| T59 | ISC-7 | `bun test tests/rebuild.test.ts` |
| T61, T91 | ISC-2 | `bun run e2e -- offline` plus `bun run test:offline:server` |
| T62 | ISC-3 | `bun run check:leak` |
| T63 | ISC-4 | `test -f LICENSE && rg -q 'Apache License' LICENSE && test -f THIRD_PARTY_NOTICES.md` |
| T66, T79 | ISC-18.1 | `bun run e2e -- theme -g system` |
| T73, T85 | ISC-61.1 | `bun run e2e -- keyboard -g enter` |
| T75, T81 | ISC-60 | `bun run e2e -- palette -g open` |
| T82 | ISC-60.1 | `bun run e2e -- palette -g filter` |
| T83 | ISC-60.2 | `bun run e2e -- palette -g enter` |
| T76, T86 | ISC-61.2 | `bun run e2e -- keyboard -g help` |
| T77, T87 | ISC-62 | `bun run e2e -- refresh -g in-place` |
| T88 | ISC-62.1 | `bun run e2e -- refresh -g cls` |
| T78, T89 | ISC-63 | `bun run e2e -- narrow -g dashboard` |
| T90 | ISC-63.1 | `bun run e2e -- narrow -g column` |
| T92 | ISC-19.1 | `bun run e2e -- --project webkit smoke` |
| T95 | ISC-16.1 | `bun run test:visual -- overview` |
| T96 | ISC-16.2 | `bun run test:visual -- overview --theme dark` |
| T97 | ISC-19 | Interceptor / cmux screenshot (manual) |
