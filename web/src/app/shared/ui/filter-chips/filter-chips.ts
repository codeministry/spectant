import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { type Tone, toneMark } from '../tone';

export interface FilterOption {
  readonly key: string;
  readonly label: string;
  readonly count?: number;
  readonly tone?: Tone;
}

/**
 * Single-select filter chips for the Specs panel toolbar (All 6 · building 2 · scoping 4): toggle buttons with
 * `aria-pressed`, 8 px phase dots, tabular counts. At compact the row scrolls horizontally behind edge fade masks.
 * The value is a `model`, so the feature binds it straight to its query param (router-driven state).
 *
 * TODO(T24): swap the plain buttons to `ui-button` once T24 lands; the classes below are the ones it is expected to
 * carry, and the global focus ring arrives with it.
 */
@Component({
  selector: 'ui-filter-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-inline-size: 0; }
    .row { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
    .chip { flex-shrink: 0; gap: 8px; border-radius: 999px; font-weight: 500; white-space: nowrap; }
    .chip[aria-pressed='true'] { --btn-bg: var(--disp-t); --btn-fg: var(--disp-ink); --btn-border: var(--color-primary); }
    .dot { inline-size: 8px; block-size: 8px; border-radius: 50%; }
    .count { color: var(--muted-ink); font-variant-numeric: tabular-nums; }
    /* On the selected chip's tint the muted count falls below 4.5:1 (4.44 light, 4.07 dark); it takes the chip's ink. */
    .chip[aria-pressed='true'] .count { color: var(--disp-ink); }
    @container shell (width < 640px) {
      .row { mask-image: linear-gradient(90deg, transparent, black 16px, black calc(100% - 16px), transparent); padding-inline: 16px; }
    }
    @media (forced-colors: active) {
      .dot { background: CanvasText; }
    }
  `,
  template: `
    <div class="row" role="group" [attr.aria-label]="label() ?? null">
      @for (option of options(); track option.key) {
        <button
          type="button"
          class="btn btn-sm btn-ghost chip"
          [attr.aria-pressed]="option.key === value()"
          (click)="value.set(option.key)"
        >
          @if (option.tone; as tone) {
            <span class="dot" aria-hidden="true" [style.background]="color(tone)"></span>
          }
          {{ option.label }}
          @if (option.count !== undefined) {
            <span class="count">{{ option.count }}</span>
          }
        </button>
      }
    </div>
  `,
})
export class UiFilterChips {
  readonly options = input.required<readonly FilterOption[]>();
  readonly value = model<string>();
  /** Accessible name of the group (translated). */
  readonly label = input<string>();

  protected readonly color = toneMark;
}
