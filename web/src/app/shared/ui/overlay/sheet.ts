import { ChangeDetectionStrategy, Component, type ElementRef, input, model, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../button/icon-button';
import { nextId } from './ids';
import { modalDialog } from './modal';

/** The shell's container tier (compact < 640, medium 640–1119, wide ≥ 1120), measured by the shell, not here. */
export type SheetTier = 'compact' | 'medium' | 'wide';

/**
 * A sheet on a native modal `<dialog>`: a bottom sheet at `compact` (full width, at most 75dvh, a grab handle on
 * top), a 480 px side sheet from the inline end at `medium` and `wide`. The tier is an input because container
 * queries live on the shell (web/CLAUDE.md), and the top layer escapes every container; the shell passes its tier.
 *
 * `open` is a two-way model; Esc, a backdrop click and the close button set it to false and focus returns to the
 * opener (modal.ts). Named by `heading` (visible H2 with a close button) or `label`, both translated. A custom grab
 * handle goes in the `[uiSheetHandle]` slot; the default is a decorative 32 × 4 bar. The handle is visual only: no
 * drag gesture is bound to it.
 */
@Component({
  selector: 'ui-sheet',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sheet.css',
  host: {
    '[attr.data-tier]': 'tier()',
    '(keydown.escape)': 'modal.escape($event)',
    '(pointerdown)': 'modal.pointerDown($event)',
    '(click)': 'modal.click($event)',
  },
  template: `
    <dialog
      #dialog
      class="sheet"
      [attr.aria-labelledby]="heading() ? headingId : null"
      [attr.aria-label]="heading() ? null : (label() ?? null)"
      (close)="modal.closed()"
    >
      @if (tier() === 'compact') {
        <div class="grip">
          <ng-content select="[uiSheetHandle]"><span class="handle" aria-hidden="true"></span></ng-content>
        </div>
      }
      @if (heading(); as heading) {
        <div class="head">
          <h2 class="title" [id]="headingId">{{ heading }}</h2>
          <button ui-icon-button icon="x" size="sm" [label]="'common.close' | transloco" (click)="open.set(false)"></button>
        </div>
      }
      <div class="body"><ng-content /></div>
    </dialog>
  `,
})
export class UiSheet {
  readonly open = model(false);
  readonly tier = input<SheetTier>('medium');
  /** Visible title and accessible name (translated). */
  readonly heading = input<string>();
  /** Accessible name when there is no visible heading (translated). */
  readonly label = input<string>();

  protected readonly headingId = nextId('ui-sheet-title');
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly modal = modalDialog(this.open, this.dialog);
}
