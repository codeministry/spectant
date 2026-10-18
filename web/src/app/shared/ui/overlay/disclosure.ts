import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, contentChild, Directive, input, model } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import { nextId } from './ids';

/** Heading levels a disclosure can sit at; `h1` is the page title's alone. */
export type UiDisclosureHeadingLevel = 2 | 3 | 4 | 5 | 6;

/**
 * Marks the element projected into a disclosure's description slot. It renders under the head, outside the toggle
 * button, and stays visible while the disclosure is closed; the button points at it with `aria-describedby`, so it
 * describes the toggle without becoming part of its accessible name. An `id` the consumer sets is kept.
 */
@Directive({
  selector: '[uiDisclosureDescription]',
  host: { '[attr.id]': 'id()' },
})
export class UiDisclosureDescription {
  readonly id = input(nextId('ui-disclosure-description'));
}

/**
 * A disclosure per the ARIA pattern (the Brief "TL;DR", "Show all n", "15 archived specs"): a full-width summary
 * button with `aria-expanded` and `aria-controls`, and a region that opens by animating `grid-template-rows`
 * `0fr → 1fr` on the base motion token (WebKit 17 has no `calc-size()`; design.md § WebKit). Under
 * `prefers-reduced-motion` the token is 0ms (motion.css) and the primitive drops the transition itself, so it opens
 * and closes instantly.
 *
 * Slots: `[uiDisclosureSummary]` goes inside the button next to the rotating chevron; `[uiDisclosureActions]` sits
 * beside the button, outside it (the Brief's copy chip is a button and must not nest in one); the default slot is
 * the content. Collapsed content is `inert` and turns `visibility: hidden` once the rows have closed, so it leaves
 * the tab order and the accessibility tree. `open` is a two-way model, so a consumer can bind it to a query param,
 * and can render heavy content only while it is open (`@if (fold.open())`).
 *
 * Optional, for a document section: `headingLevel` (2 to 6) wraps the toggle button in a heading of that level, so
 * the section stays reachable through heading navigation and the heading text is the button's name; the
 * `[uiDisclosureDescription]` slot (import `UiDisclosureDescription`) sits under the head, outside the button and
 * outside the region. Without either, the markup is the one the disclosure always rendered.
 */
@Component({
  selector: 'ui-disclosure',
  imports: [UiIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './disclosure.css',
  host: {
    '[attr.data-open]': "open() ? '' : null",
  },
  template: `
    <div class="head">
      @switch (headingLevel()) {
        @case (2) {
          <h2 class="heading"><ng-container [ngTemplateOutlet]="toggle" /></h2>
        }
        @case (3) {
          <h3 class="heading"><ng-container [ngTemplateOutlet]="toggle" /></h3>
        }
        @case (4) {
          <h4 class="heading"><ng-container [ngTemplateOutlet]="toggle" /></h4>
        }
        @case (5) {
          <h5 class="heading"><ng-container [ngTemplateOutlet]="toggle" /></h5>
        }
        @case (6) {
          <h6 class="heading"><ng-container [ngTemplateOutlet]="toggle" /></h6>
        }
        @default {
          <ng-container [ngTemplateOutlet]="toggle" />
        }
      }
      <ng-content select="[uiDisclosureActions]" />
    </div>
    <ng-content select="[uiDisclosureDescription]" />
    <div class="region" [id]="regionId" [attr.inert]="open() ? null : ''">
      <div class="content"><ng-content /></div>
    </div>
    <ng-template #toggle>
      <button
        type="button"
        class="summary"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="regionId"
        [attr.aria-describedby]="description()?.id() ?? null"
        (click)="open.set(!open())"
      >
        <ui-icon class="chevron" name="chevron-down" [size]="16" />
        <ng-content select="[uiDisclosureSummary]" />
        @if (count() !== null) {
          <span class="badge badge-sm count">{{ count() }}</span>
        }
      </button>
    </ng-template>
  `,
})
export class UiDisclosure {
  readonly open = model(false);
  /** Optional count shown at the end of the summary row ("Probe", "Contents", a claim group), inside the button. */
  readonly count = input<number | null>(null);
  /** Optional heading level the toggle button sits in; `null` keeps the plain button head. */
  readonly headingLevel = input<UiDisclosureHeadingLevel | null>(null);

  protected readonly description = contentChild(UiDisclosureDescription);
  protected readonly regionId = nextId('ui-disclosure');
}
