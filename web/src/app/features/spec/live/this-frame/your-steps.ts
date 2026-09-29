import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, resource } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { LockSourceService } from '../../../../core/lock-source.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { type CheckEvent, type CheckState, checkBlock, IDLE, nextCheckState, rowChecked } from '../../data/tasks/checkbox';
import type { TasksBody } from '../../data/tasks/tasks-tab';
import { BoardCard } from '../board/board-card';
import { RAIL_BLOCK_STYLES } from './rail-block.styles';

type TaskRow = NonNullable<TasksBody>['tasks'][number];

/**
 * "Your steps" (T88, ISC-87; design.md § Live, Rail): the operator lane's cards as 40 px checklist rows at wide, the
 * lane's single home there. Each box is the guarded task write of T80: the same `checkbox.ts` state machine and
 * `ApiClient.taskCheck` the Tasks tab runs (saving, written, locked, conflict, failed), against the tasks.md hash of
 * this component's own read of `…/tasks`, so no second state machine exists. A card without a tasks.md row (the list
 * not read yet) shows the frame's state, disabled.
 */
@Component({
  selector: 'app-your-steps',
  imports: [BoardCard, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-your-steps': '' },
  styles: [
    RAIL_BLOCK_STYLES,
    `
      .step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 8px; align-items: center; min-block-size: 40px; }
      .note { grid-column: 2; margin: 0; color: var(--muted-ink); font-size: 12px; line-height: 16px; }
      .note[data-tone='fail'] { color: var(--fail-ink); }
      .checkbox { justify-self: center; }
      @media (pointer: coarse) { .step { min-block-size: 44px; } }
    `,
  ],
  template: `
    <section class="block" aria-labelledby="your-steps-heading">
      <h3 class="head" id="your-steps-heading">{{ 'board.rail.yourSteps' | transloco }}</h3>
      @if (cards().length > 0) {
        <ul class="rows">
          @for (c of cards(); track c.task) {
            @let state = checkOf(c.task);
            @let row = rowOf(c.task);
            <li class="step" [attr.data-step]="c.task" [attr.data-check]="state.kind">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  [checked]="checked(c)"
                  [disabled]="row === null || blocked(row)"
                  [attr.aria-label]="'board.rail.stepCheck' | transloco: { task: c.task }"
                  (change)="onChange(c.task, $event)"
                />
                <app-board-card [card]="c" density="compact" (opened)="opened.emit($event)" />
                @if (state.kind === 'saving') {
                  <p class="note" data-step-note="saving"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span> {{ 'board.rail.stepSaving' | transloco }}</p>
                } @else if (state.kind === 'locked') {
                  <p class="note" data-step-note="locked">{{ 'board.rail.stepLocked' | transloco: { session: state.session } }}</p>
                } @else if (state.kind === 'conflict') {
                  <p class="note" data-tone="fail" role="alert" data-step-note="conflict">{{ 'board.rail.stepConflict' | transloco }}</p>
                } @else if (state.kind === 'failed') {
                  <p class="note" data-tone="fail" role="alert" data-step-note="failed">{{ 'board.rail.stepFailed' | transloco }}</p>
                }
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ 'board.rail.stepsEmpty' | transloco }}</p>
      }
    </section>
  `,
})
export class YourSteps {
  private readonly api = inject(ApiClient);
  private readonly state = inject(ShellState);
  private readonly locks = inject(LockSourceService);

  /** The operator lane's cards of the frame on screen, board order. */
  readonly cards = input.required<readonly FrameCard[]>();
  readonly opened = output<FrameCard>();

  private readonly tasks = resource({
    params: () => {
      const ws = this.state.ws();
      const id = this.state.specId();
      return ws === null || id === null ? undefined : { ws, id };
    },
    loader: ({ params }) => this.api.tasks(params.ws, params.id),
  });
  private readonly rows = computed<ReadonlyMap<string, TaskRow>>(() => {
    const result = this.tasks.value();
    return new Map(result?.kind === 'ok' && result.body ? result.body.tasks.map((row) => [row.id, row]) : []);
  });
  /** The hash the next tick sends: the read's, then each accepted write's (as the Tasks tab). */
  private readonly hash = linkedSignal(() => {
    const result = this.tasks.value();
    return result?.kind === 'ok' ? result.hash : null;
  });
  /** The write state per task id; a new read drops them all. */
  private readonly checks = linkedSignal<unknown, ReadonlyMap<string, CheckState>>({
    source: () => this.tasks.value(),
    computation: () => new Map(),
  });

  protected rowOf(task: string): TaskRow | null {
    return this.rows().get(task) ?? null;
  }

  protected checkOf(task: string): CheckState {
    return this.checks().get(task) ?? IDLE;
  }

  protected checked(card: FrameCard): boolean {
    const row = this.rowOf(card.task);
    return row === null ? card.state === 'operatorDone' : rowChecked(row, this.checkOf(card.task));
  }

  protected blocked(row: TaskRow): boolean {
    return checkBlock(row, this.checkOf(row.id), this.locks.lock(), this.hash()) !== null;
  }

  private transition(task: string, event: CheckEvent): boolean {
    const current = this.checkOf(task);
    const next = nextCheckState(current, event);
    if (next === current) return false;
    this.checks.update((checks) => new Map(checks).set(task, next));
    return true;
  }

  protected onChange(task: string, event: Event): void {
    void this.tick(task, (event.target as HTMLInputElement).checked);
  }

  /** A tick: post the state wanted with the hash of this read, then apply the answer (ISC-25, ISC-26, ISC-86). */
  private async tick(task: string, checked: boolean): Promise<void> {
    const ws = this.state.ws();
    const id = this.state.specId();
    const row = this.rowOf(task);
    const hash = this.hash();
    if (ws === null || id === null || row === null || hash === null || this.blocked(row)) return;
    this.transition(task, { type: 'tick', checked });
    const result = await this.api.taskCheck(ws, id, task, hash, checked);
    if (!this.transition(task, { type: 'answer', result }) || result.kind !== 'ok') return;
    this.hash.set(result.body.hash);
  }
}
