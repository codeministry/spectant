import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../button/icon-button';
import { type NoticeTone, UiNotice } from '../notice/notice';
import { elapsedText } from '../item-state/duration';
import { UiReason } from '../reason/reason';
import { type BacklogRefusal, type BoardRefusal, isBacklogRefusal, type Refusal } from './refusal';

/**
 * Why a write did not land: a persistent `ui-notice` directly under the card, row or band head, never a toast, because
 * it must stay until it is read. Shared since spec 037 (T21): the board's drops (spec 008) and the backlog writes of
 * the tree lens and the board's feature swimlanes (spec 037) are its two consumers.
 *
 * A board drop (spec 008, T126, ISC-130; design 008 § Drag, Drop und die Alternativen):
 * - 422 (`refused`): "Not moved — 008 cannot enter Build", then `ui-reason` with core's phrase exactly as the server
 *   sent it and the missing command as a copyable `ui-command-chip` when core names one.
 * - 423 (`locked`): the same head, the lock's session and claim as the reason.
 * - 409 (`stale`): "008 changed on disk · the board refreshed"; the page has reloaded the planning tree.
 * - anything else (`failed`): the head and the status.
 * - T128, an allocation's 422 (`unallocated`): "Not allocated — slug stays an idea", then the reason from the catalog
 *   (`not-in-index`, or `folder-exists` naming the folder).
 * - Spec 040 (T59, ISC-225.1), a running run on the item (`run-locked`): the one line "Not moved — 003 is running:
 *   /spec tasks 003 · a:claude:sess-32 · since 8 min" (`itemState.refusal`), whether the card's state refused the move
 *   before anything was sent (drag, keys, "Move to…") or the write answered 423 `run-locked`. "Move to…" shows the
 *   same notice above its disabled entries, without the ✕ (`dismissible` false).
 *
 * A backlog write (spec 037, ISC-198; design 037 § Ablehnung): the head "F8 not moved" or "Priority of F8 not changed",
 * then `ui-reason` with core's phrase verbatim (422, `refused`), "changed on disk · re-read" (409, `stale`) or the
 * status, "no answer" for 0 (`failed`). The host carries `data-op` for these only.
 *
 * The refusals of the workflow and the lock use the fail tone (an `alert`, so the reason is announced assertively);
 * the 409, which the reload already answered, the warning tone (a polite `status`). The ✕ emits `closed`; the board
 * also drops the notice once the card stands anywhere else or is lifted again (`BoardDrag.refusalOf`, `start`), and
 * the backlog writer once the next write of that feature is sent (`BacklogWriter.refusalOf`).
 */
@Component({
  selector: 'app-refusal-notice',
  imports: [TranslocoPipe, UiIconButton, UiNotice, UiReason],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-refusal]': 'refusal().kind', '[attr.data-op]': 'backlog()?.op ?? null' },
  styleUrl: './refusal-notice.css',
  templateUrl: './refusal-notice.html',
})
export class RefusalNotice {
  readonly refusal = input.required<Refusal>();
  /** False where the notice lasts as long as its cause and has no ✕: "Move to…" of a running card (spec 040, T58). */
  readonly dismissible = input(true);
  /** The ✕: the board or the backlog writer forgets the refusal. */
  readonly closed = output();

  protected readonly backlog = computed<BacklogRefusal | null>(() => {
    const r = this.refusal();
    return isBacklogRefusal(r) ? r : null;
  });

  protected readonly board = computed<BoardRefusal | null>(() => {
    const r = this.refusal();
    return isBacklogRefusal(r) ? null : r;
  });

  /** The placeholder for a detail the run's source does not name. */
  protected readonly none = '—';

  /** How long the refusing run has run (`elapsedText`); null when the refusal carries no duration. */
  protected readonly duration = computed(() => {
    const r = this.board();
    return r?.kind === 'run-locked' && r.elapsedMs !== null ? elapsedText(r.elapsedMs) : null;
  });

  protected readonly tone = computed<NoticeTone>(() => (this.refusal().kind === 'stale' ? 'warning' : 'error'));
}
