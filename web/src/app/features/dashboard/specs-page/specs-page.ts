import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, linkedSignal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { altTyped } from '../../../layout/shell/keyboard-bindings';
import { RefreshService } from '../../../layout/shell/refresh.service';
import { SettingsService } from '../../../core/settings.service';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { NotFound } from '../../../layout/not-found/not-found';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiNotice } from '../../../shared/ui/notice/notice';
import { UiPageHead } from '../../../shared/ui/page-head/page-head';
import { UiWsBadge } from '../../../shared/ui/ws-badge/ws-badge';
import type { DashboardView } from '../context-rail/dashboard-view';
import { type DashboardIdeas, IdeasPanel } from '../ideas-panel/ideas-panel';
import { SpecTable } from '../spec-table/spec-table';
import { workspacePage } from '../workspace-page';
import { holdNewRows, type ListQuery, listQueryParams, parseListQuery, readArchiveRows, readListCounts, readSpecRows } from '../spec-table/spec-table-model';

/**
 * The workspace's Specs page `/w/:ws/specs` (spec 058, T6, ISC-391): the page head, the spec list and the backlog, the
 * dashboard's blocks (KPI band, TL;DR, Waits on you, Next up, warnings) left on the dashboard. The eyebrow names the page
 * and its menu summary (`shell.pages.summary.specs`, active · archived), the h1 "Specs · <ws>".
 *
 * Filter, sort and takeable are query state (`?phase=&type=&sort=&takeable=`), read from and written to the URL, as on
 * the dashboard; the list holds back new specs behind its pill until the reader takes them in (design.md § Live update).
 *
 * The selection (T8, ISC-393): a row's activation selects `?sel=spec:<id>` and the page docks the detail sidebar
 * (`DetailSelection.dock`); `[` `]` step the selection through the list's current order while a spec is selected.
 */
@Component({
  selector: 'app-specs-page',
  imports: [TranslocoPipe, NotFound, UiNotice, UiPageHead, UiWsBadge, SpecTable, IdeasPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './specs-page.html',
  styleUrl: './specs-page.css',
  host: { 'data-page': 'specs', '(document:keydown)': 'onKeydown($event)' },
})
export class SpecsPage {
  protected readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);
  private readonly selection = inject(DetailSelection);

  constructor() {
    this.selection.dock(inject(DestroyRef));
  }

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly query = computed(() => parseListQuery(this.params()));

  /**
   * The open workspace, its path tail for the footnote and the body, `view` through the narrow view the spec list
   * reads (`kpis`, `guidance`; null while it lacks them).
   */
  protected readonly page = workspacePage(this.state, this.data, readView);
  private readonly body = this.page.body;
  protected readonly rows = computed(() => readSpecRows(this.body()));
  protected readonly archive = computed(() => readArchiveRows(this.body()));
  protected readonly listCounts = computed(() => readListCounts(this.body()));
  /** The backlog's stories (`DashboardModel.ideas`), none while the body lacks the block. */
  protected readonly ideas = computed(() => readIdeas(this.body()));
  /** The eyebrow's summary params, as the area menu's line for this page: active and archived specs. */
  protected readonly summary = computed(() => ({ active: this.rows().length, archived: this.page.view()?.kpis.archived ?? this.archive().length }));

  /** The live refresh's row marks (T68); the page holds back new specs itself. */
  protected readonly refresh = inject(RefreshService);
  /**
   * The active spec ids the reader has seen on this workspace: taken from the first loaded body of a workspace and kept
   * across refreshes, so new specs never reflow under the reader; `showPending` adds the rest.
   */
  private readonly seen = linkedSignal<{ ws: string; loaded: boolean; ids: readonly string[] }, ReadonlySet<string> | null>({
    source: () => ({ ws: this.page.ws(), loaded: this.body() !== null, ids: this.rows().map((row) => row.id) }),
    computation: (source, previous) => {
      if (!source.loaded) return null;
      const kept = previous?.source.ws === source.ws && previous.source.loaded ? previous.value : null;
      return kept ?? new Set(source.ids);
    },
  });
  /** The rows the list shows and the new ones it offers behind the pill. */
  protected readonly held = computed(() => holdNewRows(this.rows(), this.seen()));

  /** The pill: the held-back specs join the list, on the reader's input. */
  protected showPending(): void {
    this.seen.set(new Set(this.rows().map((row) => row.id)));
  }

  private readonly table = viewChild(SpecTable);
  /** The selected spec id as the URL names it (`?sel=spec:<id>`); null for no selection or another type. */
  protected readonly previewId = computed(() => {
    const ref = this.selection.selected();
    return ref?.startsWith('spec:') ? ref.slice('spec:'.length) : null;
  });
  /** The previewed spec's row; null when nothing is selected or the selection names no active spec. */
  protected readonly preview = computed(() => {
    const id = this.previewId();
    return id === null ? null : (this.rows().find((row) => row.id === id) ?? null);
  });
  /** The previewed spec's neighbours in the list's current (filtered, sorted) order. */
  protected readonly neighbours = computed(() => {
    const id = this.preview()?.id;
    const order = this.table()?.visibleIds() ?? [];
    const index = id === undefined ? -1 : order.indexOf(id);
    return index < 0 ? { prev: null, next: null } : { prev: order[index - 1] ?? null, next: order[index + 1] ?? null };
  });

  protected setQuery(query: ListQuery): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: listQueryParams(query),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** `[` `]`: the previous / next spec of the list's current order becomes the selection. */
  private step(delta: -1 | 1): boolean {
    const { prev, next } = this.neighbours();
    const target = delta < 0 ? prev : next;
    if (target === null) return false;
    const onRow = (this.document.activeElement?.closest('[data-spec-row]') ?? null) !== null;
    void this.selection.select(`spec:${target}`).then(() => {
      if (onRow) this.table()?.focusRow(target);
    });
    return true;
  }

  /**
   * `[` and `]` while a spec is selected (Escape is the sidebar's). Like the keyboard service: never from a field, never
   * with a modifier, never while a dialog or popover owns the keyboard, and only with single-key shortcuts on.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (this.preview() === null || event.defaultPrevented || event.isComposing) return;
    if ((event.ctrlKey || event.metaKey || event.altKey) && !altTyped(event)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (target?.closest('dialog, [popover]')) return;
    if ((event.key === '[' || event.key === ']') && this.settings.settings().singleKeyShortcuts && this.step(event.key === '[' ? -1 : 1)) {
      event.preventDefault();
    }
  }
}

const NO_IDEAS: DashboardIdeas = { count: 0, list: [] };

/** The body's `ideas` block as served, or none when it is missing or malformed. */
function readIdeas(body: unknown): DashboardIdeas {
  if (typeof body !== 'object' || body === null) return NO_IDEAS;
  const { ideas } = body as { ideas?: Partial<DashboardIdeas> | null };
  return typeof ideas?.count === 'number' && Array.isArray(ideas.list) ? (ideas as DashboardIdeas) : NO_IDEAS;
}

/** The body as the list's view, or null when it lacks the KPI block and the spec rows. */
function readView(body: unknown): DashboardView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { kpis, specs } = body as { kpis?: unknown; specs?: unknown };
  return typeof kpis === 'object' && kpis !== null && Array.isArray(specs) ? (body as DashboardView) : null;
}
