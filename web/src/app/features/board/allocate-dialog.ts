import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { BoardCard } from '../../core/model/board-types';
import { UiButton } from '../../shared/ui/button/button';
import { UiDialog } from '../../shared/ui/overlay/dialog';

/** What the allocation writes, from the write contract's `WRITE_PATHS.allocate` with the number left open. */
export interface AllocatePaths {
  /** The folder it creates (`specs/NNN-slug/`). */
  readonly folder: string;
  /** The files it writes there, relative to the folder. */
  readonly files: readonly string[];
  /** The story file it removes. */
  readonly story: string;
}

/**
 * The confirmation before a story becomes a spec (spec 008, T128, ISC-130.2; design 008 § Ideen-Zuteilung): a story
 * dropped on the first stage of its type, or that stage chosen in "Move to…" or reached with Shift+→, sets
 * `BoardDrag.allocating`, and this native `<dialog>` (`ui-dialog`) names what the write will do, from the contract's
 * own `WRITE_PATHS.allocate`: the folder it creates (`specs/NNN-slug/`, the number core's, with the "next free number"
 * note), the files it writes there and the story file it removes.
 *
 * The board's store reads the story file's raw hash (`IdeaPage.hash`) when the dialog opens and owns the write (spec
 * 061, ISC-437): the dialog shows `card`, `paths`, `hash`, `saving` and `unreadable` and emits `confirm` and `dismiss`.
 * Allocate stays unavailable until the hash is read. Allocate sends `BoardDrag.allocate` once and, on 200, opens the
 * new spec (`/w/:ws/s/:id`); any refusal (422 with its reason, 409, which reloads the board, 423) closes the dialog and
 * leaves the notice under the story's card. Not yet, ✕, Esc and a backdrop click close it and send nothing.
 */
@Component({
  selector: 'app-allocate-dialog',
  imports: [TranslocoPipe, UiButton, UiDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './allocate-dialog.css',
  templateUrl: './allocate-dialog.html',
})
export class AllocateDialog {
  /** The story being allocated; null while the dialog is closed. */
  readonly card = input.required<BoardCard | null>();
  /** What the write touches. */
  readonly paths = input.required<AllocatePaths>();
  /** The story file's hash as the server reads it now; null until it is read. */
  readonly hash = input.required<string | null>();
  /** True while the allocation is in flight. */
  readonly saving = input.required<boolean>();
  /** True when the story file could not be read. */
  readonly unreadable = input.required<boolean>();
  /** Allocate was pressed. */
  readonly confirm = output();
  /** Not yet, ✕, Esc or a backdrop click: the dialog closes and nothing is sent. */
  readonly dismiss = output();

  protected onOpenChange(open: boolean): void {
    if (!open) this.dismiss.emit();
  }
}
