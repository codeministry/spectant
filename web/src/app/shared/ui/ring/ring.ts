import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

let nextId = 0;

/**
 * Circular progress, the prototype's `[data-ui="ring"]` (spec 024 design.md § Fundament: "Ring"): the value stroke
 * with round caps in a lime → cyan gradient (accent → primary) running top left to bottom right, the percentage as real
 * centred text (600, line-height 1: 22 px on the 112 px hero ring, 15 px on the prototype's `sm` rings 96 to 52, 11 px
 * on the 40 px row ring) with the `%` as a 12 px / 500 muted `small`, so forced colours and screen readers keep it.
 * The track is the full `--track`, not the prototype's 45 % opacity: at .45 it paints about 1.6:1 and the mark rule
 * (ISC-65, 3:1) holds it. Value changes morph `stroke-dashoffset` over `--motion-duration-slow` (the prototype's
 * `--dur-morph`). `null` shows "—" (no specs yet).
 */
@Component({
  selector: 'ui-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--ring-size.px]': 'size()', '[attr.data-size]': 'size()' },
  styles: `
    :host { display: inline-grid; flex-shrink: 0; place-items: center; inline-size: var(--ring-size); block-size: var(--ring-size); }
    svg { grid-area: 1 / 1; transform: rotate(-90deg); }
    .track { fill: none; stroke: var(--track); }
    .bar { fill: none; transition: stroke-dashoffset var(--motion-duration-slow) var(--motion-ease-standard); }
    .from { stop-color: var(--color-accent); }
    .to { stop-color: var(--color-primary); }
    .text { grid-area: 1 / 1; font-size: 15px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 1; }
    .unit { color: var(--muted-ink); font-size: 12px; font-weight: 500; }
    :host([data-size='112']) .text { font-size: 22px; }
    :host([data-size='40']) .text { font-size: 11px; }
    :host([data-size='40']) .unit { font-size: 0.75em; }
    @media (forced-colors: active) {
      .bar { stroke: CanvasText; }
      .track { stroke: GrayText; }
    }
  `,
  template: `
    <svg data-icon-exempt aria-hidden="true" focusable="false" [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="viewBox()">
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" class="from" />
          <stop offset="1" class="to" />
        </linearGradient>
      </defs>
      <circle class="track" [attr.cx]="centre()" [attr.cy]="centre()" [attr.r]="radius()" [attr.stroke-width]="stroke()" />
      <circle
        class="bar"
        stroke-linecap="round"
        [attr.cx]="centre()"
        [attr.cy]="centre()"
        [attr.r]="radius()"
        [attr.stroke-width]="stroke()"
        [attr.stroke]="gradientUrl"
        [attr.stroke-dasharray]="circumference()"
        [style.stroke-dashoffset]="offset()"
      />
    </svg>
    <span class="text">
      @if (percent() === null) {
        —
      } @else {
        {{ percent() }}<span class="unit">%</span>
      }
    </span>
  `,
})
export class UiRing {
  readonly value = input.required<number | null>();
  /** 112 the hero (stroke 10); 88, 72, 64 and 56 the prototype's `sm` rings (strokes 8, 7, 6, 6); 96, 52, 40 kept. */
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
