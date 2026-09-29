# web/ — the dashboard UI

Lane `web`: path `web/`. The root `CLAUDE.md` still applies; this file adds only what is specific to the lane.

**Lane probe: `bun run --cwd web test`**

## Purpose

The Angular 22 dashboard: zoneless, standalone, built to `web/dist` and embedded into the binary by `server/`. It
renders the dashboard model from `core/src/dashboard.ts` (T44) as it is and talks only to the loopback `/api`.
Reason: reshaping or re-parsing the model here makes a second parser (ISC-5); any other host breaks ISC-2.

## Framework

- `provideZonelessChangeDetection()` is explicit in the app config. Reason: the intent must not hang on a default.
- Standalone components only, `ChangeDetectionStrategy.OnPush` on every one. Reason: zoneless rendering is driven by
  signals and marked views, never by a global event sweep.
- `input()`, `output()`, `model()`, `viewChild()`, `signal`, `computed`, `linkedSignal`, `inject()`. Reason: one
  reactive model the compiler and the lint rules can check.
- Templates use `@if` / `@for` / `@switch`; decorator inputs and outputs, `*ngIf` / `*ngFor` / `ngSwitch` and `| async`
  are banned, and ESLint enforces it. Reason: one idiom per concern, no imports for control flow.
- RxJS only at the I/O boundary (HTTP, polling timer, `matchMedia`), bridged with `toSignal`. Reason: components read
  signals; a stream in a template brings back `| async` and manual subscriptions.

## State

- Router-driven, never in-memory: `/` all workspaces, `/w/:ws` a dashboard, `/w/:ws/s/:id` a spec open. Filters, sort
  and flags are query params (`?phase=building&sort=next&takeable=1`). Reason: reload, back and the cmux web view land
  on the same screen.
- Settings (theme mode, language, refresh interval, single-key shortcuts) come from `/api/settings`. Reason: they must
  survive a port change, which per-origin browser storage does not (ISC-18.3).
- "Recent" palette entries are the only `localStorage` use, every access wrapped in try/catch. Reason: a per-viewer
  convenience that may be empty or throw in a private window or a web view.

## Design system

- daisyUI 5 on Tailwind 4 CSS-first, `themes: false`, `--depth: 0`, `--noise: 0`. Reason: no stock theme, bevel or
  grain may leak into the inherited look.
- The themes `spec-light` / `spec-dark` in `src/styles.css` are the only colour source, OKLCH with the inherited hex
  in a comment. Reason: ISC-18 round-trips them to the old pages' values.
- Derived tokens (`--muted`, `--track`, `--*-ink`) live in `src/styles/tokens.css`. Reason: they are contrast fixes
  (ISC-65), not inherited values, and ISC-18 does not cover them.
- `color-no-hex` everywhere outside those two files. Reason: a stray hex is a colour neither theme knows.
- `data-theme` is set by the pre-paint script and the theme service, never by a `prefers-color-scheme` block.
  Reason: system mode follows `matchMedia` live and a chosen mode wins over it (ISC-18.1).
- Motion tokens only in `src/styles/motion.css`, no literal duration elsewhere; every duration is `0ms` under
  `prefers-reduced-motion: reduce`. Reason: one switch honours reduced motion everywhere (ISC-66).
- Container tiers on the shell container (`container: shell / inline-size`): compact < 640, medium 640–1119, wide
  ≥ 1120, never a viewport media query; spacing on the 8 px scale (4 / 8 / 16 / 24 / 32 / 48). Reason: the app runs
  in a 600 px cmux panel as often as full-window (ISC-63).
- Manrope (text), Sora (wordmark and page title) and JetBrains Mono as local woff2 only (ISC-74); `tabular-nums` on every number; mono for IDs, commands and
  ports. Reason: no font request leaves the machine (ISC-67, 67.1); live numbers never shift layout (ISC-62.1).
- Icons only from the pinned `lucide-static` version, only used icons inlined, rendered through `ui-icon`. Reason:
  ISC-18.2 checks every name against that version, and unused icons are dead weight.
- Shared primitives live in `src/app/shared/ui/`, and each exists because it has two consumers. Reason: a primitive
  with one consumer is an abstraction without a job; it stays in its feature until the second arrives.

## i18n

- Transloco, English default, German formal (Sie); every key in both `src/i18n/en.json` and `src/i18n/de.json`.
  Reason: ISC-22 fails on a missing key or an informal form.
- No literal user-facing string in a template, `aria-label` and `title` included. Reason: a literal skips both
  catalogues and the parity check. Lay out for German, the long case.

## Accessibility and motion

- One global `:focus-visible` ring: 2 px `--disp` outline, 2 px offset, 4 px `--bg` halo. Reason: ISC-64, both themes.
- Native `popover` and `<dialog>` (`showPopover()`, `showModal()`), Esc and backdrop click handled in the primitives.
  Reason: top layer and inertness come free; `closedby` and `commandfor` are missing in WebKit 17.
- Focus returns to the trigger on close; section jumps (`g` sequences) move focus to the section heading. Reason: a
  keyboard user never loses their place.
- Under `pointer: coarse` the `ui-button` / `ui-icon-button` primitive adds a 44 × 44 hit area. Reason: WCAG 2.5.8
  is solved once, not per feature.
- WebKit (the cmux web view, floor WebKit 17) is a first-class target: feature-detect anchor positioning, view
  transitions and `@starting-style`; ship `-webkit-backdrop-filter` and `-webkit-line-clamp`. Reason: ISC-19 and
  ISC-19.1 run there, and Chromium-only CSS fails silently.

## Testing

- `bun run --cwd web test`: component specs on Vitest through Angular's `unit-test` builder, the lane probe. Reason:
  `bun test` cannot compile TestBed specs.
- Anything touching layout, cascade, focus or gestures is a `*.browser.spec.ts` on real Chromium
  (`bun run test:browser`). Reason: a DOM emulation has no layout and no cascade (ISC-64 to ISC-66).
- Playwright suites under `web/e2e/` (`bun run e2e`, `bun run test:visual`) run inside the pinned Playwright Linux
  container, against the stub API fed from `core/fixtures/*.golden.json`, with a fixed clock and animations off.
  Reason: committed baselines must match CI byte for byte.
- Pure TypeScript guards (tokens, icons, i18n parity, fonts) live in `web/tests/*.test.ts` and run under root
  `bun test`, where `bunfig.toml` excludes `web/src`. Reason: they need no Angular, and Bun must skip Vitest specs.
