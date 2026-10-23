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
 * With `multiple` (host `data-multiple`, spec 072) the same chips are a multi-select over the `selected` model.
 *
 * TODO(T24): swap the plain buttons to `ui-button` once T24 lands; the classes below are the ones it is expected to
 * carry, and the global focus ring arrives with it.
 */
@Component({
  selector: 'ui-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './filter-chips.css',
  templateUrl: './filter-chips.html',
  host: { '[attr.data-wrap]': 'wrap() ? "" : null', '[attr.data-multiple]': 'multiple() ? "" : null' },
})
export class UiFilterChips {
  readonly options = input.required<readonly FilterOption[]>();
  /** The pressed key of the single mode; unused with `multiple`. */
  readonly value = model<string>();
  /** Accessible name of the group (translated). */
  readonly label = input<string>();
  /** The row wraps onto further lines instead of scrolling sideways at compact. */
  readonly wrap = input(false, { transform: booleanAttribute });
  /**
   * Multi-select (host `data-multiple`, spec 072): each chip toggles its own key in `selected`; an empty selection
   * means "everything", so there is no "All" chip and no check glyph.
   */
  readonly multiple = input(false, { transform: booleanAttribute });
  /** The pressed keys of the multiple mode, in the order they were pressed. */
  readonly selected = model<readonly string[]>([]);

  protected readonly color = toneMark;

  protected pressed(key: string): boolean {
    return this.multiple() ? this.selected().includes(key) : key === this.value();
  }

  protected press(key: string): void {
    if (!this.multiple()) {
      this.value.set(key);
      return;
    }
    this.selected.update((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }
}
