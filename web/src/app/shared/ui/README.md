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
| `ui-scrubber` | `scrubber/` | `frames` (`{ kind, label, tone? }`, kinds `dispatch` / `result` / `recut` / `live`), `value` and `playing` as `model()`s, `ariaLabel?` | 32 px ◂ ▶ ▸ buttons, a real `<input type="range">` with `aria-valuetext` = frame label; arrow, Page, Home and End keys as a native range; ticks hollow / filled in the tone mark / hatched / lime ring; `markers` (`{ before, label, title? }`) hatched re-cut markers whose label carries `title` as tooltip and accessible name; the fill morphs on `--motion-duration-slow`. |
| `ui-disclosure` | `overlay/` | `open` (`model()`), `count?` | Spec 001's disclosure, reused: spec 002 adds the optional count in the summary row ("Probe", "Contents", claim groups). |
| `ui-toast` + `ToastService` | `toast/` | `show(text)`, `dismiss()`, `message` | The app's single toast (DS-APP-25), mounted once in the app root; auto-dismiss after `TOAST_MS` (4 s); the host owns the page's one polite `ui-live-region`, the visible toast is `aria-hidden`. |

`tone.ts` gained `concern` (the yellow `--conc`, its `-t` tint and `-ink`) for the concerns state.

## Added by spec 003 (T29)

| Primitive | Folder | Inputs / API | Notes |
|-----------|--------|--------------|-------|
| `ui-meter` | `meter/` | `value`, `max`, `segments?` (split mode), `tone?`, `mini` (boolean, 4 px), `size` (`default` 6 px / `mini` 4 px / `lg` 8 px), radius 3, `label?`, `valueText?` | `role` meter (single) or img (split); `valueText` becomes `aria-valuetext` in single mode only and arrives translated. `mini()` wins over `size`; the host carries `data-size` (`mini` / `lg`, absent for default) and `data-mini`. The fill is solid cyan, lime once full (`data-full`), or the tone; split segments sit on no track with 2 px gaps. The fill morphs `transform` only. |

## Added by spec 008 (T104, T105, T107)

