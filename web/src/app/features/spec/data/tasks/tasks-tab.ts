import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  linkedSignal,
  resource,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecRouteResponses } from '../../../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient } from '../../../../core/api.service';
import { LockSourceService } from '../../../../core/lock-source.service';
import { RefreshService } from '../../../../core/refresh.service';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { chipIcon } from '../../../../shared/ui/chip/chip-icons';
import { ToastService } from '../../../../shared/ui/toast/toast';
import { type CheckEvent, type CheckState, checkBlock, IDLE, landedDelta, nextCheckState, rowChecked, withCheck } from './checkbox';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { type FilterOption, UiFilterChips } from '../../../../shared/ui/filter-chips/filter-chips';
import { UiRovingItem, UiRovingList } from '../../../../shared/ui/roving-list.directive';
import type { FrameCard, ItemRun, ItemState, ItemStateInfo, RunState, TaskRun, TaskStep, TaskSteps } from '../../../../../../../core/src/files';
import { TaskStepsToggle } from './task-steps';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { elapsedText } from '../../../../shared/ui/item-state/duration';
import { UiItemState } from '../../../../shared/ui/item-state/item-state';
import { UiNotice } from '../../../../shared/ui/notice/notice';
import { taskActorsOf } from '../../live/live-frame';
import { TaskActors } from '../../live/task-actors/task-actors';
import { RunChip } from '../../live/card/card';
import { runChanges, runOf, runStates, specWaitOf } from '../../live/board/board-model';
import { UiLiveRegion } from '../../../../shared/ui/live-region/live-region';

/** core's `TasksTab` as the tasks route serves it (`null` there means the spec has no tasks.md). */
export type TasksBody = NonNullable<SpecRouteResponses['tasks']>;
export type TaskRowView = TasksBody['tasks'][number];

/** What a row's check sub-line says, as visible text (never a tooltip): a lock, a 409, a failed write, no hash. */
export type CheckLine =
  | { readonly kind: 'locked'; readonly session: string }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failed'; readonly status: number }
  | { readonly kind: 'no-hash' };

/** Spec 040 (T52): the status chip's tint per item state, the existing tones reused; aborted is the warning tint. */
const ITEM_TONE: Readonly<Record<ItemState, string>> = { open: 'open', waiting: 'held', running: 'dispatched', aborted: 'aborted', done: 'done' };

/** The row's own words that stay a chip beside the state word (design § task row). */
const OWN_WORDS: ReadonlySet<string> = new Set(['question', 'concerns', 'fail']);

/** The statuses whose round card carries a reason worth a sub-line (a hold, a fail, a question, concerns). */
const REASONED = new Set(['held', 'fail', 'concerns', 'question']);

/** `T1, T2, …, T26, T30` →`T1–T26, T30`: consecutive numbers fold into a range, file order kept. */
export function taskRanges(ids: readonly string[]): string {
  const parts: string[] = [];
  let start: string | null = null;
  let prev: number | null = null;
  let last: string | null = null;
  const flush = () => {
    if (start !== null && last !== null) parts.push(start === last ? start : `${start}–${last}`);
  };
  for (const id of ids) {
    const n = Number(id.slice(1));
    if (prev !== null && n === prev + 1 && /^T\d+$/.test(id)) {
      last = id;
    } else {
      flush();
      start = id;
      last = id;
    }
    prev = Number.isFinite(n) ? n : null;
  }
  flush();
  return parts.join(', ');
}

/** The last path segment, a trailing slash kept (`web/src/app/tag-table/` → `tag-table/`). */
export function pathTail(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const tail = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return path.endsWith('/') ? `${tail}/` : tail;
}

/**
 * The builder's short form under the run chip (spec 027): the last segment of the run event's worktree
 * (`.claude/worktrees/agent-a1b2` → `agent-a1b2`), else of its session, as for a `dispatch` or `build` that names no
 * worktree (spec 035, ISC-189); read from the event, never from git.
 */
