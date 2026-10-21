import { booleanAttribute, ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { type Tone, toneMark } from '../tone';

export interface FilterOption {
  readonly key: string;
  readonly label: string;
  readonly count?: number;
  readonly tone?: Tone;
  /**
   * The accessible name, for a chip whose visible text would repeat another target's ("All 23" twice); it starts with
   * the visible word, so label-in-name holds (spec 021, ISC-248). Absent, the visible text is the name.
   */
  readonly name?: string;
}

/**
 * Single-select filter chips for the Specs panel toolbar (All 6 · building 2 · scoping 4): toggle buttons with
 * `aria-pressed`, 8 px phase dots, tabular counts. At compact the row scrolls horizontally behind edge fade masks;
 * with `wrap` (host `data-wrap`) it wraps onto further lines instead, for a head whose chips must all stay in view
 * (the spec list's phase chips with "ideas", spec 064 T41).
 * The value is a `model`, so the feature binds it straight to its query param (router-driven state).
 *
 * TODO(T24): swap the plain buttons to `ui-button` once T24 lands; the classes below are the ones it is expected to
 * carry, and the global focus ring arrives with it.
 */
@Component({
  selector: 'ui-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './filter-chips.css',
  templateUrl: './filter-chips.html',
  host: { '[attr.data-wrap]': 'wrap() ? "" : null' },
})
export class UiFilterChips {
  readonly options = input.required<readonly FilterOption[]>();
  readonly value = model<string>();
  /** Accessible name of the group (translated). */
  readonly label = input<string>();
  /** The row wraps onto further lines instead of scrolling sideways at compact. */
  readonly wrap = input(false, { transform: booleanAttribute });

  protected readonly color = toneMark;
}