| Primitive | Folder | Inputs / API | Notes |
|-----------|--------|--------------|-------|
| `ui-type-glyph` | `type-glyph/` | `type` (a `SpecType` or `idea`), `size` (`12` / `14` / `16` default / `20`), `decorative` | `TYPE_GLYPHS` maps each type to one Lucide icon, `CHIP_ICON` (`chip/chip-icons.ts`) for feature, bug, refactor and spike (chore is the broom, not the builder tag's wrench); an image named by `types.*` unless `decorative`, where the word stands beside it. Draws in `currentColor`. |
| `ui-priority` | `priority/` | `value` (`P1`…`P4`, null or absent reads as `P3`) | Glyph and text always together, never truncated; `role="img"` named `priority.name`, tooltip `priority.title`. P1 error tint and ink, P2 warning tint and ink, P3 outline in the neutral ink, P4 outline in `--muted-ink`; a missing value is P3 with a dashed outline (`data-unmarked`). |
| `ui-reason` | `reason/` | `phrase` (core's `nextReason`, shown as is), `command?` (null: no chip), `compact` (one line), `block` (status block: 15/24, wrapping, never clamped), output `copied` | Hourglass named `reason.glyph`, the phrase clamped at a whole word by `uiClamp` (two lines, one when compact; unclamped plain text when block) with the full phrase kept as accessible text, then a `ui-command-chip`. Ink is `--reason-ink`, falling back to `--hover-ink`. |
| `ui-worktree-chip` | `worktree-chip/` | `worktree` (core's `Worktree`), `compact`, `interactive` (default true), `mismatch`, `source` (`main` / `worktree`), `tier` (the sheet tier) | Spec 027: the spec's worktree as a chip — `git-branch`, the branch in mono (prefix muted, only the slug truncates), `↑n` (`↑0` shown), `±` in the warning ink when dirty; the whole chip in the warning tone when the branch names another spec than the path. Full form in the spec head, compact form (icon, `↑n`, `±`, branch in the accessible name) on the board card at every width (the card declares no container; the primitive's `@container board-card (width >= 280px)` rule is for a consumer that wants the full form past 280 px). Interactive: a `<button>` with a 44 px hit area opening one details list (path with copy, branch, commits ahead, working tree, the worktree copy as source) in `ui-popover`, as a bottom `ui-sheet` at the compact tier; focus returns to the chip. Non-interactive on cards: no button, the sentence as hidden text and `title`. No transition. |

## Added by spec 025 (T21)

| Primitive | Folder | Inputs / API | Notes |
|-----------|--------|--------------|-------|
| `ui-waits-chip` | `waits-chip/` | `wait` (core's `SpecWait`), `ws`, `titles?` (blocker titles by number), `meta` (visible partial scope) | `dependency-chip.waits`: "waits on NNN" / "wartet auf NNN" with `clock` 12, mono 500 11, 22 px, 1 px dashed `--color-secondary`, ink `--ques-ink`, unfilled, hover `--ques-t`. One chip per blocker linking to `/w/:ws/s/NNN`, at most `WAITS_VISIBLE` (2), then a neutral `+n` naming the rest in its tooltip and hidden text; an unknown blocker is an unlinked span. With `meta` a partial hold shows "4 of 5 open tasks" as muted text behind the chips; without it the scope joins the first chip's accessible name and tooltip; a full hold shows none. 44 × 44 hit area under `pointer: coarse`. Consumers: the spec head, the board card and the spec table. |

## Added by spec 052 (T14, T17)

| Primitive | Folder | Inputs / API | Notes |
|-----------|--------|--------------|-------|
| `ui-star-toggle` | `star-toggle/` | attribute selector `button[ui-star-toggle]`; `pressed`, `label` (required: the fixed accessible name, translated by the caller from `favorites.toggle`), `size` (`sm` 32 px default / `head` 28 px), output `toggled` | The favorite toggle: a native `<button type="button">` with `ui-icon name="star"` at 16 px in a quiet icon box (radius `--radius-sm`, an 8 % text tint on hover). `aria-pressed` carries the state, the accessible name stays fixed, `title` names the action (`favorites.add` / `favorites.remove`), so a screen reader never hears the state twice. Off: outline in `--muted-ink`; on: outline and fill in `--conc-ink`; `ButtonText` under forced colors. Colour changes at `--motion-duration-instant`, nothing moves. 44 × 44 hit area under `pointer: coarse` (`::before`), which a consumer may shift (the spec row's two-line form does). The state belongs to the caller; a click only emits `toggled`. Its own stylesheet keeps the consumers under the 8 kB component budget. Consumers: the spec head, the dashboard's spec row (a second slot, `ng-content select="[ui-star-toggle]"`, beside the row link) and the header spec select. |

## Added by spec 016 (T12)

| Primitive | Folder | Inputs / API | Notes |
|-----------|--------|--------------|-------|
| `ui-sort-menu` | `sort-menu/` | `options` (`SortOption[]`: `key` and translated `label`, in menu order), `value` (the current key), `label` (the menu's translated name), `tier` (the sheet tier), `placement` (default `end`), output `choose` (the picked key) | The spec table's sort control, drawn as before: a bordered ghost `btn-sm` trigger (`data-control="sort"`) with `arrow-up-down` 16 and the current key's label, named "label: current". One list of `pop-item` buttons (`data-sort`, `aria-pressed`, `data-autofocus` on the current) in a `ui-popover` from medium, in a bottom `ui-sheet` at compact (`aria-haspopup="dialog"`, `aria-expanded`). A pick closes the menu and emits the key, the current one too; the consumer maps it to its `?sort=` and skips a no-op. Consumers: the spec table and the workspaces list (spec 016). |

## Added by spec 067 (T22, T27)

| Primitive | Folder | Inputs / API | Notes |
|-----------|--------|--------------|-------|
| `ui-command-chip` | `command-chip/` | new `size` (`default` / `lg`) | `lg`: a 44 px chip whose copy (or lock) button is a real 44 × 44 box with a 16 px glyph, for the compact detail sheet; the host carries `data-size="lg"`. The default 28 px chip and its 26 px button stay on every other surface. |
| `ui-stage-targets` | `stage-targets/` | attribute selector `ul[ui-stage-targets]`; `stages` (column order), `from`, `targets` (`card.targets`, `dropTargetsOf`), `movable` (default true), `refusal`, `tall` (56 px rows), outputs `choose` (the stage) and `dismiss` | The stage-target list of the board's "Move to…", shared with the detail sidebar's inline stage change. One `button.entry` per stage (`data-move-to`, `data-hint` from `dropHint` in `core/model/drop-hint.ts`): the current one `aria-current`, admitted ones enabled, every other one `aria-disabled` (still focusable) with its visible reason, "not next from …" or "gate"; `data-autofocus` on the first enabled entry, else the current one. A refusal's notice stands under its entry, a run's is the consumer's. Consumers: `app-move-to-menu`, the detail sidebar (spec 067, T28). |
