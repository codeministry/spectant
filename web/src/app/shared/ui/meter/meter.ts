import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Tone, toneColor } from '../tone';

export interface MeterSegment {
  readonly key: string;
  readonly count: number;
  readonly tone: Tone;
}

/**
 * A bar meter (design.md § KPI band, spec rows): single (`value / max`; the fill is a lime → cyan gradient or a
 * tone and morphs `transform` only) or split (proportional `segments`, e.g. specs per phase). 6 px tall, 4 px `mini`,
 * track in `--track`, fully rounded. Pass `label` (translated): it names the meter for assistive technology.
 */
@Component({
  selector: 'ui-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'segments() ? "img" : "meter"',
    '[attr.aria-label]': 'label() ?? null',
    '[attr.aria-valuenow]': 'segments() ? null : value()',
    '[attr.aria-valuemin]': 'segments() ? null : 0',
    '[attr.aria-valuemax]': 'segments() ? null : max()',
    '[attr.data-mini]': 'mini() ? "" : null',
    '[attr.data-split]': 'segments() ? "" : null',
  },
  styles: `
    :host { display: flex; overflow: hidden; min-inline-size: 0; block-size: 6px; border-radius: 999px; background: var(--track); }
    :host([data-mini]) { block-size: 4px; }
    :host([data-split]) { gap: 2px; }
    .fill { flex: 1; background: linear-gradient(90deg, var(--color-accent), var(--color-primary)); transform-origin: left center; transition: transform var(--motion-duration-slow) var(--motion-ease-standard); }
    .seg { min-inline-size: 0; }
    @media (forced-colors: active) {
      :host { border: 1px solid CanvasText; }
      .fill, .seg { background: CanvasText; }
    }
  `,
  template: `
    @if (segments(); as parts) {
      @for (part of parts; track part.key) {
        <span class="seg" [style.flex-grow]="part.count" [style.background]="color(part.tone)"></span>
      }
    } @else {
      <span class="fill" [style.transform]="transform()" [style.background]="fillColor()"></span>
    }
  `,
})
export class UiMeter {
  readonly value = input(0);
  readonly max = input(100);
  readonly segments = input<readonly MeterSegment[]>();
  readonly tone = input<Tone>();
  readonly mini = input(false);
  readonly label = input<string>();

  protected readonly color = toneColor;
  protected readonly fillColor = computed(() => {
    const tone = this.tone();
    return tone ? toneColor(tone) : null;
  });
  protected readonly transform = computed(() => {
    const max = this.max();
    const ratio = max > 0 ? Math.min(1, Math.max(0, this.value() / max)) : 0;
    return `scaleX(${ratio})`;
  });
}
