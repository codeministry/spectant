import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import { nextId } from './ids';

/**
 * A disclosure per the ARIA pattern (the Brief "TL;DR", "Show all n", "15 archived specs"): a full-width summary
 * button with `aria-expanded` and `aria-controls`, and a region that opens by animating `grid-template-rows`
 * `0fr → 1fr` on the base motion token (WebKit 17 has no `calc-size()`; design.md § WebKit). Under
 * `prefers-reduced-motion` the token is 0ms (motion.css), so it opens and closes instantly.
 *
 * Slots: `[uiDisclosureSummary]` goes inside the button next to the rotating chevron; `[uiDisclosureActions]` sits
 * beside the button, outside it (the Brief's copy chip is a button and must not nest in one); the default slot is
 * the content. Collapsed content is `inert` and turns `visibility: hidden` once the rows have closed, so it leaves
 * the tab order and the accessibility tree. `open` is a two-way model, so a consumer can bind it to a query param,
 * and can render heavy content only while it is open (`@if (fold.open())`).
 */
@Component({
  selector: 'ui-disclosure',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './disclosure.css',
  host: {
    '[attr.data-open]': "open() ? '' : null",
  },
  template: `
    <div class="head">
      <button type="button" class="summary" [attr.aria-expanded]="open()" [attr.aria-controls]="regionId" (click)="open.set(!open())">
        <ui-icon class="chevron" name="chevron-down" [size]="16" />
        <ng-content select="[uiDisclosureSummary]" />
      </button>
      <ng-content select="[uiDisclosureActions]" />
    </div>
    <div class="region" [id]="regionId" [attr.inert]="open() ? null : ''">
      <div class="content"><ng-content /></div>
    </div>
  `,
})
export class UiDisclosure {
  readonly open = model(false);

  protected readonly regionId = nextId('ui-disclosure');
}
