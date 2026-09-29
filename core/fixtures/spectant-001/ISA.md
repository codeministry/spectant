---
task: "Spectant spec 001 frozen: app skeleton and dashboard, reduced master with F0 and F1 only"
slug: spectant
project: spectant
phase: scoping
progress: 14/47
started: 2026-09-28T08:50:25Z
updated: 2026-09-28T22:08:00Z
---

# Spectant — the master ISA

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | server socket address | 127.0.0.1 or ::1 only | `bun test tests/server.test.ts -t "loopback"` | derived: local-only | high |
| ISC-2 | e2e | no request leaves loopback across a scripted session | 0 blocked requests | `bun run e2e -- offline` (Playwright `context.route('**')` fails every non-loopback host, every route, both themes) plus `bun run test:offline:server` (binary in `docker run --network none`) | derived: local-only | high |
| ISC-3 | bash | leak classes in tracked files | 0 hits | `bun run check:leak` | derived: public-oss | high |
| ISC-4 | bash | license and notices present | both | `test -f LICENSE && rg -q 'Apache License' LICENSE && test -f THIRD_PARTY_NOTICES.md` | derived: public-oss | |
| ISC-5 | bash | one parser implementation | 0 duplicates | `bun run check:single-core` | derived: one-contract | |
| ISC-6 | bun-test | fixture corpus against golden snapshots | all green | `bun test core/` | derived: one-contract | |
| ISC-7 | bun-test | view rebuilt after data dir loss | snapshot equal | `bun test tests/rebuild.test.ts` | derived: files-are-truth | |
| ISC-8 | bash | release build targets | exactly 4 | `bun run build && test $(ls dist/spectant-{darwin,linux}-{arm64,x64} \| wc -l) -eq 4` | literal | |
| ISC-9 | bash | host binary version | equals package.json | `bun run check:version` | literal | |
| ISC-10 | bash | install in a clean Ubuntu container | exit 0 | `bun run test:install:linux` (docker, local release dir) | literal | high |
| ISC-11 | manual | install on a clean macOS arm64 user | `spectant --version` exits 0 | transcript with a fresh `HOME` | literal | high |
| ISC-12 | bash | INSTALL_DIR honoured | binary at target | `bun run test:install:linux -- INSTALL_DIR=/opt/x/bin` | literal | |
| ISC-13 | bun-test | add, list, remove a workspace | round-trip | `bun test tests/workspaces.test.ts` | literal | |
| ISC-14 | bun-test | stage per spec equals the old derivation; fails on zero comparisons | all equal, count > 0 | `bun test core/tests/stage-parity.test.ts` (reads `SPECTANT_PARITY_TREES`) | literal | |
| ISC-15 | bash | registered repo byte-identical after add + browse, `.git/` included | checksum equal | `bun run test:readonly` (recursive hash of the fixture repo before and after) | derived: files-are-truth | high |
| ISC-16 | bun-test | two workspaces on one dashboard | both listed | `bun test tests/dashboard.test.ts -t "multi-workspace"` | literal | |
| ISC-17 | bash | dashboard visual baseline, light, 390/820/1440 | green on Linux CI with pinned Chromium | `bun run test:visual -- dashboard` (Playwright `toHaveScreenshot` against `web/e2e/__screenshots__/`) | derived: no-drift | |
| ISC-17.1 | bash | dashboard visual baseline, dark | green | `bun run test:visual -- dashboard --theme dark` | derived: no-drift | |
| ISC-18 | bun-test | theme tokens round-trip to the old pages' hex within ΔE 0.5 | all within | `bun test web/tests/theme-colors.test.ts` (pure TS, parses `styles.css`) | literal | |
| ISC-18.2 | bun-test | icon names used vs the old pinned Lucide set | 0 foreign | `bun test web/tests/icons.test.ts` | literal | |
| ISC-18.1 | e2e | system mode follows prefers-color-scheme, live | 2 cases | `bun run e2e -- theme -g system` (`emulateMedia`) | literal | |
| ISC-19 | manual | dashboard in the cmux web view | renders, navigates | Interceptor/cmux screenshot | literal | high |
| ISC-20 | bun-test | start-up: port, fallback, --no-browser, URL printed | 4 cases | `bun test tests/cli.test.ts -t "start"` | literal | |
| ISC-21 | bun-test | data dir resolution | 2 cases | `bun test tests/cli.test.ts -t "data dir"` | derived: local-only | |
| ISC-22 | bun-test | EN/DE catalogue parity, formal German | 0 missing keys, 0 informal forms | `bun test web/tests/i18n-parity.test.ts` | derived: no-translation | |
| ISC-60 | e2e | palette opens, lists workspaces and specs | all listed | `bun run e2e -- palette -g open` | derived: developer-tool | |
| ISC-60.1 | e2e | palette filters | only matches | `bun run e2e -- palette -g filter` | derived: developer-tool | |
| ISC-60.2 | e2e | Enter navigates | URL changed | `bun run e2e -- palette -g enter` | derived: developer-tool | |
| ISC-61 | e2e | arrows and j/k move selection | selection follows | `bun run e2e -- keyboard -g move` | derived: developer-tool | |
| ISC-61.1 | e2e | Enter opens the selected spec | URL changed | `bun run e2e -- keyboard -g enter` | derived: developer-tool | |
| ISC-61.2 | e2e | `?` opens the shortcut sheet | dialog visible | `bun run e2e -- keyboard -g help` | derived: developer-tool | |
| ISC-62 | e2e | value updated in place, no navigation | 0 navigations | `bun run e2e -- refresh -g in-place` | derived: live-first | |
| ISC-62.1 | e2e | layout shift during refresh | CLS 0 | `bun run e2e -- refresh -g cls` | derived: live-first | |
| ISC-63 | e2e | dashboard at 600 px: no horizontal overflow | scrollWidth == clientWidth | `bun run e2e -- narrow -g dashboard` | derived: cmux-panel | |
| ISC-63.1 | e2e | workspace column at 600 px: no horizontal overflow | scrollWidth == clientWidth | `bun run e2e -- narrow -g column` | derived: cmux-panel | |
| ISC-64 | browser | focus ring on every interactive element, both themes | all | `bun run test:browser -- focus` | derived: design-standard | |
| ISC-65 | browser | contrast: text 4.5:1, marks 3:1, both themes | all | `bun run test:browser -- contrast` | derived: design-standard | |
| ISC-66 | browser | reduced motion: no animation or transition runs | 0 | `bun run test:browser -- motion` | derived: design-standard | |
| ISC-67 | bun-test | two font files present as local assets | 2 faces | `bun test web/tests/fonts.test.ts -t "local"` | derived: local-only | |
| ISC-67.1 | bun-test | external font URL in any stylesheet | 0 | `bun test web/tests/fonts.test.ts -t "external"` | derived: local-only | |
| ISC-5.1 | bash | lane working notes present | 4 files | `test -f CLAUDE.md -a -f core/CLAUDE.md -a -f server/CLAUDE.md -a -f web/CLAUDE.md` | derived: lanes | |
| ISC-5.2 | bash | static tier runs lint, stylelint and tsc at zero warnings | exit 0 | `bun run check:static` | derived: ladder | |
| ISC-8.1 | bash | compiled host binary serves the embedded app from an empty directory | 200 html · 200 js · SPA fallback | `bun run test:binary` (copies the binary to a temp dir, `--no-browser --port 0`, curls `/`, one `main-*.js`, `/w/x`) | literal | high |
| ISC-16.1 | bash | overview visual baseline, light, incl. empty and unreadable states | green | `bun run test:visual -- overview` | derived: no-drift | |
| ISC-16.2 | bash | overview visual baseline, dark | green | `bun run test:visual -- overview --theme dark` | derived: no-drift | |
| ISC-18.3 | e2e | chosen mode survives reload and port change | 2 cases | `bun run e2e -- theme -g persist` (settings from `/api/settings`) | literal | |
| ISC-19.1 | e2e | WebKit smoke: both routes render, zero console errors | 0 errors | `bun run e2e -- --project webkit smoke` | derived: cmux-panel | |

