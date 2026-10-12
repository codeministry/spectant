import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Params, RouterLink } from '@angular/router';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { UiCard } from '../card/card';
import type { Tone } from '../tone';

/**
 * A KPI tile (design.md § Desktop Soll, KPI band; the prototype's `.kpi-tile`, spec 024 ISC-148): the card itself is
 * the tile, 16 px padding (24 for the hero), a column 6 px apart: eyebrow label (600 11/16 .08em uppercase, muted),
 * the tabular value (600 32/40 -.02em) with an optional denominator (16/500, muted), a meta line at the foot, a
 * projected visual (`[visual]`, e.g. a `ui-ring`, which puts the column beside it) and trailing content (a meter).
 * With `href` (plus optional `queryParams` and `fragment`) the whole tile is one router link (its `::after` covers the
 * card, so the padding is clickable too) and hover raises the card glow. The fraction never wraps and steps down one size past six digits, so live numbers cannot reflow the band
 * (ISC-62.1). `accent`, `edge` and `glow` go to the card as they are: `edge` / `glow` set the prototype's variants
 * explicitly (a hero glows without an edge), and an `accent` alone keeps `ui-card`'s rule of turning both on.
 */
@Component({
  selector: 'ui-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiIcon, RouterLink, NgTemplateOutlet],
  host: { '[attr.data-variant]': 'variant()' },
  styles: `
    :host { display: grid; min-inline-size: 0; }
    /* The card is the tile (the prototype's .kpi-tile): a column, 6 px apart, the meta line pushed to the foot. */
    ui-card { display: flex; flex-direction: column; gap: 6px; }
    ui-card:has(> .visual:not(:empty)) { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 16px; align-content: center; }
    .visual:empty { display: none; }
    .visual { display: flex; grid-row: 1 / span 4; align-items: center; }
    /* A link tile: the anchor lends its children to the card's layout and covers the whole card with its ::after. */
    .tile { display: contents; color: inherit; text-decoration: none; }
    .tile::after { position: absolute; z-index: 1; inset: 0; border-radius: inherit; content: ''; }
    .tile:focus-visible { outline: none; box-shadow: none; }
    .tile:focus-visible::after { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
    .eyebrow { display: flex; align-items: center; color: var(--muted-ink); font-size: 11px; font-weight: 600; line-height: 16px; letter-spacing: 0.08em; text-transform: uppercase; hyphens: none; }
    .eyebrow ui-icon { margin-inline-end: 8px; }
    .eyebrow-text { overflow: hidden; min-inline-size: 0; text-overflow: ellipsis; white-space: nowrap; }
    .figure { font-size: 32px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 40px; letter-spacing: -0.02em; white-space: nowrap; }
    .den { color: var(--muted-ink); font-size: 16px; font-weight: 500; letter-spacing: normal; }
    .meta { margin-block-start: auto; color: var(--muted-ink); font-size: 12px; font-variant-numeric: tabular-nums; line-height: 16px; }
    :host([data-variant='hero']) .figure { font-size: 40px; line-height: 48px; }
    :host([data-variant='hero']) .den { font-size: 20px; }
    :host([data-variant='sm']) .figure, .figure.long { font-size: 28px; line-height: 32px; }
    :host([data-variant='hero']) .figure.long { font-size: 32px; line-height: 40px; }
    :host([data-variant='hero']) .figure.long .den { font-size: 16px; }
    :host([data-variant='sm']) .figure.long { font-size: 20px; line-height: 28px; }
    @media (forced-colors: active) {
      .tile:focus-visible::after { outline-color: Highlight; }
    }
  `,
  template: `
    <ui-card [accent]="accent()" [edge]="edge()" [glow]="glow()" [padding]="variant() === 'hero' ? 24 : 16" [interactive]="!!href()">
      <span class="visual"><ng-content select="[visual]" /></span>
      @if (href(); as link) {
        <a class="tile" [routerLink]="link" [queryParams]="queryParams()" [fragment]="fragment()"><ng-container [ngTemplateOutlet]="body" /></a>
      } @else {
        <ng-container [ngTemplateOutlet]="body" />
      }
    </ui-card>
    <ng-template #body>
      <span class="eyebrow" [title]="label()">
        @if (icon(); as name) {
          <ui-icon [name]="name" [size]="14" />
        }
        <span class="eyebrow-text">{{ label() }}</span>
      </span>
      <span class="figure" [class.long]="long()">
        <span class="value">{{ value() }}</span>
        @if (denominator() !== undefined) {
          <span class="den">/{{ denominator() }}</span>
        }
      </span>
      @if (meta()) {
        <span class="meta">{{ meta() }}</span>
      }
      <ng-content />
    </ng-template>
  `,
})
export class UiKpiTile {
  readonly variant = input<'hero' | 'default' | 'sm'>('default');
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly denominator = input<string | number>();
  readonly meta = input<string>();
  readonly icon = input<IconName>();
  readonly href = input<string>();
  /** With `href`: query state the link applies (`?sort=next&takeable=1`); a string `href` cannot carry it. */
  readonly queryParams = input<Params>();
  /** With `href`: the fragment the link lands on (`#waiting`). */
  readonly fragment = input<string>();
  readonly accent = input<Tone>();
  /** The card's 3 px top edge; unset, `ui-card` derives it from `accent`. */
  readonly edge = input<boolean>();
  /** The card's corner glow; unset, `ui-card` derives it from `accent`. */
  readonly glow = input<boolean>();

  /** More than six digits across value and denominator: the fraction steps down one size. */
  protected readonly long = computed(
    () => `${this.value()}${this.denominator() ?? ''}`.replace(/\D/g, '').length > 6,
  );
}
