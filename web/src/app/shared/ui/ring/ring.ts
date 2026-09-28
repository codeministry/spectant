import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

let nextId = 0;

/**
 * Circular progress (design.md § KPI band): the unfilled track in `--track`, the value stroke as a lime → cyan
 * gradient (accent → primary), the percentage as real centred text so forced colours and screen readers keep it.
 * Value changes morph `stroke-dashoffset` over `--motion-duration-slow`. `null` shows "—" (no specs yet).
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
    .text { grid-area: 1 / 1; font-size: 11px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 16px; }
    .unit { margin-inline-start: 0.1em; color: var(--muted-ink); font-size: 0.75em; }
    :host([data-size='112']) .text { font-size: 20px; line-height: 28px; }
    :host([data-size='72']) .text { font-size: 15px; line-height: 20px; }
    :host([data-size='52']) .text { font-size: 13px; line-height: 16px; }
    @media (forced-colors: active) {
      .bar { stroke: CanvasText; }
      .track { stroke: GrayText; }
    }
  `,
  template: `
    <svg data-icon-exempt aria-hidden="true" focusable="false" [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="viewBox()">
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0" y1="1" x2="1" y2="0">
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
  readonly size = input<112 | 72 | 52 | 40>(72);
  readonly stroke = input<10 | 8 | 6>(8);

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
