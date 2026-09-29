import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  linkedSignal,
  resource,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecRouteResponses } from '../../../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../../../core/api.service';
import { LockSourceService } from '../../../../core/lock-source.service';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { ToastService } from '../../../../shared/ui/toast/toast';
import { type CheckEvent, type CheckState, checkBlock, IDLE, landedDelta, nextCheckState, rowChecked, withCheck } from './checkbox';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { type FilterOption, UiFilterChips } from '../../../../shared/ui/filter-chips/filter-chips';
import { UiIdChip } from '../../../../shared/ui/id-chip/id-chip';
import { UiRovingItem, UiRovingList } from '../../../../shared/ui/roving-list.directive';

/** core's `TasksTab` as the tasks route serves it (`null` there means the spec has no tasks.md). */
export type TasksBody = NonNullable<SpecRouteResponses['tasks']>;
export type TaskRowView = TasksBody['tasks'][number];

/** What a row's check sub-line says, as visible text (never a tooltip): a lock, a 409, a failed write, no hash. */
export type CheckLine =
  | { readonly kind: 'locked'; readonly session: string }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failed'; readonly status: number }
  | { readonly kind: 'no-hash' };

/** The statuses whose round card carries a reason worth a sub-line (a hold, a fail, a question, concerns). */
const REASONED = new Set(['held', 'fail', 'concerns', 'question']);

/** `T1, T2, …, T26, T30` → `T1–T26, T30`: consecutive numbers fold into a range, file order kept. */
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
 */
@Component({
  selector: 'app-tasks-tab',
  imports: [RouterLink, TranslocoPipe, UiChip, UiEmptyState, UiFilterChips, UiIcon, UiIdChip, UiRovingItem, UiRovingList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'tasks' },
  templateUrl: './tasks-tab.html',
  styleUrl: './tasks-tab.css',
})
export class TasksTab {
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
    const all: FilterOption = { key: 'all', label: this.transloco.translate('tasks.filters.all'), count: body.counts.rows };
    return [all, ...body.counts.byLane.map((c) => ({ key: c.name, label: c.name, count: c.count }))];
  });
  protected readonly statusOptions = computed<readonly FilterOption[]>(() => {
    this.lang();
    const body = this.body();
    if (!body) return [];
    const all: FilterOption = { key: 'all', label: this.transloco.translate('tasks.filters.all'), count: body.counts.rows };
    return [all, ...body.counts.byStatus.map((c) => ({ key: c.name, label: this.transloco.translate(`tasks.status.${c.name}`), count: c.count }))];
  });

  /** Every row as it stands after the writes this list has seen accepted. */
  private readonly written = computed<readonly TaskRowView[]>(() => {
    const checks = this.checks();
    return (this.body()?.tasks ?? []).map((row) => withCheck(row, checks.get(row.id) ?? IDLE));
  });
  /** "Boxes ticked", moved by the accepted writes. */
  protected readonly landed = computed(() => {
    const checks = this.checks();
    const tasks = this.body()?.tasks ?? [];
    return tasks.reduce((sum, row) => sum + landedDelta(row, checks.get(row.id) ?? IDLE), this.body()?.counts.boxes.landed ?? 0);
  });

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

  /** The task a `#task-T<n>` fragment names. */
  protected readonly target = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith('task-') ? fragment.slice('task-'.length) : null;
  });

  private scrolledTo: string | null = null;

  constructor() {
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
  protected sub(row: TaskRowView): { readonly key: string; readonly text?: string } | null {
    if (row.state === 'struck') return row.note === null ? null : { key: 'tasks.sub.struck', text: row.note };
    if (REASONED.has(row.status) && row.reason !== null) return { key: `tasks.sub.${row.status}`, text: row.reason };
    if (row.lane === 'operator' && row.state === 'open') return { key: 'tasks.sub.operator' };
    return null;
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
    if (ws === null || id === null || hash === null || this.blocked(row)) return;
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
