import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ItemRun } from '../../../../../core/src/files';
import { factsOf, type Relation } from '../../../../../core/src/relations';
import { LockSourceService } from '../../core/lock-source.service';
import { boardRowsOf } from '../../core/model/board-rows';
import type { CheckLock } from '../../core/model/task-check';
import { SpecTasks } from '../../core/spec-tasks.service';
import { UiIcon } from '../../shared/icons/icon';
import { nextId } from '../../shared/ui/overlay/ids';
import { releasableRun } from '../run-release/run-release';
import { specLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { CHILD_CAP } from './selection';

type TaskRow = ReturnType<SpecTasks['open']>[number];

/**
 * The tasks section of the detail sidebar (spec 067, T33, ISC-535): a spec's open tasks, a claim's open tasks anchored
 * on it (read from its holding spec), each with the Tasks tab's checkbox. The list is read through the tasks route only
 * once a selection names a spec (`SpecTasks.load`), five rows at most, then "+N more" to the spec's Tasks tab. A tick
 * goes through write path 2 (`TaskChecks`, unchanged) and shows in place: `aria-busy` while in flight, the ticked task
 * stays listed, ticked, until the next read; a lock, a 409 with Reload, a failed write or a missing hash show inline as
 * text. While a run is open on the spec every box is locked (`aria-disabled`, a click writes nothing), as in the Tasks
 * tab. Nothing renders when no open task is listed. Rows are 32 px, 44 px in the compact sheet.
 */
@Component({
  selector: 'app-sidebar-tasks',
  imports: [RouterLink, TranslocoPipe, UiIcon],
  providers: [SpecTasks],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Hidden without an open task, so the empty host takes no track (and no gap) in the sidebar body's grid (ISC-525).
  host: { '[attr.data-tier]': 'shell.tier()', '[hidden]': 'visible().length === 0' },
  styleUrl: './sidebar-tasks.css',
  templateUrl: './sidebar-tasks.html',
})
export class SidebarTasks {
  /** The selected spec or claim; any other type, or none, reads nothing and renders nothing. */
  readonly relation = input<Relation | null>(null);

  protected readonly shell = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly locks = inject(LockSourceService);
  protected readonly tasks = inject(SpecTasks);
  protected readonly ids = nextId('sidebar-tasks');

  /** The spec whose tasks.md is read: the spec itself, or a claim's holding spec (its first `spec:` parent). */
  protected readonly specId = computed<string | null>(() => {
    const entry = this.relation();
    if (entry?.type === 'spec') return entry.id;
    const holder = entry?.type === 'claim' ? entry.parents.find((ref) => ref.startsWith('spec:')) : undefined;
    return holder === undefined ? null : holder.slice('spec:'.length);
  });
  /** The claim whose anchored tasks are listed; null for a spec. */
  protected readonly claim = computed(() => {
    const entry = this.relation();
    return entry?.type === 'claim' ? entry.id : null;
  });

  /** The open tasks listed, in file order: all of the spec's, or the claim's; a task ticked here stays until the next read. */
  protected readonly listed = computed<readonly TaskRow[]>(() => {
    const claim = this.claim();
    const open = this.tasks.open();
    return claim === null ? open : open.filter((row) => row.claim === claim);
  });
  protected readonly visible = computed(() => this.listed().slice(0, CHILD_CAP));
  protected readonly hidden = computed(() => this.listed().length - this.visible().length);
  protected readonly moreLink = computed(() => {
    const ws = this.shell.ws();
    const id = this.specId();
    return ws === null || id === null ? null : specLink(ws, id, 'tasks');
  });

  /** The run open on the spec, from its dashboard row's item state (as the sidebar's run section reads it); null otherwise. */
  protected readonly run = computed<ItemRun | null>(() => {
    const id = this.specId();
    if (id === null) return null;
    const result = this.data.dashboard.value();
    const row = result?.kind === 'ok' ? boardRowsOf(result.body).find((r) => r.id === id) : undefined;
    return releasableRun(row?.state);
  });

  /**
   * The lock that blocks a box: the shell's lock source while this spec is the one open (it reads only that spec's
   * locks), else a claim's own lock holder from the planning facts; the server's 423 still names any other.
   */
  private readonly lock = computed<CheckLock>(() => {
    if (this.shell.specId() !== null && this.shell.specId() === this.specId()) return this.locks.lock();
    const entry = this.relation();
    const holder = entry?.type === 'claim' ? factsOf(entry, 'claim')?.lockHolder : undefined;
    return entry && holder ? { claim: entry.id, session: holder } : null;
  });

  constructor() {
    this.tasks.connectLock(this.lock);
    effect(() => {
      const ws = this.shell.ws();
      const id = this.specId();
      if (ws !== null && id !== null) untracked(() => this.tasks.load(ws, id));
    });
  }

  /** The box's description: the run lock, then its check line. */
  protected describedBy(row: TaskRow): string | null {
    const ids = [this.run() ? `${this.ids}-run` : null, this.tasks.checks.line(row) ? `${this.ids}-${row.id}-check` : null];
    return ids.filter((id) => id !== null).join(' ') || null;
  }

  /** A locked box stays focusable (`aria-disabled`), so its click is stopped before it toggles or writes. */
  protected guardRun(event: Event): void {
    if (this.run()) event.preventDefault();
  }

  protected tick(row: TaskRow, checked: boolean): void {
    if (this.run()) return;
    void this.tasks.tick(row, checked);
  }
}
