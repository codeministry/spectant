import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../button/icon-button';

/**
 * The heading row of `ui-dialog` and `ui-sheet`: the H2 that names the modal and its close button. Attribute-style
 * on the overlay's own `<div class="head">`, so the row adds no element; the overlay keeps the row's layout (`.head`)
 * and sets `open` to false on `dismiss`.
 */
@Component({
  // Attribute-style on purpose: the overlay's `.head` row is the host, so the DOM keeps its shape.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'div[ui-overlay-head]',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './overlay-head.css',
  templateUrl: './overlay-head.html',
})
export class UiOverlayHead {
  /** Visible title and accessible name of the overlay (translated). */
  readonly heading = input.required<string>();
  /** The H2's id, which the overlay's `aria-labelledby` names. */
  readonly headingId = input.required<string>();
  /** The close button was pressed. */
  readonly dismiss = output();
}
