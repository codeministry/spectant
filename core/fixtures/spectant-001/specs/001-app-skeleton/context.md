---
spec: 001-app-skeleton
created: 2026-09-28T09:40:00Z
updated: 2026-09-28T12:45:00Z
rounds: 4
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 001 — App skeleton and dashboard

## Goal — confirmed 2026-09-28T09:40:00Z
A fresh macOS or Linux user installs spectant with one line, registers two workspaces and sees their specs side by side on a read-only dashboard that looks like the old Spec dashboard in its light and its dark theme, with nothing leaving the machine and nothing written into either repository.

Principal's words, verbatim: see `principal_stated_goal` in the master `ISA.md` (untracked; German, kept out of the public tree by the constitution).

## Round 0 — shaping the idea, 2026-09-28T07:30:00Z
- Shapes offered: cut the skill first inside another repository (narrow) | companion app plus skill cut (obvious, recommended) | companion as an MCP service (different). Chosen: companion app plus skill cut.

### Q1 · Where does the app live?
- Offered: own repository, the other plugin project slims down (recommended) | everything in the plugin repository | own repository, the other project paused
- Chosen: own repository (later refined: the skill moves here too, the other project is abandoned)
- Landed in: master § Constraints, Decisions

### Q2 · Which stack does the app run on?
- Offered: Bun + TypeScript single binary (recommended) | Go like radar | Spring Boot + Angular
- Chosen: Bun + TypeScript single binary
- Landed in: master § Constraints; ISC-8, ISC-9

### Q3 · What may the app write into repositories?
- Offered: reads Markdown, writes only its database (recommended) | light writes too | the app drives the skill
- Chosen: light writes too (review mark, task checkboxes) with conflict detection
- Landed in: master F2 (not this spec); ISC-15 holds this spec read-only

### Q4 · Name
- Offered: Sextant (recommended) | Plumb | Keel | later — rejected; second round: Spectant | Specmate | Specora | Specwright | Specular | Speculo | Spekta | Specto
- Chosen: Spectant, the principal's own coinage
- Landed in: master § Constraints; ISC-57 (name search, release slice)

## Round 1 — before the spec, 2026-09-28T09:40:00Z
The grill before the master (ten questions plus two interjections) and the frontend decision during the constitution settled everything this spec's claims depend on: standalone app with LifeOS optional (ISC-5 lives in `core/`), files as the only interface, Angular 22 zoneless with daisyUI 5, the old pages as the visual specification in both themes (ISC-17, ISC-17.1, ISC-18, ISC-18.1, ISC-18.2), loopback only (ISC-1), no outbound traffic (ISC-2).

### Q1 · Which goal does spec 001 have?
- Offered: install plus dashboard over two workspaces (recommended) | narrower: locally built, one workspace | wider: plus a read-only review page
- Chosen: install plus dashboard over two workspaces
- Landed in: § Goal; F0 and F1 projected

No further gaps the repository could not close; the screenshot threshold is fog to be measured, not a question.

## Round 2 — before the plan, 2026-09-28T10:55:00Z

### Q1 · In which order do we build 001?
- Offered: end-to-end skeleton first, then parity harness, core and API, dashboard (recommended) | contract first, binary and installer last | UI parity first against mock JSON
- Chosen: end-to-end skeleton first
- Landed in: plan.md § Approach

No further questions: the repo and design.md answered the rest (Playwright is the house e2e tool, FE-TST-03; no binding row is departed from).

## Round 3 — review before implement, 2026-09-28T12:00:00Z
The principal asked for the plan and design to be improved further and added: "ich möchte, dass die App modern,
best-practice, state-of-the-art und wirklich fancy ist … so dass das DIE Spec-Compagnion für Devs werden kann!"

