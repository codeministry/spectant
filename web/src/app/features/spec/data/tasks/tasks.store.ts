import { computed, effect, inject, Injectable, linkedSignal, resource, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { FrameCard, ItemRun, ItemStateInfo, TaskRun, TaskStep, TaskSteps } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { LockSourceService } from '../../../../core/lock-source.service';
import { RefreshService } from '../../../../layout/shell/refresh.service';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { elapsedText } from '../../../../shared/ui/item-state/duration';
import type { FilterOption } from '../../../../shared/ui/filter-chips/filter-chips';
import { ToastService } from '../../../../shared/ui/toast/toast';
import { runOf, specWaitOf } from '../../live/board/board-model';
import { taskActorsOf } from '../../live/live-frame';
import { activeLang, specParams } from '../../spec-view';
import { routeFragment } from '../../route-signals';
import { type CheckEvent, type CheckState, checkBlock, IDLE, landedDelta, nextCheckState, rowChecked, withCheck } from './checkbox';
import { type CheckLine, probeText, REASONED, taskRanges, type TaskRowView, type TasksBody } from './tasks-model';

/**
 * The state of the Tasks tab (`TasksTab`, T57, ISC-82, spec 061): the tasks route and the live frame beside it, the
 * filters as query params, the write state of every checkbox (T80, ISC-25) and the rows' steps (spec 015). DOM work
 * (the deep-link scroll, the focus, the run announcer) stays in the page.
 */
@Injectable()
export class TasksStore {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly locks = inject(LockSourceService);
  private readonly toasts = inject(ToastService);
  private readonly refresher = inject(RefreshService);
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  private readonly params = specParams(this.state);

  readonly result = resource({ params: () => this.params(), loader: ({ params }) => this.api.tasks(params.ws, params.id) });

  /** The live frame (`…/live`), read once with the list: who works which task (T135, ISC-131.1). */
  readonly live = resource({ params: () => this.params(), loader: ({ params }) => this.api.live(params.ws, params.id) });
  /** The live frame once the live route answered `ok`, else null. */
  private readonly frame = computed(() => {
    const result = this.live.hasValue() ? this.live.value() : undefined;
    return result?.kind === 'ok' ? result.body : null;
  });
  /** The live cards core named an agent or sub-agent for, by task id; empty until the live route answers `ok`. */
  readonly liveCards = computed<ReadonlyMap<string, FrameCard>>(
    () => new Map((this.frame()?.cards ?? []).filter((card) => taskActorsOf(card) !== null).map((card) => [card.task, card])),
  );
  /**
   * Each task's item state as the live frame carries it (spec 040), by task id. The live frame reads the locks, so its
   * item names the holder the frame shows; a row prefers it to the one the tasks route sent.
   */
  private readonly liveItems = computed<ReadonlyMap<string, ItemStateInfo>>(
    () => new Map((this.frame()?.cards ?? []).flatMap((card) => (card.itemState === undefined ? [] : [[card.task, card.itemState] as const]))),
  );
  /**
   * The row's item state: the tasks route's, with the live frame's in its place when that one carries a run (it names
   * the holder the frame shows). A row without one (an older payload, or a tick that dropped it) stays without.
   */
  itemOf(row: { readonly id: string; readonly itemState?: ItemStateInfo }): ItemStateInfo | undefined {
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
  private readonly runs = computed<ReadonlyMap<string, TaskRun>>(
    () =>
      new Map(
        (this.frame()?.cards ?? []).flatMap((card) => {
          const run = runOf(card);
          return run === null ? [] : [[card.task, run] as const];
        }),
      ),
  );

  /** The body once the route answered `ok`: null for a spec without tasks.md, undefined before or on failure. */
  readonly body = computed<TasksBody | null | undefined>(() => {
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
  readonly failed = computed(() => {
    const result = this.result.value();
    return result !== undefined && result.kind !== 'ok';
  });

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly fragment = routeFragment(this.route);
  private readonly lang = activeLang(this.transloco);

  readonly lane = computed(() => {
    const lane = this.query().get('lane');
    return lane !== null && this.body()?.counts.byLane.some((c) => c.name === lane) ? lane : 'all';
  });
  readonly status = computed(() => {
    const status = this.query().get('status');
    return status !== null && this.body()?.counts.byStatus.some((c) => c.name === status) ? status : 'all';
  });
  readonly hideDone = computed(() => this.query().get('hideDone') === '1');

  readonly laneOptions = computed<readonly FilterOption[]>(() => {
    this.lang();
    const body = this.body();
    if (!body) return [];
    const all = this.allOption(body.counts.rows, 'tasks.filters.allLanes');
    return [all, ...body.counts.byLane.map((c) => ({ key: c.name, label: c.name, count: c.count }))];
  });
  readonly statusOptions = computed<readonly FilterOption[]>(() => {
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
  readonly done = computed(() => {
    const checks = this.checks();
    const tasks = this.body()?.tasks ?? [];
    return tasks.reduce((sum, row) => sum + landedDelta(row, checks.get(row.id) ?? IDLE), this.body()?.counts.done ?? 0);
  });
  /** The plural form of "x of N tasks done or closed", picked by the whole (`counts.rows`). */
  readonly doneKey = computed(() => (this.body()?.counts.rows === 1 ? 'tasks.doneOfTotal.one' : 'tasks.doneOfTotal.other'));

  /** Rows after the lane and status filters, before "hide done". */
  private readonly filtered = computed<readonly TaskRowView[]>(() => {
    const lane = this.lane();
    const status = this.status();
    return this.written().filter((t) => (lane === 'all' || t.lane === lane) && (status === 'all' || t.status === status));
  });
  readonly rows = computed(() => (this.hideDone() ? this.filtered().filter((t) => t.state !== 'done') : this.filtered()));
  /** The done rows "hide done" took out, named as ranges in the footer. */
  readonly hidden = computed(() => {
    if (!this.hideDone()) return null;
    const done = this.filtered().filter((t) => t.state === 'done');
    return done.length === 0 ? null : { count: done.length, ids: taskRanges(done.map((t) => t.id)) };
  });
  readonly mapping = computed(() =>
    (this.body()?.probeMapping ?? []).map((m) => ({ ...m, taskIds: taskRanges(m.tasks), probeText: probeText(m.probe) })),
  );

  readonly specLink = computed(() => ['/w', this.state.ws() ?? '', 's', this.state.specId() ?? '']);
  readonly type = computed(() => this.data.currentRow()?.type ?? null);

  /**
   * Every task's steps (spec 015, ISC-232): the live frame's, read again every refresh, else the tasks route's; an
   * older payload carries none.
   */
  private readonly steps = computed<TaskSteps>(() => {
    const fromLive = (this.frame() as Partial<{ steps: TaskSteps }> | null)?.steps;
    return fromLive ?? this.body()?.steps ?? {};
  });
  /** The rows `?steps=T4,T14` opens, each on its own; nothing else opens a row. */
  readonly openSteps = computed<ReadonlySet<string>>(() => new Set((this.query().get('steps') ?? '').split(',').filter((id) => id !== '')));

  /** A task's steps; empty for a task without any, which then gets no toggle and no "0 steps". */
  stepsOf(id: string): readonly TaskStep[] {
    return this.steps()[id] ?? [];
  }

  /** Opens or closes one row's timeline through the query; the other open rows stay, the fragment too. */
  toggleSteps(id: string): void {
    const open = [...this.openSteps()];
    const next = open.includes(id) ? open.filter((other) => other !== id) : [...open, id];
    this.navigate({ steps: next.length === 0 ? null : next.join(',') });
  }

  /** The task a `#task-T<n>` fragment names. */
  readonly target = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith('task-') ? fragment.slice('task-'.length) : null;
  });

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
  }

  runOfRow(id: string): TaskRun | null {
    return this.runs().get(id) ?? null;
  }
  /**
   * Spec 025 (T26, ISC-163): the specs an open task waits on, from core's hold reason `waits on NNN` (the task's own
   * spec edges or its claim's); null once the edge is met, so the line, the clock and the disabled box go with it.
   */
  specWait(row: TaskRowView): readonly string[] | null {
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
  specLinkOf(id: string): readonly string[] | null {
    return [...this.data.specRows(), ...this.data.archiveRows()].some((row) => row.id === id) ? ['/w', this.state.ws() ?? '', 's', id] : null;
  }

  sub(row: TaskRowView): { readonly key: string; readonly text?: string } | null {
    if (row.state === 'struck') return row.note === null ? null : { key: 'tasks.sub.struck', text: row.note };
    if (this.specWait(row) !== null) return null;
    if (REASONED.has(row.status) && row.reason !== null) return { key: `tasks.sub.${row.status}`, text: row.reason };
    if (row.lane === 'operator' && row.state === 'open') return { key: 'tasks.sub.operator' };
    return null;
  }

  /** The reason line leads with `flag` on the principal's own step, `lock` on a hold. */
  subIcon(row: TaskRowView): 'flag' | 'lock' | null {
    if (row.state === 'struck') return null;
    if (row.lane === 'operator' && row.state === 'open' && !(REASONED.has(row.status) && row.reason !== null)) return 'flag';
    return row.status === 'held' ? 'lock' : null;
  }

  checkOf(id: string): CheckState {
    return this.checks().get(id) ?? IDLE;
  }

  isChecked(row: TaskRowView): boolean {
    return rowChecked(row, this.checkOf(row.id));
  }

  /** Whether the box is disabled right now (in flight, under a lock on its claim, or without a hash). */
  blocked(row: TaskRowView): boolean {
    return checkBlock(row, this.checkOf(row.id), this.locks.lock(), this.writeHash()) !== null;
  }

  /** The row's check sub-line: the lock source's lock first, then what the last write answered, then a missing hash. */
  checkLine(row: TaskRowView): CheckLine | null {
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
  readonly specRun = computed<ItemRun | null>(() => {
    const result = this.data.spec.value();
    const item = result?.kind === 'ok' ? result.body.head.state : undefined;
    return item?.state === 'running' && item.run?.source === 'run' ? item.run : null;
  });

  /** "3 min" for the notice, from the run's `elapsedMs` (the refresh tick moves it; no timer here). */
  readonly runDuration = computed(() => {
    const run = this.specRun();
    if (!run) return '';
    const { key, params } = elapsedText(run.elapsedMs);
    return this.transloco.translate(key, params);
  });

  /** The box's description: its run lock or check line first, then the helper. */
  describedBy(row: TaskRowView): string {
    const ids = [this.specRun() ? `task-${row.id}-run` : null, this.checkLine(row) ? `task-${row.id}-check` : null, 'tasks-helper'];
    return ids.filter((id) => id !== null).join(' ');
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
  async tick(row: TaskRowView, checked: boolean): Promise<void> {
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

  /** The 409's Reload: clear the alert and read the list again. */
  reloadTasks(row: TaskRowView): void {
    this.transition(row.id, { type: 'reload' });
    this.result.reload();
  }

  setQuery(name: 'lane' | 'status' | 'hideDone', value: string | null): void {
    this.navigate({ [name]: value === 'all' ? null : value });
  }

  private navigate(queryParams: Record<string, string | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', preserveFragment: true });
  }
}
