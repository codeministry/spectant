import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { type NoticeTone, UiNotice } from '../../shared/ui/notice/notice';
import { UiReason } from '../../shared/ui/reason/reason';
import type { BoardRefusal } from './board-drag';

/**
 * Why a drop did not move its card (spec 008, T126, ISC-130; design 008 § Drag, Drop und die Alternativen): a
 * persistent `ui-notice` directly under the card, never a toast, because it must stay until it is read.
 *
 * - 422 (`refused`): "Not moved — 008 cannot enter Build", then `ui-reason` with core's phrase exactly as the server
 *   sent it and the missing command as a copyable `ui-command-chip` when core names one.
 * - 423 (`locked`): the same head, the lock's session and claim as the reason.
 * - 409 (`stale`): "008 changed on disk · the board refreshed"; the page has reloaded the planning tree.
 * - anything else (`failed`): the head and the status.
 *
 * The refusals of the workflow and the lock use the fail tone (an `alert`, so the reason is announced assertively);
 * the 409, which the reload already answered, the warning tone (a polite `status`). The ✕ emits `closed`; the board
 * also drops the notice once the card stands anywhere else or is lifted again (`BoardDrag.refusalOf`, `start`).
 */
@Component({
  selector: 'app-refusal-notice',
  imports: [TranslocoPipe, UiIconButton, UiNotice, UiReason],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-refusal]': 'refusal().kind' },
  styles: `
    :host { display: block; margin-block-start: 8px; }
    ui-notice { align-items: flex-start; padding-inline-end: 4px; }
    .body { display: grid; gap: 4px; min-inline-size: 0; }
    .head { margin: 0; color: var(--color-base-content); font-size: 13px; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
    ui-reason { --reason-ink: var(--color-base-content); }
  `,
  template: `
    @let r = refusal();
    @let stage = 'stages.' + r.to | transloco;
    <ui-notice [tone]="tone()" icon="circle-alert">
      <div class="body">
        @if (r.kind !== 'stale') {
          <p class="head" data-head>{{ 'board.workspace.refusal.notMoved' | transloco: { id: r.id, stage } }}</p>
        }
        @switch (r.kind) {
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
  readonly refusal = input.required<BoardRefusal>();
  /** The ✕: the board forgets the refusal. */
  readonly closed = output();

  protected readonly tone = computed<NoticeTone>(() => (this.refusal().kind === 'stale' ? 'warning' : 'error'));
}
