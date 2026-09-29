import { ChangeDetectionStrategy, Component, type ElementRef, input, model, viewChildren } from '@angular/core';
import { type Tone, toneColor } from '../tone';

export interface SegmentedOption {
  readonly key: string;
  readonly label: string;
  readonly tone?: Tone;
}

const STEP: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * A segmented control with radio-group semantics (phase filter, theme mode): one tab stop (roving tabindex on the
 * checked option), arrow keys move and select with wrap-around, Home / End jump, per the ARIA radio group pattern.
 *
 * TODO(T24): the segments are plain buttons until `ui-button-group` lands; the focus ring arrives with T24.
 */
@Component({
  selector: 'ui-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: inline-flex; }
    .group { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--line); border-radius: var(--radius-field); background: var(--color-base-200); }
    .seg { gap: 8px; border: 0; font-weight: 500; }
    .seg[aria-checked='true'] { --btn-bg: var(--color-base-100); --btn-fg: var(--color-base-content); box-shadow: var(--shadow); }
    /* The checked segment's own shadow outranks the zero-specificity global ring rule; keep the halo (ISC-64). */
    .seg[aria-checked='true']:focus-visible { box-shadow: 0 0 0 4px var(--focus-halo), var(--shadow); }
    .dot { inline-size: 8px; block-size: 8px; border-radius: 50%; }
    @media (forced-colors: active) {
      .seg[aria-checked='true'] { outline: 2px solid Highlight; }
      .dot { background: CanvasText; }
    }
  `,
  template: `
    <div class="group" role="radiogroup" [attr.aria-label]="label() ?? null">
      @for (option of options(); track option.key; let i = $index) {
        <button
          #segment
          type="button"
          role="radio"
          class="btn btn-sm btn-ghost seg"
          [attr.aria-checked]="option.key === value()"
          [tabIndex]="i === activeIndex() ? 0 : -1"
          (click)="value.set(option.key)"
          (keydown)="onKey($event)"
        >
          @if (option.tone; as tone) {
            <span class="dot" aria-hidden="true" [style.background]="color(tone)"></span>
          }
          {{ option.label }}
        </button>
      }
    </div>
  `,
})
export class UiSegmented {
  readonly options = input.required<readonly SegmentedOption[]>();
  readonly value = model<string>();
  /** Accessible name of the radio group (translated). */
  readonly label = input<string>();

  protected readonly color = toneColor;
  private readonly segments = viewChildren<ElementRef<HTMLButtonElement>>('segment');

  protected activeIndex(): number {
    return Math.max(0, this.options().findIndex((o) => o.key === this.value()));
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.options().length;
    const current = this.activeIndex();
    const step = STEP[event.key];
    const next =
      step !== undefined ? (current + step + count) % count : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
    if (next < 0 || count === 0) return;
    event.preventDefault();
    this.value.set(this.options()[next].key);
    this.segments()[next].nativeElement.focus();
  }
}
