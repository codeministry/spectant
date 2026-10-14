import { DestroyRef, DOCUMENT, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { ShellData } from '../layout/shell/shell-data.service';
import { SettingsService } from './settings.service';

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
 * The live refresh (T68, ISC-62; design.md § Header, § Live update). Every `settings.refreshSeconds` while the page is
 * visible, and once when it becomes visible again, it reloads the shell's `resource()`s through `ApiClient`'s ETag
 * cache: a 304 costs no body, and a reload keeps the resources' last value, so no view is torn down and the DOM nodes
 * holding a number keep their identity while the number changes. The palette's "Refresh now" and the `r` key call
 * `refresh()`.
 * After each refresh the diff is exposed for in-place marks (`changedKpis`, `changedRows`, `newSpecs`)
 * and put into one polite `announcement`, only when something changed.
 */
@Injectable({ providedIn: 'root' })
export class RefreshService {
  private readonly data = inject(ShellData);
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);
  private readonly transloco = inject(TranslocoService);

  private readonly changedKpisState = signal<ReadonlySet<string>>(new Set());
  private readonly changedRowsState = signal<ReadonlySet<string>>(new Set());
  private readonly newSpecsState = signal(0);
  private readonly announcementState = signal<string | null>(null);
  private readonly lastRefreshState = signal(Date.now());

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

  /** The dashboard body the refresh in flight started from; `undefined` while none is in flight. */
  private before: unknown;

  constructor() {
    effect((onCleanup) => {
      const ms = this.settings.settings().refreshSeconds * 1000;
      const timer = setInterval(() => {
        if (this.document.visibilityState === 'visible') this.refresh();
      }, ms);
      onCleanup(() => clearInterval(timer));
    });

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
    this.lastRefreshState.set(Date.now());
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
