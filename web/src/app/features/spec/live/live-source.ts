import { computed, DestroyRef, effect, inject, Injectable, resource, type ResourceRef, signal, untracked } from '@angular/core';
import type { SpecRouteResponses } from '../../../../../../server/src/contracts/spec-routes.contract';
import { type ApiResult, ApiClient, type TasksResult } from '../../../core/api.service';
import { RefreshService } from '../../../layout/shell/refresh.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { HistoryFrame } from './card/card-history';

/** The open spec's `…/live` answer as the views read it. */
export type LiveAnswer = ApiResult<SpecRouteResponses['live']>;

/**
 * The open spec's live frame, read once for every view that shows it (spec 057, ISC-371; review 024): the Board, an
 * open card's detail and the Matrix share this one `resource()` over `…/live`, so a refresh tick costs one read, not
 * one per reader. It reads only while a view holds it (`attach()`), and re-reads on every refresh by the count
 * (`RefreshService.refreshes()`, spec 015, ISC-233), never by the clock; a reload keeps the last value, so no view is
 * torn down while the answer is in flight.
 */
@Injectable({ providedIn: 'root' })
export class LiveSource {
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellState);
  private readonly refresher = inject(RefreshService);
  /** Each attached view's "I read now" predicate; the read runs while any of them holds. */
  private readonly readers = signal<ReadonlySet<() => boolean>>(new Set());
  private readonly reading = computed(() => [...this.readers()].some((wants) => wants()));

  // Same spec, same params: a second reader joining must not restart the read.
  private readonly params = computed(
    () => {
      const ws = this.shell.ws();
      const id = this.shell.specId();
      return this.reading() && ws !== null && id !== null ? { ws, id } : undefined;
    },
    { equal: (a, b) => a?.ws === b?.ws && a?.id === b?.id },
  );
  private readonly result = resource({ params: () => this.params(), loader: ({ params }) => this.api.live(params.ws, params.id) });

  constructor() {
    let seen: number | null = null;
    effect(() => {
      const count = this.refresher.refreshes();
      const first = seen === null;
      seen = count;
      if (!first) untracked(() => { if (this.reading()) this.result.reload(); });
    });
  }

  /**
   * Holds the live read for the calling view, while `wants()` is true, until the view is destroyed, and hands back the
   * shared answer (a card holds it only while its detail is open). Call it in an injection context.
   */
  attach(wants: () => boolean = () => true): ResourceRef<LiveAnswer | undefined> {
    this.readers.update((set) => new Set([...set, wants]));
    inject(DestroyRef).onDestroy(() => this.readers.update((set) => new Set([...set].filter((w) => w !== wants))));
    return this.result;
  }

  /**
   * The open spec's history frames (`…/frames`) for a card's state history, read while `wants()` holds (a card only
   * while its detail is open); a failed read is no history. Each caller owns its read. Call it in an injection context.
   */
  history(wants: () => boolean): ResourceRef<readonly HistoryFrame[] | undefined> {
    return resource({
      params: () => this.open(wants),
      loader: async ({ params }): Promise<readonly HistoryFrame[]> => {
        const history = await this.api.frames(params.ws, params.id);
        return history.kind === 'ok' ? history.body : [];
      },
    });
  }

  /**
   * The open spec's tasks.md read (`…/tasks`, core's parse) while `wants()` holds: the card detail's paths and probe,
   * the operator steps' rows. Each caller owns its read. Call it in an injection context.
   */
  tasks(wants: () => boolean): ResourceRef<TasksResult | undefined> {
    return resource({ params: () => this.open(wants), loader: ({ params }) => this.api.tasks(params.ws, params.id) });
  }

  /** The open spec while `wants()` holds, else undefined (a resource then stays idle). */
  private open(wants: () => boolean): { ws: string; id: string } | undefined {
    const ws = this.shell.ws();
    const id = this.shell.specId();
    return wants() && ws !== null && id !== null ? { ws, id } : undefined;
  }
}
