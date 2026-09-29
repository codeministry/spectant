import { ChangeDetectionStrategy, Component, type ElementRef, input, model, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../button/icon-button';
import { nextId } from './ids';
import { modalDialog } from './modal';

/**
 * A centred modal on a native `<dialog>` (`showModal()`): `min(480px, 100% - 32px)` wide, backdrop 40 % black with
 * `blur(4px)`, entry at the base duration with the emphasized ease. `open` is a two-way model; Esc, a backdrop click
 * and the close button set it to false, and focus returns to the element that opened it (modal.ts).
 *
 * Named by `heading` (rendered as the H2 with a close button) or, without a visible heading, by `label` (the
 * command palette). Both must be translated strings. Consumers size and place it through custom properties on the
 * host: `--ui-dialog-size` (default 480px), `--ui-dialog-top` (default centred; the palette uses 96px) and
 * `--ui-dialog-padding` (default 24px).
 */
@Component({
  selector: 'ui-dialog',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dialog.css',
  host: {
    '(keydown.escape)': 'modal.escape($event)',
    '(pointerdown)': 'modal.pointerDown($event)',
    '(click)': 'modal.click($event)',
  },
  template: `
    <dialog
      #dialog
      class="dialog"
      [attr.aria-labelledby]="heading() ? headingId : null"
      [attr.aria-label]="heading() ? null : (label() ?? null)"
      (close)="modal.closed()"
    >
      <div class="body">
        @if (heading(); as heading) {
          <header class="head">
            <h2 class="title" [id]="headingId">{{ heading }}</h2>
            <button ui-icon-button icon="x" size="sm" [label]="'common.close' | transloco" (click)="open.set(false)"></button>
          </header>
        }
        <ng-content />
      </div>
    </dialog>
  `,
})
export class UiDialog {
  readonly open = model(false);
  /** Visible title and accessible name (translated). */
  readonly heading = input<string>();
  /** Accessible name when there is no visible heading (translated). */
  readonly label = input<string>();

  protected readonly headingId = nextId('ui-dialog-title');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly modal = modalDialog(this.open, this.dialog);
}
