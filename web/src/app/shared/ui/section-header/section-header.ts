import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Eyebrow + title header with a meta slot (`[meta]`, e.g. "6 · 15 archived") and an actions slot (`[actions]`). The
 * heading wears the prototype's `.section-head` (spec 024, ISC-148): 600 16/24, a baseline flex row with an 8 px gap;
 * the count (`.meta`) sits 8 px behind the title on its baseline but outside the heading, so the heading's accessible
 * name stays the title alone.
 * The heading takes `tabindex="-1"` so the `g` sequences can move focus to it (DS-APP-35). The title input is named
 * `heading`, not `title`, so it never becomes the host's native tooltip.
 */
@Component({
  selector: 'ui-section-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-block-size: 48px; }
    .text { flex: 0 1 auto; min-inline-size: 0; }
    .text, .meta { align-self: last baseline; }
    .title { display: flex; gap: 8px; align-items: baseline; min-inline-size: 0; }
    .heading-text { overflow: hidden; min-inline-size: 0; text-overflow: ellipsis; white-space: nowrap; }
    .eyebrow { margin: 0; color: var(--muted-ink); font-size: 11px; font-weight: 600; line-height: 16px; letter-spacing: 0.08em; text-transform: uppercase; }
    .title { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; }
    .meta { flex: none; color: var(--muted-ink); font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 400; line-height: 16px; }
    .meta:empty, .actions:empty { display: none; }
    .actions { display: flex; gap: 8px; align-items: center; margin-inline-start: auto; }
  `,
  template: `
    <div class="text">
      @if (eyebrow()) {
        <p class="eyebrow">{{ eyebrow() }}</p>
      }
      @if (level() === 2) {
        <h2 class="title" tabindex="-1" [attr.id]="headingId() ?? null"><span class="heading-text">{{ heading() }}</span></h2>
      } @else {
        <h3 class="title" tabindex="-1" [attr.id]="headingId() ?? null"><span class="heading-text">{{ heading() }}</span></h3>
      }
    </div>
    <div class="meta"><ng-content select="[meta]" /></div>
    <div class="actions"><ng-content select="[actions]" /></div>
  `,
})
export class UiSectionHeader {
  readonly heading = input.required<string>();
  readonly eyebrow = input<string>();
  readonly level = input<2 | 3>(2);
  readonly headingId = input<string>();
}
