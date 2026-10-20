import { DestroyRef, DOCUMENT, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { LiveUpdate } from '../../../../server/src/spec-routes.contract';
import { ShellData } from '../layout/shell/shell-data.service';
import { ShellState } from '../layout/shell/shell-state.service';
import { ApiClient } from './api.service';
import { LiveStreamService } from './live-stream.service';

/**
 * The fallback poll's period (spec 053, ISC-317): a fixed 60 s while the live stream is disconnected and the page is
 * visible. A constant, never a setting; the stream is the primary path.
 */
export const FALLBACK_POLL_MS = 60_000;

/** What one refresh changed on the open workspace's dashboard, keyed stably so the view can mark it in place. */
export interface DashboardDiff {
  /** Dotted paths of the numeric KPI leaves whose value changed (`claims.closed`), sorted. */
  readonly kpis: readonly string[];
  /** Ids of the active spec rows present before and after whose content changed. */
  readonly rows: readonly string[];
  /** Ids of the active spec rows that were not there before. */
  readonly added: readonly string[];
}

const NO_CHANGE: DashboardDiff = { kpis: [], rows: [], added: [] };

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);

function leaves(value: unknown, prefix: string, into: Map<string, number>): Map<string, number> {
  if (typeof value === 'number') into.set(prefix, value);
  else if (isLoose(value)) for (const [key, inner] of Object.entries(value)) leaves(inner, prefix === '' ? key : `${prefix}.${key}`, into);
  return into;
}

function rowsById(body: Loose): Map<string, string> {
  const list = body['specs'];
  const rows = new Map<string, string>();
  if (!Array.isArray(list)) return rows;
  for (const row of list) {
    if (isLoose(row) && typeof row['id'] === 'string') rows.set(row['id'], JSON.stringify(row));
  }
  return rows;
}

/**
 * The in-place diff of two dashboard bodies (design.md § Live update): KPI leaves by path, spec rows by id. The body
 * is core's `DashboardModel`, read narrowly as `ShellData` reads it (see `DashboardBody` in api.service.ts); a first
 * body (`before` not an object) is no change.
 */
export function diffDashboards(before: unknown, after: unknown): DashboardDiff {
  if (!isLoose(before) || !isLoose(after)) return NO_CHANGE;
  const was = leaves(before['kpis'], '', new Map());
  const now = leaves(after['kpis'], '', new Map());
  const kpis = [...now].filter(([path, value]) => was.has(path) && was.get(path) !== value).map(([path]) => path).sort();
  const oldRows = rowsById(before);
  const rows: string[] = [];
  const added: string[] = [];
  for (const [id, row] of rowsById(after)) {
    const old = oldRows.get(id);
    if (old === undefined) added.push(id);
    else if (old !== row) rows.push(id);
  }
  return { kpis, rows, added };
}

