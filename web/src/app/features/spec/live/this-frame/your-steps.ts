import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, resource } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { LockSourceService } from '../../../../core/lock-source.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { type CheckEvent, type CheckState, checkBlock, IDLE, nextCheckState, rowChecked } from '../../data/tasks/checkbox';
import type { TasksBody } from '../../data/tasks/tasks-tab';
import { BoardCard } from '../board/board-card';

type TaskRow = NonNullable<TasksBody>['tasks'][number];

/**
 * "Your steps" (T88, ISC-87; design.md § Live · Operator lane (Principal 2026-10-13)): the operator lane at wide as the
 * prototype draws it, its own lane in the grid (`.lane.op`; in Flow the row across all columns, `.op.span`): the lane
 * head (dot, `operator`, "Your steps · n of m done"), then one checklist row per step, a box and the step as a compact
 * 36 px card (`density="step"`: glyph, id, text, state chip, 4 px edge), so every frame card stays an
 * `article[data-card]` (ISC-88). Each box is the guarded task write of T80: the same `checkbox.ts` state machine and
 * `ApiClient.taskCheck` the Tasks tab runs (saving, written, locked, conflict, failed), against the tasks.md hash of
 * this component's own read of `…/tasks`, so no second state machine exists. A card without a tasks.md row (the list
 * not read yet) shows the frame's state, disabled.
 */
@Component({
  selector: 'app-your-steps',
  imports: [BoardCard, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-your-steps': '' },
  styleUrl: './your-steps.css',
  templateUrl: './your-steps.html',
})
export class YourSteps {
  private readonly api = inject(ApiClient);
  private readonly state = inject(ShellState);
  private readonly locks = inject(LockSourceService);

  /** The operator lane's cards of the frame on screen, board order. */
  readonly cards = input.required<readonly FrameCard[]>();

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

  /** The steps ticked, the writes of this view included. */
  protected readonly done = computed(() => this.cards().filter((c) => this.checked(c)).length);

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
