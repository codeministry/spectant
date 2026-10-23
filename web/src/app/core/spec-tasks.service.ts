import { computed, inject, Injectable, resource, signal, type Signal } from '@angular/core';
import type { SpecRouteResponses } from '../../../../server/src/contracts/spec-routes.contract';
import { ApiClient, type TaskCheckResult } from './api.service';
import { type CheckLock, TaskChecks } from './model/task-check';

type TaskRowView = NonNullable<SpecRouteResponses['tasks']>['tasks'][number];

const NO_LOCK: Signal<CheckLock> = signal(null).asReadonly();

/**
 * The tasks of one spec outside the Tasks tab (spec 067, T32, ISC-535): read through the tasks route only once a host
 * asks for a spec (`load`, a selection), each row with the Tasks tab's checkbox (`TaskChecks`, write path 2 unchanged).
 * A host provides its own instance; a tick shows its new state in place, without reading the list again.
 */
@Injectable()
export class SpecTasks {
  private readonly api = inject(ApiClient);
  private readonly target = signal<{ readonly ws: string; readonly id: string } | null>(null, {
    equal: (a, b) => a?.ws === b?.ws && a?.id === b?.id,
  });
  private readonly lockFeed = signal<Signal<CheckLock>>(NO_LOCK);

  /** The tasks route's answer for the spec asked for; idle (nothing read) until `load`. */
  readonly result = resource({ params: () => this.target() ?? undefined, loader: ({ params }) => this.api.tasks(params.ws, params.id) });

  private readonly read = computed(() => {
    const result = this.result.hasValue() ? this.result.value() : undefined;
    return result?.kind === 'ok' ? result : null;
  });
  /** True once the route answered anything but `ok`. */
  readonly failed = computed(() => {
    const result = this.result.hasValue() ? this.result.value() : undefined;
    return result !== undefined && result.kind !== 'ok';
  });

  /** The write state of every box; a new read drops it. */
  readonly checks = new TaskChecks({
    read: () => this.read(),
    hash: () => this.read()?.hash ?? null,
    write: (ws, id, tid, hash, checked) => this.api.taskCheck(ws, id, tid, hash, checked),
    lock: () => this.lockFeed()(),
  });

  /** Every task of the read, each as it stands after the writes this read has seen accepted. */
  readonly rows = computed<readonly TaskRowView[]>(() => (this.read()?.body?.tasks ?? []).map((row) => this.checks.row(row)));

  /** The tasks open in the read; a task ticked here stays in place, ticked, until the next read. */
  readonly open = computed<readonly TaskRowView[]>(() =>
    (this.read()?.body?.tasks ?? []).filter((row) => row.state === 'open').map((row) => this.checks.row(row)),
  );

  /** The tasks anchored on one claim, in file order. */
  ofClaim(claim: string): readonly TaskRowView[] {
    return this.rows().filter((row) => row.claim === claim);
  }

  /** Reads the tasks of one spec; the spec already read is no second read. */
  load(ws: string, id: string): void {
    this.target.set({ ws, id });
  }

  /** Connects the lock source that blocks a box on a held claim (the shell's, when this spec is the one open). */
  connectLock(lock: Signal<CheckLock>): void {
    this.lockFeed.set(lock);
  }

  /** A tick through write path 2; the answer once applied, null when nothing was sent or the list was read again. */
  tick(row: TaskRowView, checked: boolean): Promise<TaskCheckResult | null> {
    const target = this.target();
    return target === null ? Promise.resolve(null) : this.checks.tick(target.ws, target.id, row, checked);
  }

  /** The 409's Reload: clear the row's alert and read the list again. */
  reload(row: TaskRowView): void {
    this.checks.reset(row.id);
    this.result.reload();
  }
}
