import { afterRenderEffect, ChangeDetectionStrategy, Component, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { RunState } from '../../../../../../../core/src/files';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { chipIcon } from '../../../../shared/ui/chip/chip-icons';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { UiFilterChips } from '../../../../shared/ui/filter-chips/filter-chips';
import { UiRovingItem, UiRovingList } from '../../../../shared/ui/roving-list.directive';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { UiItemState } from '../../../../shared/ui/item-state/item-state';
import { UiNotice } from '../../../../shared/ui/notice/notice';
import { UiLiveRegion } from '../../../../shared/ui/live-region/live-region';
import { TaskActors } from '../../live/task-actors/task-actors';
import { RunChip } from '../../live/card/run-chip';
import { runChanges, runStates } from '../../live/board/board-model';
import { TaskStepsToggle } from './task-steps';
import { ITEM_TONE, OWN_WORDS, pathTail, runShort, type TaskRowView } from './tasks-model';
import { TasksStore } from './tasks.store';

// The row helpers and types moved to `tasks-model.ts` (spec 061); the specs and the live area import them from here.
export { pathTail, runShort, taskRanges, type CheckLine, type TaskRowView, type TasksBody } from './tasks-model';

/**
 * The Tasks tab (T57, ISC-82): every task line of tasks.md as core's `TasksTab` serves it, with lane, flags, status,
 * edges and paths, filterable by lane and status and with done rows hideable, all as query params (`?lane=web&
 * status=held&hideDone=1`); the probe mapping table below. Rows are one roving list; `#task-T<n>` (an edge link, or a
 * deep link) scrolls to, focuses and highlights its row.
 *
 * Every checkbox, operator rows included, is the guarded task write (T80, ISC-25): a tick posts `taskCheck` with the
 * tasks.md hash this list was rendered with, and the row runs the state machine of `checkbox.ts` (saving, written,
 * locked, conflict, failed). A 200 updates the row from the answer's line, makes the answer's hash the one the next
 * tick sends, and confirms through the app's single toast; a 409 shows an inline alert whose Reload reads the list
 * again; a lock (the lock source's or a 423's) shows "locked · <session>" as text.
 *
 * Spec 040 (T52, ISC-224): a row with `itemState` shows its state word in the status cell, the fine ISC-179 state as
 * the detail of running ("running · building") and question, concerns and fail as their own chip beside it; a row
 * without one keeps its status chip. While the spec head's state is `running` from a run line, every box is locked
 * (lock icon, `aria-disabled`, "locked · <session>" as its description, a click writes nothing) and a notice at the
 * top names the run. Nothing here derives a state; it reads `itemState` and the head's `state`.
 *
 * Spec 015 (T23, ISC-232): a row whose task has steps gets a toggle naming its latest step, that step's clock and the
 * count; it opens `app-step-timeline` under the row. Which rows are open is the query `?steps=T4,T14` and nothing
 * else, so reload and back land the same and a live update never opens one.
 *
 * The state lives in `TasksStore` (spec 061), one per tab; the page keeps the DOM: the deep-link scroll and focus, and
 * the run announcer.
 */
@Component({
  selector: 'app-tasks-tab',
  imports: [
    RouterLink,
    RunChip,
    TaskActors,
    TaskStepsToggle,
    TranslocoPipe,
    UiChip,
    UiEmptyState,
    UiFilterChips,
    UiGlyph,
    UiIcon,
    UiItemState,
    UiLiveRegion,
    UiNotice,
    UiRovingItem,
    UiRovingList,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'tasks' },
  templateUrl: './tasks-tab.html',
  styleUrls: ['./tasks-tab.css', './tasks-tab-row.css'],
  providers: [TasksStore],
})
export class TasksTab {
  protected readonly store = inject(TasksStore);
  protected readonly chipIcon = chipIcon;
  protected readonly itemTone = ITEM_TONE;
  protected readonly ownWords = OWN_WORDS;
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);

  private readonly live = this.store.live;

  private readonly announcer = viewChild(UiLiveRegion);
  private scrolledTo: string | null = null;

  constructor() {
    // One polite announcement per refresh that moved a run chip ("T3: patch ready; T5: building"), never per chip.
    let seenRuns: ReadonlyMap<string, RunState> | null = null;
    effect(() => {
      const result = this.live.hasValue() ? this.live.value() : undefined;
      if (result?.kind !== 'ok') return;
      const after = runStates(result.body.cards);
      const changes = runChanges(seenRuns, after);
      seenRuns = after;
      if (changes.length === 0) return;
      untracked(() => this.announcer()?.announceAll(changes.map((c) => this.runChanged(c.task, c.state))));
    });

    // Scroll to and focus the deep-linked row once it is rendered; a later fragment scrolls again.
    afterRenderEffect(() => {
      const target = this.store.target();
      this.store.rows();
      if (target === null || target === this.scrolledTo) return;
      const row = this.host.querySelector<HTMLElement>(`#task-${CSS.escape(target)}`);
      if (!row) return;
      this.scrolledTo = target;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      // DOM emulations (the unit-test builder) have no scrollIntoView.
      (row as Partial<HTMLElement>).scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      row.focus({ preventScroll: true });
    });
  }

  protected readonly tail = pathTail;
  protected readonly short = runShort;

  /** One part of a tick's announcement: "T32: building". */
  private runChanged(task: string, state: RunState): string {
    const word: string = this.transloco.translate(`states.run.${state}`);
    return this.transloco.translate('live.runChanged', { task, state: word });
  }

  /** A locked box stays focusable (`aria-disabled`), so its click is stopped before it toggles or writes. */
  protected guardRun(event: Event): void {
    if (this.store.specRun()) event.preventDefault();
  }

  /** The 409's Reload: clear the alert and read the list again; focus stays on the row. */
  protected reloadTasks(row: TaskRowView): void {
    this.store.reloadTasks(row);
    this.host.querySelector<HTMLElement>(`#task-${CSS.escape(row.id)}`)?.focus();
  }
}