### Q1 · Pixel parity to the old dashboard or a modern surface?
- Offered: keep the identity, drop pixel parity (recommended) | 001 pixel-identical, fancy from 002 | parity first, redesign later
- Chosen: keep the identity, drop pixel parity
- Landed in: § Vision, § Constraints, § Goal, ISC-17/17.1 re-worded, ISC-60 … ISC-67.1 added, the threshold fog line died; a second design pass ran with full-page captures

### Q2 · How does a spec open (Enter in the list or the palette)?
- Offered: route `/w/:ws/s/:id` with rail inspector / side sheet / full-screen sheet (recommended) | in-place row expansion via `?spec=` | route at wide, expansion at compact
- Chosen: route with inspector / sheet
- Landed in: design.md § Routes and state; Decisions

### Q3 · Where does "Next up" live, and does the TL;DR bar stay?
- Offered: own surface plus stage and command in every row, TL;DR kept as a collapsed Brief (recommended) | only in the rows, TL;DR dropped | only an own surface
- Chosen: own surface plus rows, Brief kept
- Landed in: design.md § Section disposition

### Q4 · Minimum width of a workspace column in the overview?
- Offered: 360 px capped at three columns (recommended) | 560 px
- Chosen: 360 px, three columns max
- Landed in: design.md § Grid rules; ISC-16.1 states

A same-vendor second look (Forge without Codex credentials) added eleven findings; the ones still valid after Q1
landed in ISC-2, ISC-8, ISC-14, ISC-15, ISC-18.1, ISC-18.3, ISC-5.1, ISC-5.2, ISC-8.1, ISC-16.1/16.2, ISC-19.1 and in
plan.md § Risks. The full record is in `.evidence/review-2026-09-28.md`.

## Still open
None: the spec has no fog after Round 3.

