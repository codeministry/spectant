import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../button/icon-button';
import { type NoticeTone, UiNotice } from '../notice/notice';
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
  styles: `
    :host { display: block; margin-block-start: 8px; }
    ui-notice { align-items: flex-start; padding-inline-end: 4px; }
    .body { display: grid; gap: 4px; min-inline-size: 0; }
    .head { margin: 0; color: var(--color-base-content); font-size: 13px; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
    ui-reason { --reason-ink: var(--color-base-content); }
  `,
  template: `
    <ui-notice [tone]="tone()" icon="circle-alert">
      <div class="body">
        @if (backlog(); as b) {
          <p class="head" data-head>{{ (b.op === 'move' ? 'backlog.refusal.notMoved' : 'backlog.refusal.notPrioritized') | transloco: { id: b.feature } }}</p>
          @switch (b.kind) {
            @case ('refused') {
              <ui-reason [block]="true" [phrase]="b.reason" />
            }
            @case ('stale') {
              <ui-reason [block]="true" [phrase]="'backlog.refusal.stale' | transloco" />
            }
            @case ('failed') {
              <ui-reason [block]="true" [phrase]="b.status === 0 ? ('backlog.refusal.noAnswer' | transloco) : ('backlog.refusal.failed' | transloco: { status: b.status })" />
            }
          }
        } @else if (board(); as r) {
          @let stage = 'stages.' + r.to | transloco;
          @if (r.kind === 'unallocated') {
            <p class="head" data-head>{{ 'board.workspace.allocate.notAllocated' | transloco: { slug: r.id } }}</p>
          } @else if (r.kind !== 'stale') {
            <p class="head" data-head>{{ 'board.workspace.refusal.notMoved' | transloco: { id: r.id, stage } }}</p>
          }
          @switch (r.kind) {
            @case ('unallocated') {
              <ui-reason
                [block]="true"
                [phrase]="(r.reason === 'folder-exists' ? 'board.workspace.allocate.refused.folderExists' : 'board.workspace.allocate.refused.notInIndex') | transloco: { slug: r.id, folder: r.folder ?? '' }"
              />
            }
            @case ('refused') {
              <ui-reason [block]="true" [phrase]="r.reason" [command]="r.command" />
            }
            @case ('locked') {
              <ui-reason [block]="true" [phrase]="'board.workspace.refusal.lock' | transloco: { actor: r.session, claim: r.claim }" />
            }
            @case ('stale') {
              <ui-reason [block]="true" [phrase]="'board.workspace.refusal.refreshed' | transloco: { id: r.id }" />
            }
            @case ('failed') {
              <ui-reason [block]="true" [phrase]="'board.workspace.refusal.failed' | transloco: { status: r.status }" />
            }
          }
        }
      </div>
      <button
        action
        ui-icon-button
        icon="x"
        data-dismiss
        [label]="'board.workspace.refusal.dismiss' | transloco"
        (click)="closed.emit()"
      ></button>
    </ui-notice>
  `,
})
export class RefusalNotice {
  readonly refusal = input.required<Refusal>();
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

  protected readonly tone = computed<NoticeTone>(() => (this.refusal().kind === 'stale' ? 'warning' : 'error'));
}
