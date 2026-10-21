import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard } from '../../../../../../../core/src/files';
import { LockSourceService } from '../../../../core/lock-source.service';
import { type CheckState, checkBlock, IDLE, rowChecked } from '../../data/tasks/checkbox';
import type { TasksBody } from '../../data/tasks/tasks-tab';
import { BoardCard } from '../board/board-card';

/** One tasks.md row as core parsed it (`…/tasks`). */
export type TaskRow = NonNullable<TasksBody>['tasks'][number];

/** A step's box ticked or cleared: the task and the state wanted. */
export interface StepToggle {
  readonly task: string;
  readonly checked: boolean;
}

/**
 * "Your steps" (T88, ISC-87; design.md § Live · Operator lane (Principal 2026-10-13)): the operator lane at wide as the
 * prototype draws it, its own lane in the grid (`.lane.op`; in Flow the row across all columns, `.op.span`): the lane
 * head (dot, `operator`, "Your steps · n of m done"), then one checklist row per step, a box and the step as a compact
 * 36 px card (`density="step"`: glyph, id, text, state chip, 4 px edge), so every frame card stays an
 * `article[data-card]` (ISC-88). Each box is the guarded task write of T80: the board's store runs the same
 * `checkbox.ts` state machine and `ApiClient.taskCheck` the Tasks tab runs (saving, written, locked, conflict, failed)
 * against the tasks.md hash of its own read of `…/tasks`, and hands the rows, the write states and the hash in here; a
 * tick goes back out (`toggled`), so no second state machine exists. A card without a tasks.md row (the list not read
 * yet) shows the frame's state, disabled.
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
  private readonly locks = inject(LockSourceService);

  /** The operator lane's cards of the frame on screen, board order. */
  readonly cards = input.required<readonly FrameCard[]>();
  /** The tasks.md rows by task id; empty until the board's read answers. */
  readonly rows = input<ReadonlyMap<string, TaskRow>>(new Map());
  /** The write state per task id. */
  readonly checks = input<ReadonlyMap<string, CheckState>>(new Map());
  /** The tasks.md hash the next tick sends; null before the read. */
  readonly hash = input<string | null>(null);
  /** A box ticked or cleared; the board posts it. */
  readonly toggled = output<StepToggle>();

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

  protected onChange(task: string, event: Event): void {
    this.toggled.emit({ task, checked: (event.target as HTMLInputElement).checked });
  }
}