## Features

### F0 · Cross-cutting
Why: what would sink the project whichever slice slipped — data leaving the machine, a private detail going public, the app and the skill disagreeing about the format, or the database quietly becoming a second truth.

- [ ] ISC-1: Anti: the app's HTTP server listens on any address other than 127.0.0.1 or ::1.
- [ ] ISC-2: Anti: with no AI feature switched on, starting the app, adding a workspace, browsing every page and performing every write makes an outbound network request.
- [ ] ISC-3: Anti: a tracked file contains a customer name, an absolute home path or personal data (generic leak classes plus a private word list kept outside the repo).
- [ ] ISC-4: The repository root holds the Apache-2.0 `LICENSE` and a `THIRD_PARTY_NOTICES.md` naming the bundled assets and the LifeOS (MIT) origin of the ISA format.
- [x] ISC-5: Anti: the repository holds more than one implementation of frontmatter, claim or stage parsing; the app and the plugin both import `core/`.
- [ ] ISC-6: Every fixture under `core/fixtures/` parses without error to its golden JSON snapshot.
- [ ] ISC-7: Deleting the data directory loses only the workspace registry, notes and pins; after re-adding a workspace its specs view equals the view before deletion.
- [x] ISC-5.1: A `CLAUDE.md` exists at the root plus in `core/`, `server/`, `web/`, each lane file naming its probe (root: only what applies everywhere).
- [x] ISC-5.2: `bun run check:static` runs ESLint with the Angular rules, Stylelint with `color-no-hex` and `tsc --noEmit`, all at zero warnings.

