<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../../../../../docs/logo.svg">
  <img src="../../../../../../docs/logo-light.svg" alt="spectant" width="96">
</picture>

# Buttons (`ui-button`, `ui-icon-button`, `ui-button-group`)

- Text: `<button ui-button variant="primary" size="sm" (click)="save()">{{ 'save' | transloco }}</button>`; also on `<a ui-button routerLink="…">`. Variants `primary | secondary (default) | ghost | outline`, `size="sm|md"` (32 / 40 px), `tone="warning|danger"`, `type` defaults to `button`.
- Icon only: `<button ui-icon-button icon="settings" [label]="'settings' | transloco"></button>`; `label` is required and becomes `aria-label` and `title`. The template lint rule `elements-content` allow-lists `label` in `eslint.config.js`, so no per-line disable is needed.
- Groups: `<ui-button-group [label]="…">` joins its children (shared border, outer corners only); add `gap` for 8 px spacing instead.
- Disabled: `[disabled]="…"` sets `aria-disabled`, keeps focus, 50 % opacity, and swallows the click (links don't navigate). Never set the native `disabled` attribute.
- Focus: the ring is global (`src/styles/primitives.css`, ISC-64); don't style `outline` or `box-shadow` on focus. Inside rows and scroll containers put `data-focus="inset"` on the focusable element.
- Touch: under `pointer: coarse` each button gets an invisible 44 × 44 hit area (WCAG 2.5.8), so leave 4 px around a 40 px button and don't clip it with `overflow: hidden` on a tight parent.