export function runShort(run: Pick<TaskRun, 'session' | 'worktree'>): string {
  const last = (text: string, sep: RegExp): string => text.split(sep).filter((part) => part !== '').pop() ?? '';
  return last(run.worktree ?? '', /\//) || last(run.session, /[:/]/) || run.session;
}

/** A probe cell as written, one enclosing pair of backticks dropped for the mono cell. */
const probeText = (probe: string): string => (/^`[^`]*`$/.test(probe) ? probe.slice(1, -1) : probe);

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
  styleUrl: './tasks-tab.css',
})
export class TasksTab {
  protected readonly chipIcon = chipIcon;
  protected readonly itemTone = ITEM_TONE;
  protected readonly ownWords = OWN_WORDS;
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly locks = inject(LockSourceService);
  private readonly toasts = inject(ToastService);
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);

  readonly result = resource({
    params: () => {
      const ws = this.state.ws();
      const id = this.state.specId();
      return ws === null || id === null ? undefined : { ws, id };
    },
    loader: ({ params }) => this.api.tasks(params.ws, params.id),
  });

  /** The live frame (`…/live`), read once with the list: who works which task (T135, ISC-131.1). */
  readonly live = resource({
    params: () => {
      const ws = this.state.ws();
      const id = this.state.specId();
      return ws === null || id === null ? undefined : { ws, id };
    },
    loader: ({ params }) => this.api.live(params.ws, params.id),
  });
  /** The live cards core named an agent or sub-agent for, by task id; empty until the live route answers `ok`. */
  protected readonly liveCards = computed<ReadonlyMap<string, FrameCard>>(() => {
    const result = this.live.hasValue() ? this.live.value() : undefined;
    if (result?.kind !== 'ok') return new Map();
    return new Map(result.body.cards.filter((card) => taskActorsOf(card) !== null).map((card) => [card.task, card]));
  });
  /**
   * Each task's item state as the live frame carries it (spec 040), by task id. The live frame reads the locks, so its
   * item names the holder the frame shows; a row prefers it to the one the tasks route sent.
   */
  private readonly liveItems = computed<ReadonlyMap<string, ItemStateInfo>>(() => {
    const result = this.live.hasValue() ? this.live.value() : undefined;
    if (result?.kind !== 'ok') return new Map();
    return new Map(result.body.cards.flatMap((card) => (card.itemState === undefined ? [] : [[card.task, card.itemState] as const])));
  });
  /**
   * The row's item state: the tasks route's, with the live frame's in its place when that one carries a run (it names
   * the holder the frame shows). A row without one (an older payload, or a tick that dropped it) stays without.
   */
  protected itemOf(row: { readonly id: string; readonly itemState?: ItemStateInfo }): ItemStateInfo | undefined {
    if (row.itemState === undefined) return undefined;
    const live = this.liveItems().get(row.id);
    return this.undated(row.id, live?.run === undefined ? row.itemState : live);
  }
  /**
   * Spec 049 (ISC-285): a done task the files give no date for carries core's `item-state-no-date` diagnostic; the row
   * shows no sentence for it, and with agent steps the date of the last step stands in its place.
   */
  private undated(id: string, item: ItemStateInfo): ItemStateInfo {
    if (item.state !== 'done' || item.doneAt !== undefined || item.diagnostic?.code !== 'item-state-no-date') return item;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the diagnostic is left out on purpose
    const { diagnostic, ...rest } = item;
    const last = this.stepsOf(id).at(-1)?.ts;
    return last === undefined ? rest : { ...rest, doneAt: last };
  }
  /**
   * The run chip per task (spec 027, ISC-179.1): the live frame's run while tasks.md has not ticked the task, joined
   * by task id; the tick (`applied`) hands the row back to its state chip. The live frame is read again every refresh.
   */
  protected readonly runs = computed<ReadonlyMap<string, TaskRun>>(() => {
    const result = this.live.hasValue() ? this.live.value() : undefined;
    if (result?.kind !== 'ok') return new Map();
    return new Map(
      result.body.cards.flatMap((card) => {
        const run = runOf(card);
        return run === null ? [] : [[card.task, run] as const];
      }),
    );
  });
  private readonly announcer = viewChild(UiLiveRegion);
  private readonly refresher = inject(RefreshService);

  /** The body once the route answered `ok`: null for a spec without tasks.md, undefined before or on failure. */
  protected readonly body = computed<TasksBody | null | undefined>(() => {
    const result = this.result.value();
    return result?.kind === 'ok' ? result.body : undefined;
  });
  /** tasks.md's raw hash from the last read, for the checkbox write (T68). */
  readonly hash = computed(() => {
    const result = this.result.value();
    return result?.kind === 'ok' ? result.hash : null;
  });
  /** The hash the next tick sends: the read's, then each accepted write's, so a second tick is not stale. */
  private readonly writeHash = linkedSignal(() => this.hash());
  /** The write state per task id; a new read of the list drops them all. */
  private readonly checks = linkedSignal<unknown, ReadonlyMap<string, CheckState>>({
    source: () => this.result.value(),
    computation: () => new Map(),
  });
  protected readonly failed = computed(() => {
    const result = this.result.value();
    return result !== undefined && result.kind !== 'ok';
  });

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly lane = computed(() => {
    const lane = this.query().get('lane');
    return lane !== null && this.body()?.counts.byLane.some((c) => c.name === lane) ? lane : 'all';
  });
  protected readonly status = computed(() => {
    const status = this.query().get('status');
    return status !== null && this.body()?.counts.byStatus.some((c) => c.name === status) ? status : 'all';
  });
  protected readonly hideDone = computed(() => this.query().get('hideDone') === '1');

  protected readonly laneOptions = computed<readonly FilterOption[]>(() => {
    this.lang();
    const body = this.body();
    if (!body) return [];
    const all = this.allOption(body.counts.rows, 'tasks.filters.allLanes');
    return [all, ...body.counts.byLane.map((c) => ({ key: c.name, label: c.name, count: c.count }))];
  });
  protected readonly statusOptions = computed<readonly FilterOption[]>(() => {
    this.lang();
    const body = this.body();
    if (!body) return [];
    const all = this.allOption(body.counts.rows, 'tasks.filters.allStatuses');
    return [all, ...body.counts.byStatus.map((c) => ({ key: c.name, label: this.transloco.translate(`tasks.status.${c.name}`), count: c.count }))];
  });
  /** The `all` chip, named by its group ("All 39 lanes" / "All 39 statuses") so the two never share a name (ISC-248). */
  private allOption(count: number, nameKey: string): FilterOption {
    return { key: 'all', label: this.transloco.translate('tasks.filters.all'), count, name: this.transloco.translate(`${nameKey}.${count === 1 ? 'one' : 'other'}`, { count }) };
  }

  /** Every row as it stands after the writes this list has seen accepted. */
  private readonly written = computed<readonly TaskRowView[]>(() => {
    const checks = this.checks();
    return (this.body()?.tasks ?? []).map((row) => withCheck(row, checks.get(row.id) ?? IDLE));
  });
  /**
   * The head line's done part (spec 021, ISC-252): core's `counts.done`, the rows whose status landed (`done` or
   * `closed`), moved only by the ticks this list has seen accepted; its whole is `counts.rows`, never the boxes.
   */
  protected readonly done = computed(() => {
    const checks = this.checks();
    const tasks = this.body()?.tasks ?? [];
    return tasks.reduce((sum, row) => sum + landedDelta(row, checks.get(row.id) ?? IDLE), this.body()?.counts.done ?? 0);
  });
  /** The plural form of "x of N tasks done or closed", picked by the whole (`counts.rows`). */
  protected readonly doneKey = computed(() => (this.body()?.counts.rows === 1 ? 'tasks.doneOfTotal.one' : 'tasks.doneOfTotal.other'));

  /** Rows after the lane and status filters, before "hide done". */
  private readonly filtered = computed<readonly TaskRowView[]>(() => {
    const lane = this.lane();
    const status = this.status();
    return this.written().filter((t) => (lane === 'all' || t.lane === lane) && (status === 'all' || t.status === status));
  });
  protected readonly rows = computed(() => (this.hideDone() ? this.filtered().filter((t) => t.state !== 'done') : this.filtered()));
  /** The done rows "hide done" took out, named as ranges in the footer. */
  protected readonly hidden = computed(() => {
    if (!this.hideDone()) return null;
    const done = this.filtered().filter((t) => t.state === 'done');
    return done.length === 0 ? null : { count: done.length, ids: taskRanges(done.map((t) => t.id)) };
  });
  protected readonly mapping = computed(() =>
    (this.body()?.probeMapping ?? []).map((m) => ({ ...m, taskIds: taskRanges(m.tasks), probeText: probeText(m.probe) })),
  );

  protected readonly specLink = computed(() => ['/w', this.state.ws() ?? '', 's', this.state.specId() ?? '']);
  protected readonly type = computed(() => this.data.currentRow()?.type ?? null);

  /**
   * Every task's steps (spec 015, ISC-232): the live frame's, read again every refresh, else the tasks route's; an
   * older payload carries none.
   */
  private readonly steps = computed<TaskSteps>(() => {
    const live = this.live.hasValue() ? this.live.value() : undefined;
    const fromLive = live?.kind === 'ok' ? (live.body as Partial<{ steps: TaskSteps }>).steps : undefined;
    return fromLive ?? this.body()?.steps ?? {};
  });
  /** The rows `?steps=T4,T14` opens, each on its own; nothing else opens a row. */
  protected readonly openSteps = computed<ReadonlySet<string>>(
    () => new Set((this.query().get('steps') ?? '').split(',').filter((id) => id !== '')),
  );

  /** A task's steps; empty for a task without any, which then gets no toggle and no "0 steps". */
  protected stepsOf(id: string): readonly TaskStep[] {
    return this.steps()[id] ?? [];
  }

  /** Opens or closes one row's timeline through the query; the other open rows stay, the fragment too. */
  protected toggleSteps(id: string): void {
    const open = [...this.openSteps()];
    const next = open.includes(id) ? open.filter((other) => other !== id) : [...open, id];
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { steps: next.length === 0 ? null : next.join(',') },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }

  /** The task a `#task-T<n>` fragment names. */
  protected readonly target = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith('task-') ? fragment.slice('task-'.length) : null;
  });

  private scrolledTo: string | null = null;

  constructor() {
    // The live frame again on every refresh (ETag: a 304 costs no body), so a run chip moves within one tick (ISC-62)
    // and a streamed step shows within 2 s (spec 015, ISC-233). The refresh count, not its clock: two refreshes in
    // one millisecond, or under a pinned clock, leave `lastRefresh` unchanged and would skip the read.
    let firstRefresh = true;
    effect(() => {
      this.refresher.refreshes();
      if (firstRefresh) firstRefresh = false;
      else untracked(() => this.live.reload());
    });
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
      const target = this.target();
      this.rows();
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

  protected runOfRow(id: string): TaskRun | null {
    return this.runs().get(id) ?? null;
  }
  /**
   * Spec 025 (T26, ISC-163): the specs an open task waits on, from core's hold reason `waits on NNN` (the task's own
   * spec edges or its claim's); null once the edge is met, so the line, the clock and the disabled box go with it.
   */
  protected specWait(row: TaskRowView): readonly string[] | null {
    if (row.state !== 'open') return null;
    const reason = specWaitOf(row.reason);
    if (reason !== null) return reason;
    const open = this.openBlockers();
    const held = (row.afterSpecs ?? []).filter((id) => open.has(id));
    return held.length > 0 ? held : null;
  }
  /** The spec's open spec edges (its `waits` blockers): a task's own `afterSpecs` edge holds it while it is open. */
  private readonly openBlockers = computed(() => {
    const spec = this.data.spec.value();
    return new Set(spec?.kind === 'ok' ? (spec.body.head.waits?.blockers ?? []) : []);
  });
  /** The blocker numbers a known spec carries link to it; an unknown one (`042`) stays plain text. */
  protected specLinkOf(id: string): readonly string[] | null {
    return [...this.data.specRows(), ...this.data.archiveRows()].some((row) => row.id === id) ? ['/w', this.state.ws() ?? '', 's', id] : null;
  }

  protected sub(row: TaskRowView): { readonly key: string; readonly text?: string } | null {
    if (row.state === 'struck') return row.note === null ? null : { key: 'tasks.sub.struck', text: row.note };
    if (this.specWait(row) !== null) return null;
    if (REASONED.has(row.status) && row.reason !== null) return { key: `tasks.sub.${row.status}`, text: row.reason };
    if (row.lane === 'operator' && row.state === 'open') return { key: 'tasks.sub.operator' };
    return null;
  }

  /** Prototype `.t-reason`: the reason line leads with `flag` on the principal's own step, `lock` on a hold. */
  protected subIcon(row: TaskRowView): 'flag' | 'lock' | null {
    if (row.state === 'struck') return null;
    if (row.lane === 'operator' && row.state === 'open' && !(REASONED.has(row.status) && row.reason !== null)) return 'flag';
    return row.status === 'held' ? 'lock' : null;
  }

  protected checkOf(id: string): CheckState {
    return this.checks().get(id) ?? IDLE;
  }

  protected isChecked(row: TaskRowView): boolean {
    return rowChecked(row, this.checkOf(row.id));
  }

  /** Whether the box is disabled right now (in flight, under a lock on its claim, or without a hash). */
  protected blocked(row: TaskRowView): boolean {
    return checkBlock(row, this.checkOf(row.id), this.locks.lock(), this.writeHash()) !== null;
  }

  /** The row's check sub-line: the lock source's lock first, then what the last write answered, then a missing hash. */
  protected checkLine(row: TaskRowView): CheckLine | null {
    const state = this.checkOf(row.id);
    const block = checkBlock(row, state, this.locks.lock(), this.writeHash());
    if (block?.kind === 'locked') return block;
    if (state.kind === 'locked' || state.kind === 'conflict' || state.kind === 'failed') return state;
    return block?.kind === 'no-hash' ? block : null;
  }

  /**
   * Spec 040 (T52, ISC-225): the run standing on this spec, read from the spec head's `state` (`running` from a run
   * line); null otherwise, and while the spec payload has not answered.
   */
  protected readonly specRun = computed<ItemRun | null>(() => {
    const result = this.data.spec.value();
    const item = result?.kind === 'ok' ? result.body.head.state : undefined;
    return item?.state === 'running' && item.run?.source === 'run' ? item.run : null;
  });

  /** "3 min" for the notice, from the run's `elapsedMs` (the refresh tick moves it; no timer here). */
  protected readonly runDuration = computed(() => {
    const run = this.specRun();
    if (!run) return '';
    const { key, params } = elapsedText(run.elapsedMs);
    return this.transloco.translate(key, params);
  });

  /** The box's description: its run lock or check line first, then the helper. */
  protected describedBy(row: TaskRowView): string {
    const ids = [this.specRun() ? `task-${row.id}-run` : null, this.checkLine(row) ? `task-${row.id}-check` : null, 'tasks-helper'];
    return ids.filter((id) => id !== null).join(' ');
  }

  /** A locked box stays focusable (`aria-disabled`), so its click is stopped before it toggles or writes. */
  protected guardRun(event: Event): void {
    if (this.specRun()) event.preventDefault();
  }

  /** Applies one event to a row's state; false when the state did not change (the list was read again meanwhile). */
  private transition(id: string, event: CheckEvent): boolean {
    const current = this.checkOf(id);
    const next = nextCheckState(current, event);
    if (next === current) return false;
    this.checks.update((checks) => new Map(checks).set(id, next));
    return true;
  }

  /** A tick: post the state wanted with the hash this list shows, then apply the answer (ISC-25, ISC-26, ISC-86). */
  protected async tick(row: TaskRowView, checked: boolean): Promise<void> {
    const ws = this.state.ws();
    const id = this.state.specId();
    const hash = this.writeHash();
    if (ws === null || id === null || hash === null || this.blocked(row) || this.specRun() !== null) return;
    this.transition(row.id, { type: 'tick', checked });
    const result = await this.api.taskCheck(ws, id, row.id, hash, checked);
    if (!this.transition(row.id, { type: 'answer', result }) || result.kind !== 'ok') return;
    this.writeHash.set(result.body.hash);
    const state = this.checkOf(row.id);
    const key = state.kind === 'written' && state.checked ? 'tasks.check.ticked' : 'tasks.check.unticked';
    this.toasts.show(this.transloco.translate(key, { id: row.id, line: result.body.line.number }));
  }

  /** The 409's Reload: clear the alert and read the list again; focus stays on the row. */
  protected reloadTasks(row: TaskRowView): void {
    this.transition(row.id, { type: 'reload' });
    this.result.reload();
    this.host.querySelector<HTMLElement>(`#task-${CSS.escape(row.id)}`)?.focus();
  }

  protected setQuery(name: 'lane' | 'status' | 'hideDone', value: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [name]: value === 'all' ? null : value },
      queryParamsHandling: 'merge',
      preserveFragment: true,
    });
  }
}