### F1 · App skeleton and dashboard
Why: the first time the author types `spectant` and sees two real repositories on one page in the look they know — the smallest thing that already replaces a per-repo HTML file.

- [x] ISC-8: `bun run build` produces four binaries: darwin-arm64, darwin-x64, linux-arm64, linux-x64.
- [x] ISC-8.1: The compiled host binary, copied to an empty directory, passes the embedded-app smoke (`/` → HTML, hashed `main-*.js` → JavaScript, `/w/x` → `index.html`). (after: ISC-8)
- [x] ISC-9: The host binary's `--version` prints the version in `package.json`. (after: ISC-8)
- [x] ISC-10: In a clean Ubuntu x64 container, the install script pointed at a local release directory puts `spectant` on PATH and `spectant --version` exits 0. (after: ISC-8)
- [ ] ISC-11: For a fresh user on macOS arm64, the install one-liner puts `spectant` on PATH and `spectant --version` exits 0. (after: ISC-8)
- [x] ISC-12: The install script writes the binary to `INSTALL_DIR` when that variable is set. (after: ISC-10)
- [ ] ISC-13: `spectant add <repo>`, `spectant list` and `spectant remove <repo>` round-trip a workspace through the registry.
- [ ] ISC-14: For copies of the principal's real spec trees, every spec's stage on the dashboard equals the stage the old skill derives, and the probe fails when no tree was compared.
- [ ] ISC-15: Anti: adding a workspace or opening any page changes a byte inside the registered repository, `.git/` included.
- [ ] ISC-16: One dashboard lists the specs of two registered workspaces side by side.
- [ ] ISC-16.1: The overview's committed visual baseline (light, three widths, states: two workspaces, empty, unreadable workspace) passes on Linux CI.
- [ ] ISC-16.2: The same baseline passes in the dark theme.
- [ ] ISC-17: The dashboard's committed visual baseline (Playwright `toHaveScreenshot`, light theme, 390/820/1440) passes on Linux CI with pinned Chromium.
- [ ] ISC-17.1: The same baseline passes in the dark theme.
- [x] ISC-18: Antecedent: the daisyUI themes `spec-light` and `spec-dark` carry the old pages' light and dark colour values as their tokens, so the look is inherited rather than re-invented.
- [x] ISC-18.2: Antecedent: every icon the app renders comes from the old pages' pinned Lucide set.
- [ ] ISC-18.1: In the default system mode the theme follows `prefers-color-scheme`, also when it changes while the page is open.
- [ ] ISC-18.3: A chosen light or dark mode, stored server-side, is still applied after a reload on a different port.
- [ ] ISC-19: The dashboard renders and navigates inside the cmux web view.
- [ ] ISC-19.1: Playwright's WebKit project renders `/` and `/w/:ws` with zero console errors.
- [ ] ISC-20: `spectant` without arguments listens on 7717 or the next free port, prints the URL, and opens the browser unless `--no-browser` is given.
- [x] ISC-21: The data directory is `$XDG_DATA_HOME/spectant` when that variable is set and `~/.spectant/` otherwise.
- [x] ISC-22: Every UI string key exists in both the English and the German catalogue.
- [ ] ISC-60: ⌘K / Ctrl+K opens a command palette listing every workspace plus every spec.
- [ ] ISC-60.1: Typing in the palette narrows the list to matching entries. (after: ISC-60)
- [ ] ISC-60.2: Enter in the palette navigates to the highlighted entry. (after: ISC-60)
- [ ] ISC-61: In a spec list, ↓/↑ (also j/k) move the selection.
- [ ] ISC-61.1: Enter opens the selected spec. (after: ISC-61)
- [ ] ISC-61.2: `?` opens the shortcut sheet.
- [ ] ISC-62: After the auto-refresh timer fires with a changed number on disk, the DOM node holding that number shows the new value with no navigation event.
- [ ] ISC-62.1: The same refresh produces a cumulative layout shift of 0. (after: ISC-62)
- [ ] ISC-63: At a 600 px wide container (the cmux side panel) the dashboard has no horizontal overflow: `scrollWidth` equals `clientWidth`.
- [ ] ISC-63.1: At the same width a workspace column in the overview has no horizontal overflow.
- [ ] ISC-64: Every interactive element shows the brand focus ring under keyboard focus, in both themes.
- [ ] ISC-65: Text reaches 4.5:1 and marks (ring track, bars, legend dots) 3:1 against their surface, in both themes.
- [ ] ISC-66: Anti: under `prefers-reduced-motion: reduce` any animation or transition longer than 0 ms runs.
- [x] ISC-67: Antecedent: the app ships Inter Variable plus JetBrains Mono as local assets.
- [x] ISC-67.1: Anti: a stylesheet declares a font URL outside the app's own origin.
