import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type StageState = 'done' | 'current' | 'pending';

/**
 * The five-stage track (Plan · Tasks · Review · Build · Close): done segments in the accent, the current one in the
 * primary with a bold label, pending ones in `--track`. `mini` is 16 × 4 px segments without labels, named as one
 * image; `labelled` is an ordered list with `aria-current="step"`, 60 px minimum per segment so "Abschluss" fits.
 *
 * TODO(T23): `labels` and the default `ariaLabel` come from Transloco (`stages.*`, a "Stage n of m: x" key) once T23
 * lands; until then the consumer passes translated labels and the English fallback below names the mini track.
 */
@Component({
  selector: 'ui-stage-track',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-inline-size: 0; }
    .mini { display: inline-flex; gap: 2px; vertical-align: middle; }
    .mini .bar { inline-size: 16px; }
    .bar { display: block; block-size: 4px; border-radius: 999px; background: var(--track); }
    [data-state='done'] > .bar, .bar[data-state='done'] { background: var(--color-accent); }
    [data-state='current'] > .bar, .bar[data-state='current'] { background: var(--color-primary); }
    ol { display: grid; grid-auto-columns: minmax(60px, 1fr); grid-auto-flow: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
    li { display: grid; gap: 4px; min-inline-size: 0; }
    .label { overflow: hidden; color: var(--muted-ink); font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
    [data-state='current'] > .label { color: var(--color-base-content); font-weight: 700; }
    @media (forced-colors: active) {
      .bar { border: 1px solid CanvasText; }
      [data-state='done'] > .bar, .bar[data-state='done'], [data-state='current'] > .bar, .bar[data-state='current'] { background: CanvasText; }
    }
  `,
  template: `
    @if (size() === 'mini') {
      <span class="mini" role="img" [attr.aria-label]="name()">
        @for (label of labels(); track $index) {
          <span class="bar" [attr.data-state]="state($index)"></span>
        }
      </span>
    } @else {
      <ol [attr.aria-label]="name()">
        @for (label of labels(); track $index) {
          <li [attr.data-state]="state($index)" [attr.aria-current]="$index === current() ? 'step' : null">
            <span class="bar"></span>
            <span class="label">{{ label }}</span>
          </li>
        }
      </ol>
    }
  `,
})
export class UiStageTrack {
  readonly labels = input.required<readonly string[]>();
  /** Zero-based index of the current stage; `labels().length` means every stage is done. */
  readonly current = input.required<number>();
  readonly size = input<'mini' | 'labelled'>('mini');
  readonly ariaLabel = input<string>();

  protected readonly name = computed(() => {
    const labels = this.labels();
    const index = Math.min(this.current(), labels.length - 1);
    return this.ariaLabel() ?? `Stage ${index + 1} of ${labels.length}: ${labels[index] ?? ''}`;
  });

  protected state(index: number): StageState {
    const current = this.current();
    return index < current ? 'done' : index === current ? 'current' : 'pending';
  }
}