/**
 * The live refresh (T68, ISC-62; spec 030, ISC-28; design.md § Header, § Live update). The live update stream
 * (`LiveStreamService`) is the primary path: each `update` frame is put into `ApiClient`'s ETag cache (`prime`), and
 * when it names the open workspace the shell's `resource()`s reload through that cache, so each read is a 304 that
 * renders the frame's body through the same `ApiClient` read a poll takes, never a body set from outside it. The
 * poll is the fallback: only while the stream is not connected, every `FALLBACK_POLL_MS` (60 s) while the page is
 * visible; after a reconnect the shell refreshes once to catch what the gap missed. Once when the page becomes visible
 * again it refreshes either way. A 304 costs no body, and a reload keeps the resources' last value, so no view is torn
 * down and the DOM nodes holding a number keep their identity while the number changes. The palette's "Refresh now"
 * and the `r` key call `refresh()`.
 * After each refresh, streamed or polled, the diff is exposed for in-place marks (`changedKpis`, `changedRows`,
 * `newSpecs`) and put into one polite `announcement`, only when something changed.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly api = inject(ApiClient);
  private readonly live = inject(LiveStreamService);
  private readonly document = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);

  private readonly changedKpisState = signal<ReadonlySet<string>>(new Set());
  private readonly changedRowsState = signal<ReadonlySet<string>>(new Set());
  private readonly newSpecsState = signal(0);
  private readonly announcementState = signal<string | null>(null);
  private readonly lastRefreshState = signal(Date.now());
  private readonly refreshesState = signal(0);

  /** KPI paths (`claims.closed`) the last refresh changed: the value tint. */
  readonly changedKpis = this.changedKpisState.asReadonly();
  /** Spec row ids the last refresh changed: the row dot. */
  readonly changedRows = this.changedRowsState.asReadonly();
  /** Specs the last refresh added: the "n new" pill. */
  readonly newSpecs = this.newSpecsState.asReadonly();
  /** The polite live-region text of the last refresh that changed something; null before one did. */
  readonly announcement = this.announcementState.asReadonly();
  /**
   * When the shell's data was last read (epoch ms): app start, then every settled reload of the dashboard and every
   * `refresh()`. The header's "Updated 12 s ago" (spec 024 T40) reads it.
   */
  readonly lastRefresh = this.lastRefreshState.asReadonly();
  /**
   * How many refreshes ran (timer, visibility, "Refresh now", `r`), never a settled dashboard read. A page resource
   * outside `ShellData` (the library's catalog and its open document, spec 017) reloads when it changes, so it rides
   * the same refresh as the shell's resources.
   */
  readonly refreshes = this.refreshesState.asReadonly();

  /** The dashboard body the refresh in flight started from; `undefined` while none is in flight. */
  private before: unknown;

  constructor() {
    effect((onCleanup) => {
      if (this.live.connected()) return;
      const timer = setInterval(() => {
        if (this.document.visibilityState === 'visible') this.refresh();
      }, FALLBACK_POLL_MS);
      onCleanup(() => clearInterval(timer));
    });

    let opened = false;
    effect(() => {
      if (!this.live.connected()) return;
      if (opened) untracked(() => this.refresh());
      opened = true;
    });

    // Every frame, as it arrives: a signal would keep only the last of two frames that land before effects run.
    inject(DestroyRef).onDestroy(this.live.onUpdate((update) => this.apply(update)));

    effect(() => {
      const result = this.data.dashboard.value() as { kind?: string; body?: unknown } | undefined;
      const status = this.data.dashboard.status();
      if (status === 'reloading' || status === 'loading') return;
      untracked(() => {
        if (status === 'resolved') this.lastRefreshState.set(Date.now());
        this.settle(result?.kind === 'ok' ? result.body : undefined);
      });
    });

    const onVisibility = (): void => {
      if (this.document.visibilityState === 'visible') this.refresh();
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => this.document.removeEventListener('visibilitychange', onVisibility));
  }

  /** Refresh now: reload what the shell shows, in place. */
  refresh(): void {
    const current = this.data.dashboard.value() as { kind?: string; body?: unknown } | undefined;
    this.before = current?.kind === 'ok' ? current.body : null;
    this.data.workspaces.reload();
    this.data.dashboard.reload();
    this.data.planning.reload();
    this.data.spec.reload();
    this.refreshesState.update((count) => count + 1);
    this.lastRefreshState.set(Date.now());
  }

  /**
   * One frame of the live update stream (spec 030, ISC-28): every view goes into the ETag cache under the read path the
   * server built it for. The workspace list is no workspace's, so it reloads on every frame; the open workspace's frame
   * then refreshes the shell as a poll would, and the reads answer 304 with the frame's bodies. The open spec reloads
   * whether or not a view names its path, since the route may name it by folder or slug while the stream names the id;
   * a frame for another workspace touches nothing else.
   */
  apply(update: LiveUpdate): void {
    for (const view of update.views) this.api.prime(view.path, view.etag, view.body);
    if (update.ws === this.state.ws()) this.refresh();
    else this.data.workspaces.reload();
  }

  private settle(after: unknown): void {
    if (this.before === undefined || after === undefined) return;
    const diff = diffDashboards(this.before, after);
    this.before = undefined;
    this.changedKpisState.set(new Set(diff.kpis));
    this.changedRowsState.set(new Set(diff.rows));
    this.newSpecsState.set(diff.added.length);
    const changed = diff.kpis.length + diff.rows.length;
    if (changed + diff.added.length === 0) return;
    this.announcementState.set(this.transloco.translate('refresh.announcement', { changed, added: diff.added.length }));
  }
}
