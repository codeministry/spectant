import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Tone, toneColor, toneInk, toneTint } from '../tone';

/** A 24 px pill (phase, type, "stale", "takeable ISC-334"): tinted background, ink text, optional accent dot. */
@Component({
  selector: 'ui-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-tone]': 'tone()',
    '[style.--chip-color]': 'colors().color',
    '[style.--chip-tint]': 'colors().tint',
    '[style.--chip-ink]': 'colors().ink',
  },
  styles: `
    :host { display: inline-flex; gap: 6px; align-items: center; block-size: 24px; padding-inline: 8px; border-radius: 999px; background: var(--chip-tint); color: var(--chip-ink); font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 500; line-height: 16px; white-space: nowrap; }
    .dot { inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--chip-color); }
    @media (forced-colors: active) {
      :host { border: 1px solid CanvasText; }
      .dot { background: CanvasText; }
    }
  `,
  template: `
    @if (dot()) {
      <span class="dot" aria-hidden="true"></span>
    }
    <ng-content />
  `,
})
export class UiChip {
  readonly tone = input<Tone>('neutral');
  readonly dot = input(false);

  protected readonly colors = computed(() => {
    const tone = this.tone();
    return { color: toneColor(tone), tint: toneTint(tone), ink: toneInk(tone) };
  });
}
