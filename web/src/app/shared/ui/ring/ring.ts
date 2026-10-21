import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

let nextId = 0;

/**
 * Circular progress (spec 024 design.md § Fundament: "Ring"): the value stroke
 * with round caps in a lime → cyan gradient (accent → primary) running top left to bottom right, the percentage as real
 * centred text (600, line-height 1: 22 px on the 112 px hero ring, 15 px on the `sm` rings 96 to 52, 11 px
 * on the 40 px row ring) with the `%` as a 12 px / 500 muted `small`, so forced colours and screen readers keep it.
 * The track is `--track` at opacity .45 (spec 024 background decision, principal 2026-10-13);
 * it paints below the 3:1 mark line, and `web/tests/contrast-exceptions.ts` lists the pairs. Value changes morph `stroke-dashoffset` over `--motion-duration-slow` (the morph
 * duration). `null` shows "—" (no specs yet).
 */
@Component({
  selector: 'ui-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--ring-size.px]': 'size()', '[attr.data-size]': 'size()' },
  styleUrl: './ring.css',
  templateUrl: './ring.html',
})
export class UiRing {
  readonly value = input.required<number | null>();
  /** 112 the hero (stroke 10); 88, 72, 64 and 56 the `sm` rings (strokes 8, 7, 6, 6); 96, 52, 40 kept. */
  readonly size = input<112 | 96 | 88 | 72 | 64 | 56 | 52 | 40>(72);
  readonly stroke = input<10 | 8 | 7 | 6>(8);

  protected readonly gradientId = `ui-ring-${nextId++}`;
  protected readonly gradientUrl = `url(#${this.gradientId})`;
  protected readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
  protected readonly centre = computed(() => this.size() / 2);
  protected readonly radius = computed(() => (this.size() - this.stroke()) / 2);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());
  protected readonly percent = computed(() => {
    const value = this.value();
    return value === null ? null : Math.round(Math.min(100, Math.max(0, value)));
  });
  protected readonly offset = computed(() => this.circumference() * (1 - (this.percent() ?? 0) / 100));
}
