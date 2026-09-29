# <picture><source media="(prefers-color-scheme: dark)" srcset="../../../../../docs/logo.svg"><img src="../../../../../docs/logo-light.svg" alt="" height="28" align="absmiddle"></picture> Shared UI primitives

The `ui-*` display primitives from design.md § Components. Each lives in its own folder (`<name>/<name>.ts` with an
inline template and styles, plus `<name>.spec.ts`) and is exported from `index.ts`.

- **Standalone, OnPush, signal inputs.** Two-way values (`ui-filter-chips`, `ui-segmented`) are `model()`s, so a
  feature binds them straight to its query param.
- **Colour only through tokens.** `tone.ts` maps the eight tones onto the theme's custom properties: `color` for
  edges, glows, fills and dots, `tint` for backgrounds, `ink` for text that clears 4.5:1 (ISC-65). No hex here.
- **Motion only through tokens** from `styles/motion.css`; reduced motion is handled there, once.
- **No literal user-facing strings in templates.** Text arrives through inputs or projection. English fallbacks in
  TypeScript (`ui-stage-track` name, `ui-relative-time` format, `ui-command-chip` labels) are marked `TODO(T23)` and
  move to Transloco keys when T23 lands.
- **Buttons are plain `<button>`s** with daisyUI `btn` classes until `ui-button` lands (`TODO(T24)`); the global focus
  ring arrives with T24 as well.
- **SVG outside `ui-icon`** carries `data-icon-exempt` (the ring), so the icon guard keeps passing.
- Layout, cascade and focus behaviour are checked on real Chromium by the browser tier, not by these specs.

## Added by spec 002 (T60)

| Primitive | Folder | Inputs / API | Notes |
|-----------|--------|--------------|-------|
| `ui-glyph` | `glyph/` | `state` (the eleven `CardState`s and six `ClaimGlyphState`s), `family?` (`card` / `claim`, only for `closed`), `size` (`20` cards, `14` matrix cells) | One inline SVG shape per state from `glyph/states.ts`; no two states share a (shape, tone) pair; ink of the state tone; `aria-hidden`, the word comes from the chip; `absent` is the dashed cell (ISC-88). |
| `ui-state-chip` | `state-chip/` | `state`, `family?` | `ui-chip` in the state tone with the 14 px glyph and the visible word from `states.card.*` / `states.claim.*`. |
| `ui-scrubber` | `scrubber/` | `frames` (`{ kind, label, tone? }`, kinds `dispatch` / `result` / `recut` / `live`), `value` and `playing` as `model()`s, `ariaLabel?` | 32 px ◂ ▶ ▸ buttons, a real `<input type="range">` with `aria-valuetext` = frame label; arrow, Page, Home and End keys as a native range; ticks hollow / filled in the tone mark / hatched / lime ring; the fill morphs on `--motion-duration-slow`. |
| `ui-disclosure` | `overlay/` | `open` (`model()`), `count?` | Spec 001's disclosure, reused: spec 002 adds the optional count in the summary row ("Probe", "Contents", claim groups). |
| `ui-toast` + `ToastService` | `toast/` | `show(text)`, `dismiss()`, `message` | The app's single toast (DS-APP-25), mounted once by the shell; auto-dismiss after `TOAST_MS` (4 s); the host owns the page's one polite `ui-live-region`, the visible toast is `aria-hidden`. |

`tone.ts` gained `concern` (the yellow `--conc`, its `-t` tint and `-ink`) for the concerns state.
