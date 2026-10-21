import { ChangeDetectionStrategy, Component, computed, inject, input, output, resource } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { writePathsOf } from '../../../../../server/src/contracts/writes.contract';
import { ApiClient } from '../../core/api.service';
import { UiButton } from '../../shared/ui/button/button';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { BoardDrag } from './board-drag';

/**
 * The number part of the folder before it is written: core picks the next free number only when it allocates
 * (`allocationOf`), and the API offers no preview. The same placeholder the write contract's `WRITE_PATHS` uses.
 */
const NUMBER = 'NNN';

/**
 * The confirmation before a story becomes a spec (spec 008, T128, ISC-130.2; design 008 § Ideen-Zuteilung): a story
 * dropped on the first stage of its type, or that stage chosen in "Move to…" or reached with Shift+→, sets
 * `BoardDrag.allocating`, and this native `<dialog>` (`ui-dialog`) names what the write will do, from the contract's
 * own `WRITE_PATHS.allocate`: the folder it creates (`specs/NNN-slug/`, the number core's, with the "next free number"
 * note), the files it writes there and the story file it removes.
 *
 * The story file's raw hash (`IdeaPage.hash`) is read when the dialog opens; Allocate stays unavailable until it is.
 * Allocate sends `BoardDrag.allocate` once and, on 200, opens the new spec (`/w/:ws/s/:id`); any refusal (422 with
 * its reason, 409, which reloads the board, 423) closes the dialog and leaves the notice under the story's card.
 * Not yet, ✕, Esc and a backdrop click close it and send nothing. `closed` names the card whose grip takes focus.
 */
@Component({
  selector: 'app-allocate-dialog',
  imports: [TranslocoPipe, UiButton, UiDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './allocate-dialog.css',
  templateUrl: './allocate-dialog.html',
})
export class AllocateDialog {
  /** The workspace slug the story lives in. */
  readonly ws = input.required<string>();
  /** The dialog closed without opening a new spec: the key of the card whose grip takes focus. */
  readonly closed = output<string>();

  private readonly drag = inject(BoardDrag);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);

  protected readonly card = this.drag.allocating;
  protected readonly saving = computed(() => {
    const card = this.card();
    return card !== null && this.drag.saving() === card.key;
  });

  /** What the write touches, from `WRITE_PATHS.allocate` with the number left open. */
  protected readonly paths = computed(() => {
    const card = this.card();
    const slug = card?.slug ?? '';
    const paths = writePathsOf('allocate', `${NUMBER}-${slug}`, slug);
    const folder = paths.creates ?? '';
    return {
      folder,
      files: paths.writes.map((path) => (path.startsWith(folder) ? path.slice(folder.length) : path)),
      story: card?.path ?? paths.removes.join(', '),
    };
  });

  /** The story as the server reads it now; its `hash` is what the allocation sends. */
  private readonly story = resource({
    params: () => {
      const card = this.card();
      return card === null ? undefined : { ws: this.ws(), slug: card.slug };
    },
    loader: ({ params }) => this.api.idea(params.ws, params.slug),
  });

  protected readonly hash = computed(() => {
    const read = this.story.value();
    const card = this.card();
    return read?.kind === 'ok' && read.body.idea.slug === card?.slug ? read.body.hash : null;
  });

  protected readonly unreadable = computed(() => {
    const read = this.story.value();
    return read !== undefined && read.kind !== 'ok';
  });

  protected onOpenChange(open: boolean): void {
    if (!open) this.cancel();
  }

  protected cancel(): void {
    const card = this.card();
    if (card === null) return;
    this.drag.allocating.set(null);
    this.closed.emit(card.key);
  }

  protected async confirm(): Promise<void> {
    const card = this.card();
    const hash = this.hash();
    if (card === null || hash === null || this.drag.saving() !== null) return;
    const written = await this.drag.allocate(this.ws(), card, hash);
    this.drag.allocating.set(null);
    if (written === null) {
      this.closed.emit(card.key);
      return;
    }
    await this.router.navigate(['/w', this.ws(), 's', written.id]);
  }
}