## Round 4 — build, 2026-09-28
- second look: off (default). Forge unavailable as builder or reader in this run (codex: no credentials, 401); builder is Engineer on every lane.
- Round 1 dispatched T1 (ISC-8), T2, T3, T4 (ISC-5.1) in worktrees on commit 29115a4; all four returned results, patches applied, no claim closed yet (ISC-5.1 waits for T5, ISC-8 for T6–T11).
- Marks from round 1: T1 — `bunfig.toml` `[test] pathIgnorePatterns = ["web/src/**"]` proven with throwaway probes (no `scripts/test.ts` wrapper needed); `test:visual`, `test:browser`, `e2e` forward to `bun run --cwd web <name>`, so T7/T31 must define exactly those names in `web/package.json`; `verify:quick` is red until T8 and the first tests; bun pinned at 1.3.12 from the environment. T2 — added the rule "pin every dependency and tool version" (XC-09) beyond the brief; constitution rows resting on `ISA.md` can now be re-pointed at `CLAUDE.md`. T4 — noted that ISC-7 says "registry, notes and pins" while plan § Data Model says "registry and settings" (resolved below). All workers skipped voice notifications (voice is off).
- Round 2 (commit a4555d2): T5, T35, T45, T46 returned results; closed ISC-5.1, ISC-21, ISC-5 on their probes; ISC-6 waits for the golden test (T42). Marks: T5 — the constitution's web lane row names the private house standards as worker context, which a public file cannot point at; the rules are written out in `web/CLAUDE.md` instead (constitution row to re-point). T35 — gate marks are `.gates/reviewed.json` / `code-reviewed.json` (the real shape), fixture `code-reviewed` marks omit the `root` field (an absolute path in the real tool); a refactor's missing mermaid is a silent `warn` in the old skill, so the diagrams warning is carried by 004 (feature); `core/fixtures/.gitignore` re-includes the fixture masters that the root `ISA.md` ignore would hide; `generate.ts` carries its own copy of the review-digest normalization until `core/src/gates.ts` exists (T39 should switch it to an import). T45 — `*.gen.*` files are skipped, an allow comment without a reason does not suppress. T46 — `ensureDataDir` also `chmod 0700`s an existing directory; empty `XDG_DATA_HOME` counts as unset.
- Round 3 (commit e660dc9): T6 build contract landed with 21 tests; `server/embedded.gen.ts` is generated and gitignored; `http.ts` must take the manifest as a parameter; hashed-name regex is Angular's 8-char base32; `isSpaRoute` excludes only known extensions so `/w/example.com` still loads the app.
- Round 4 (commit e660dc9, T7 alone): Angular 22.2.0 zoneless workspace, Vitest 5 via the Angular builder, Tailwind 4.3.3, daisyUI 5.7.46, everything pinned; `bun run --cwd web build` writes `web/dist/browser/{index.html, main-*.js, styles-*.css}`. Finding: the Angular CLI refuses Bun's Node shim and runs on the system Node ≥ 22.22.3 (plan § Risks). Decision (principal): tasks.md re-cut with five seams and `[P]` everywhere else, because SpecRun runs every non-`[P]` task alone and the first cut would have taken ~60 rounds; costs one `/spec-review`.
- Round 5 (commit f28deea): T8, T9, T10, T17 returned results; closed ISC-5.2 and ISC-18; ISC-8 waits for T11. Findings: Bun defaults `SO_REUSEPORT` on, so `http.ts` sets `reusePort: false` and a test pins that a busy port throws (T50's fallback depends on it); an unsigned bun-compiled binary is SIGKILLed on macOS until `codesign -s -`, so T11 must sign darwin outputs unconditionally; the weak ETag mixes in `generatedAt` because a new build's `index.html` keeps its size; angular-eslint 22 treats OnPush as the default and flags only an opt-out; ESLint is pinned to 9.39.5 as briefed although 10.x exists. Parent fixes after the merge (the round's own files were written before the lint existed): ESLint ignores `specs/**`, `.vendor/**`, `*.gen.ts`; `non-nullable-type-assertion-style` off because it conflicts with `no-non-null-assertion`; sixteen `!` sites replaced by narrowing or a `must()` helper; stylelint hue and alpha in number notation so the colour guard's parser keeps working. T8 touched four files outside its lane for tsc under `noUncheckedIndexedAccess` (harbor `generate.ts`, `check-single-core.ts`, `assets.contract.test.ts`, `hello.spec.ts`), behaviour unchanged, fixture regeneration byte-identical.
- Round 6 (commit 5fcf738, T11 alone): closed ISC-8 — four binaries (darwin arm64/x64 ad-hoc signed, linux arm64, linux x64 from the baseline target), host binary serves the embedded app from an empty directory. Findings: `--compile --sourcemap=none` still writes a stray map with bun 1.3.12, so the flag is omitted; the generated manifest needs `// @ts-nocheck` because bun-types cannot type `with { type: "file" }` imports of html/css/ico (T9's generator amended, the contract's doc example updated by the parent); an ambient `*/embedded.gen.ts` module declaration keeps tsc green on a fresh checkout; `cli.ts` rejects `--no-browser` until T50 adds it, so T12's probe depends on T50 landing first or on using `--port 0` alone.
- Round 7 (commit 7aaae5b): closed ISC-8.1 (binary smoke), ISC-9 (`check:version`), ISC-10 (install in a non-root Ubuntu x64 container under emulation, 14 checks); T18 landed the derived contrast tokens with a guard, ISC-65 waits for the browser spec. Marks: `test:binary` builds the host target first and gates the suite behind `SPECTANT_TEST_BINARY=1` so the lane probe stays green on a checkout without `dist/`; `--no-browser` is accepted as a no-op since T13 (T12's spawn still passes only `--port 0` — T50 flips it to `--no-browser --port 0`); ISC-12's literal `INSTALL_DIR=/opt/x/bin` needs a writable `/opt/x` for the non-root tester (T15); the light badge fill `#1c8ca8` gives only 3.81:1 for off-white text, so `--badge-fill` (light `#007e9a`, 4.57:1) is the derived fill the badge component paints, and light `--done` also needed an ink variant; the token `@import` sits right under `@import "tailwindcss"` because stylelint rejects an import after `@plugin`; derived tokens are undefined without `data-theme`, so the pre-paint script (T58) must always set it; `web/CLAUDE.md` should list `--muted-ink`, `--badge-fill`, `--badge-ink`, `--focus-*` (drift, not fixed).
- Round 8 (commit d012446): closed ISC-12 (`INSTALL_DIR`, 19 container checks), ISC-67 (local fonts), ISC-18.2 (icon module, generator, byte-identity guard); T21 landed the motion tokens, ISC-66 waits for the browser spec. Marks: JetBrains Mono 2.304 ships no variable woff2, so the official variable TTF was re-encoded once with the reference woff2 encoder (provenance in `fonts.css`); `THIRD_PARTY_NOTICES.md` (T55) must list Inter 4.1 and JetBrains Mono 2.304 under OFL-1.1; the JetBrains Mono preload may log "preloaded but not used" until mono text renders on first paint (T30/T31 to check); the reduced-motion block also neutralises `::view-transition-*` pseudo-elements; `.ui-skeleton` shimmer animates `background-position`; `generate-icons.ts` is excluded from the app tsconfig and checked through the root program; `strictTemplates` is not set, so dynamic `[name]` bindings on `ui-icon` are not type-checked. Parent fixes after the merge: fonts and motion both added an `@import` to `styles.css` (merged by hand), ESLint now ignores `.claude/**` (it had linted a live worktree), and the component/directive selector prefix is `['app', 'ui']` so the `ui-*` primitives need no per-file disable (the disable in `icon.ts` was removed).
- Round 9 (commit afed26f): closed ISC-67.1 (external font URL guard) and ISC-22 (Transloco 8.4.0, 174 keys, bundled loader); T24 landed the button primitives with the global focus ring (ISC-64 waits for T29) and T25 all 17 display primitives (ISC-17 waits for T79); web lane 21 spec files / 33 tests. Marks: Transloco pinned 8.4.0 (current) instead of 7.x, same API; plurals as `.one`/`.other` sub-keys without messageformat; phase values verbatim in both languages (format vocabulary); `LanguageService.current` is computed over Transloco's active lang, `set()` also sets `<html lang>`, persistence is T58; the button group joins by its own CSS because daisyUI's `join` uses `@scope` (WebKit 17.4+); `disabled` keeps the button focusable with `aria-disabled` and a capture-phase click guard; secondary buttons are plain `btn` on base-100, not daisyUI's violet `btn-secondary`; in a `gap` group of 32 px buttons the 44 px hit areas overlap by 4 px (WCAG 2.5.8 still met); T25's filter chips, segmented and command chip use plain `<button>` with `btn` classes (TODO swap to `ui-button`); tone map: building maps to warning until a `conc` tone is added; `ui-notice` info uses `triangle-alert` (no info icon in the pinned set); chip/notice text-on-tint contrast is not measured yet (T30); `ui-ring` gradient is `url(#ui-ring-N)` (check in WebKit, ISC-19); nothing renders the primitives yet, so the build tree-shakes them and the style budget is untested until T59+. Parent fixes: ESLint `elements-content` allow-lists `label` (icon buttons), README adjusted.
- Session hand-off 2026-09-28 (after round 9): the principal restarts Claude from the repo directory; state and the round protocol are in the LifeOS memory note `spectant-implement-run`; helper `close-claims.ts` and the round plans live under `~/.claude/LIFEOS/MEMORY/WORK/spectant/tools/`. Next: commit round 9, then round 10 = T26 (overlay primitives), T27 (roving list), T32 (FORMAT.md), T42 (registry).
- Lock handling: `SpecRun.ts plan` holds every task whose claim is locked, my own session included, so locks are taken per round at dispatch and released after the round's write order; a claim that did not close is unlocked between rounds.
