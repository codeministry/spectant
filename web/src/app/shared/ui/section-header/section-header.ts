import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Eyebrow + title header with a meta slot (`[meta]`, e.g. "6 · 15 archived") and an actions slot (`[actions]`). The
 * heading wears the prototype's `.section-head` (spec 024, ISC-148): 600 16/24, a baseline flex row with an 8 px gap,
 * no minimum height and 16 px below;
 * the count (`.meta`) sits 8 px behind the title on its baseline but outside the heading, so the heading's accessible
 * name stays the title alone.
 * The heading takes `tabindex="-1"` so the `g` sequences can move focus to it (DS-APP-35). The title input is named
 * `heading`, not `title`, so it never becomes the host's native tooltip.
 */
@Component({
  selector: 'ui-section-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './section-header.css',
  templateUrl: './section-header.html',
})
export class UiSectionHeader {
  readonly heading = input.required<string>();
  readonly eyebrow = input<string>();
  readonly level = input<2 | 3>(2);
  readonly headingId = input<string>();
}
