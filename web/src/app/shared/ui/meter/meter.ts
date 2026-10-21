import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Tone, toneColor } from '../tone';

export interface MeterSegment {
  readonly key: string;
  readonly count: number;
  readonly tone: Tone;
}

/**
 * A bar meter, the prototype's `[data-ui="meter"]` (spec 024 design.md § Fundament: "Meter"): single (`value / max`;
 * the fill is solid cyan, lime once the meter is full, or a tone, and morphs `transform` only) or split (proportional
 * `segments` with 2 px gaps on no track, each segment rounded 3 px, e.g. specs per phase). 6 px tall, 4 px `mini` (the
 * prototype's `thin`), 8 px `lg` (`size`; the `mini` boolean stays and wins), radius 3. The track is the
 * prototype's `--track` mixed 45 % into transparent (spec 024: prototype background (principal 2026-10-13)); it paints
 * below the 3:1 mark line, and `web/tests/contrast-exceptions.ts` lists the pairs. Pass `label` (translated): it names the meter for assistive technology, and
 * `valueText` (translated, single mode only) for `aria-valuetext`, e.g. "3 of 4 claims closed".
 *
 * Two hooks let a surface that the default look fails restyle a single meter (spec 037, ISC-193.1: the milestone
 * header on `--disp-t`): `--ui-meter-track` replaces the track, `--ui-meter-fill` the fill, the full state included.
 * Unset, each falls back to the look above. A `tone` still wins over `--ui-meter-fill`, and split mode keeps no track.
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
    '[attr.aria-valuetext]': 'segments() ? null : (valueText() ?? null)',
    '[attr.data-size]': 'effectiveSize() === "default" ? null : effectiveSize()',
    '[attr.data-mini]': 'effectiveSize() === "mini" ? "" : null',
    '[attr.data-split]': 'segments() ? "" : null',
    '[attr.data-full]': '!segments() && !tone() && full() ? "" : null',
  },
  styleUrl: './meter.css',
  templateUrl: './meter.html',
})
export class UiMeter {
  readonly value = input(0);
  readonly max = input(100);
  readonly segments = input<readonly MeterSegment[]>();
  readonly tone = input<Tone>();
  readonly mini = input(false);
  readonly size = input<'default' | 'mini' | 'lg'>('default');
  readonly valueText = input<string | null>(null);
  readonly label = input<string>();

  protected readonly color = toneColor;
  protected readonly effectiveSize = computed(() => (this.mini() ? 'mini' : this.size()));
  protected readonly fillColor = computed(() => {
    const tone = this.tone();
    return tone ? toneColor(tone) : null;
  });
  private readonly ratio = computed(() => {
    const max = this.max();
    return max > 0 ? Math.min(1, Math.max(0, this.value() / max)) : 0;
  });
  /** The prototype's `lime` fill: a meter whose value reached its max. */
  protected readonly full = computed(() => this.ratio() === 1);
  protected readonly transform = computed(() => `scaleX(${this.ratio()})`);
}
