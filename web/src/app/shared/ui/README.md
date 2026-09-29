<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../../../../docs/logo.svg">
  <img src="../../../../../docs/logo-light.svg" alt="spectant" width="96">
</picture>

# Shared UI primitives

The `ui-*` display primitives from design.md § Components. Each lives in its own folder (`<name>/<name>.ts` with an
inline template and styles, plus `<name>.spec.ts`) and is exported from `index.ts`.

- **Standalone, OnPush, signal inputs.** Two-way values (`ui-filter-chips`, `ui-segmented`) are `model()`s, so a
  feature binds them straight to its query param.
- **Colour only through tokens.** `tone.ts` maps the seven tones onto the theme's custom properties: `color` for
  edges, glows, fills and dots, `tint` for backgrounds, `ink` for text that clears 4.5:1 (ISC-65). No hex here.
- **Motion only through tokens** from `styles/motion.css`; reduced motion is handled there, once.
- **No literal user-facing strings in templates.** Text arrives through inputs or projection. English fallbacks in
  TypeScript (`ui-stage-track` name, `ui-relative-time` format, `ui-command-chip` labels) are marked `TODO(T23)` and
  move to Transloco keys when T23 lands.
- **Buttons are plain `<button>`s** with daisyUI `btn` classes until `ui-button` lands (`TODO(T24)`); the global focus
  ring arrives with T24 as well.
- **SVG outside `ui-icon`** carries `data-icon-exempt` (the ring), so the icon guard keeps passing.
- Layout, cascade and focus behaviour are checked on real Chromium by the browser tier, not by these specs.
