import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { UiCard } from '../card/card';
import type { Tone } from '../tone';

/**
 * A KPI tile (design.md § Desktop Soll, KPI band): eyebrow label, a tabular value with an optional muted
 * denominator, a meta line, a projected visual (`[visual]`, e.g. a `ui-ring`) and trailing content (a meter).
 * With `href` the whole tile is one router link and hover raises the card glow. The fraction never wraps and steps
 * down one size past six digits, so live numbers cannot reflow the band (ISC-62.1).
 */
@Component({
  selector: 'ui-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiIcon, RouterLink, NgTemplateOutlet],
  host: { '[attr.data-variant]': 'variant()' },
  styles: `
    :host { display: block; min-inline-size: 0; }
    ui-card { block-size: 100%; }
    .tile { display: flex; gap: 16px; align-items: center; block-size: 100%; padding: 16px; color: inherit; text-decoration: none; }
    :host([data-variant='hero']) .tile { padding: 24px; }
    .body { display: grid; flex: 1; gap: 4px; align-content: center; min-inline-size: 0; }
    .eyebrow { display: flex; gap: 8px; align-items: center; min-inline-size: 0; color: var(--muted-ink); font-size: 11px; font-weight: 600; line-height: 16px; letter-spacing: 0.08em; text-transform: uppercase; hyphens: none; }
    .eyebrow-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .figure { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .value { font-size: 32px; font-weight: 600; line-height: 40px; }
    .den, .meta { color: var(--muted-ink); }
    .den { font-size: 16px; line-height: 24px; }
    .meta { font-size: 12px; font-variant-numeric: tabular-nums; line-height: 16px; }
    :host([data-variant='hero']) .value { font-size: 40px; line-height: 48px; }
    :host([data-variant='hero']) .den { font-size: 20px; line-height: 28px; }
    :host([data-variant='sm']) .value, .long .value { font-size: 28px; line-height: 32px; }
    :host([data-variant='hero']) .long .value { font-size: 32px; line-height: 40px; }
    :host([data-variant='hero']) .long .den { font-size: 16px; line-height: 24px; }
    :host([data-variant='sm']) .long .value { font-size: 20px; line-height: 28px; }
  `,
  template: `
    <ui-card [accent]="accent()" [padding]="0" [interactive]="!!href()">
      @if (href(); as link) {
        <a class="tile" [routerLink]="link" [fragment]="fragment()"><ng-container [ngTemplateOutlet]="body" /></a>
      } @else {
        <div class="tile"><ng-container [ngTemplateOutlet]="body" /></div>
      }
    </ui-card>
    <ng-template #body>
      <ng-content select="[visual]" />
      <span class="body">
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
      </span>
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
  /** With `href`: the fragment the link lands on (`#waiting`). */
  readonly fragment = input<string>();
  readonly accent = input<Tone>();

  /** More than six digits across value and denominator: the fraction steps down one size. */
  protected readonly long = computed(
    () => `${this.value()}${this.denominator() ?? ''}`.replace(/\D/g, '').length > 6,
  );
}
