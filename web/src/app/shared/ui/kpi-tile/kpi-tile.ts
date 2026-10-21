import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Params, RouterLink } from '@angular/router';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { UiCard } from '../card/card';
import type { Tone } from '../tone';

/**
 * A KPI tile (design.md § Desktop Soll, KPI band; spec 024 ISC-148): the card itself is
 * the tile, 16 px padding (24 for the hero), a column 6 px apart: eyebrow label (600 11/16 .08em uppercase, muted),
 * the tabular value (600 32/40 -.02em) with an optional denominator (16/500, muted), a meta line at the foot, a
 * projected visual (`[visual]`, e.g. a `ui-ring`, which puts the column beside it) and trailing content (a meter).
 * With `href` (plus optional `queryParams` and `fragment`) the whole tile is one router link (the anchor is the
 * card's whole box, so the padding is clickable too) and hover raises the card glow. The fraction never wraps and steps down one size past six digits, so live numbers cannot reflow the band
 * (ISC-62.1). `accent`, `edge` and `glow` go to the card as they are: `edge` / `glow` set the card's variants
 * explicitly (a hero glows without an edge), and an `accent` alone keeps `ui-card`'s rule of turning both on.
 */
@Component({
  selector: 'ui-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiIcon, RouterLink, NgTemplateOutlet],
  host: { '[attr.data-variant]': 'variant()', '[attr.data-wide]': 'wide() ? "" : null' },
  styleUrl: './kpi-tile.css',
  templateUrl: './kpi-tile.html',
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
  /** A hero laid across a whole band row (640 to 1119): the meta line sits at the row's end instead of under the value. */
  readonly wide = input<boolean>(false);

  /** More than six digits across value and denominator: the fraction steps down one size. */
  protected readonly long = computed(
    () => `${this.value()}${this.denominator() ?? ''}`.replace(/\D/g, '').length > 6,
  );
}
