import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, type TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { RefreshService } from '../../core/refresh.service';
import { SettingsService } from '../../core/settings.service';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { Brief, type BriefModel } from './brief/brief';
import { ContextRail } from './context-rail/context-rail';
import type { DashboardView } from './context-rail/dashboard-view';
import { KpiBand, type KpiBandModel } from './kpi-band/kpi-band';
import { SpecInspector } from './spec-inspector/spec-inspector';
import { SpecTable } from './spec-table/spec-table';
import { WarningsPanel } from './warnings-panel/warnings-panel';
import { holdNewRows, type ListQuery, listQueryParams, parseListQuery, readArchiveRows, readSpecRows } from './spec-table/spec-table-model';

/**
 * The workspace dashboard `/w/:ws` (spec 001, design.md § Desktop / Tablet / Mobile Soll): KPI band, Brief, Next up,
 * the Specs panel and the warnings in one column below wide; at wide Next up and the warnings move into the shell's
 * context rail through `RailContent` (spec 002's rail slot), so the main column holds band, Brief and Specs.
 *
 * The KPI band (T61), the Brief (T62) and Next up with the warnings (T64, `app-context-rail`, which registers the rail
 * blocks at wide) are wired here. The section ids `specs`, `archive` (spec table), `next-up` and `warnings` (their own
 * components) are the targets of the tiles, the `g` jumps and the header's spec picker.
 *
 * Filter, sort and takeable are query state (`?phase=&type=&sort=&takeable=`), read from and written to the URL.
 *
 * The spec preview (T69, ISC-61.1) is query state too: `?spec=<id>`, set by a row's first activation (Enter or a
 * click). `app-spec-inspector` shows it in the rail at wide (in place of Next up and Warnings, through the one
 * context-rail registration), in a 480 px side sheet at medium and in a sheet at compact. With a preview open, Esc
 * clears `?spec` and returns focus to the row, `[` `]` step through the panel's current order. These keys are the
 * `SHORTCUTS` table's own `leave-spec` / `prev-spec` / `next-spec` bindings, which the keyboard service runs only on a
 * spec route; on the dashboard the page takes them while a preview is open (`onKeydown`).
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [TranslocoPipe, NotFound, UiNotice, UiSheet, KpiBand, Brief, ContextRail, SpecInspector, SpecTable, WarningsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
  host: { 'data-page': 'workspace', '(document:keydown)': 'onKeydown($event)' },
})
export class DashboardPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);

  private readonly params = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly query = computed(() => parseListQuery(this.params()));

  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly name = computed(() => this.data.workspaceName(this.ws()));
  protected readonly body = computed(() => {
    const result = this.data.dashboard.value();
    return result?.kind === 'ok' ? result.body : null;
  });
  /**
   * The dashboard body read through the narrow structural views the components declare: core's model type is not
   * importable under the web tsconfig (see `DashboardBody`), so each component names only the fields it reads.
   */
  protected readonly view = computed(() => readView(this.body()));
  protected readonly rows = computed(() => readSpecRows(this.body()));

  /** The live refresh's marks (T68): the KPI tint, the row dots; the page holds back new specs itself. */
  protected readonly refresh = inject(RefreshService);
  /**
   * The active spec ids the reader has seen on this workspace (design.md § Live update: new specs never reflow under
   * the reader). Taken from the first loaded body of a workspace and kept across refreshes; `showPending` adds the rest.
   */
  private readonly seen = linkedSignal<{ ws: string; loaded: boolean; ids: readonly string[] }, ReadonlySet<string> | null>({
    source: () => ({ ws: this.ws(), loaded: this.body() !== null, ids: this.rows().map((row) => row.id) }),
    computation: (source, previous) => {
      if (!source.loaded) return null;
      const kept = previous?.source.ws === source.ws && previous.source.loaded ? previous.value : null;
      return kept ?? new Set(source.ids);
    },
  });
  /** The rows the Specs panel lists and the new ones it offers behind the pill. */
  protected readonly held = computed(() => holdNewRows(this.rows(), this.seen()));

  /** The pill: the held-back specs join the list, on the reader's input. */
  protected showPending(): void {
    this.seen.set(new Set(this.rows().map((row) => row.id)));
  }
  protected readonly archive = computed(() => readArchiveRows(this.body()));
  /** The warnings sit in the rail at wide, after the Specs panel below it. */
  protected readonly railHolds = computed(() => this.state.tier() === 'wide');

  private readonly table = viewChild(SpecTable);
  private readonly inspectorRail = viewChild<TemplateRef<unknown>>('inspectorRail');
  /** The previewed spec id as the URL names it (`?spec=<id>`). */
  protected readonly previewId = computed(() => this.params().get('spec'));
  /** The previewed spec's row; null when `?spec` is unset or names no active spec. */
  protected readonly preview = computed(() => {
    const id = this.previewId();
    return id === null ? null : (this.rows().find((row) => row.id === id) ?? null);
  });
  protected readonly previewWarnings = computed(() => {
    const id = this.preview()?.id;
    return this.view()?.specs.find((spec) => spec.id === id)?.warnings ?? [];
  });
  /** The previewed spec's neighbours in the panel's current (filtered, sorted) order. */
  protected readonly neighbours = computed(() => {
    const id = this.preview()?.id;
    const order = this.table()?.visibleIds() ?? [];
    const index = id === undefined ? -1 : order.indexOf(id);
    return index < 0 ? { prev: null, next: null } : { prev: order[index - 1] ?? null, next: order[index + 1] ?? null };
  });
  /** At wide the inspector stands in for the rail's blocks; below wide it opens as a sheet. */
  protected readonly railInspector = computed(() => (this.railHolds() && this.preview() !== null ? (this.inspectorRail() ?? null) : null));
  protected readonly sheetOpen = computed(() => !this.railHolds() && this.preview() !== null);

  protected setQuery(query: ListQuery): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: listQueryParams(query),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Closes the preview: clears `?spec` and puts focus back on the spec's row. */
  protected closePreview(): void {
    const id = this.previewId();
    if (id === null) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { spec: null }, queryParamsHandling: 'merge' }).then(() => {
      this.table()?.focusRow(id);
    });
  }

  /** The sheet closed itself (Esc, backdrop, close button). */
  protected sheetChange(open: boolean): void {
    if (!open) this.closePreview();
  }

  /** `[` `]`: the previous / next spec of the panel's current order becomes the preview; the selection follows it. */
  private step(delta: -1 | 1): boolean {
    const { prev, next } = this.neighbours();
    const target = delta < 0 ? prev : next;
    if (target === null) return false;
    const onRow = (this.document.activeElement?.closest('[data-spec-row]') ?? null) !== null;
    void this.router
      .navigate([], { relativeTo: this.route, queryParams: { spec: target }, queryParamsHandling: 'merge', replaceUrl: true })
      .then(() => {
        if (onRow) this.table()?.focusRow(target);
      });
    return true;
  }

  /**
   * Esc, `[` and `]` while a preview is open. Like the keyboard service: never from a field, never with a modifier, and
   * never while another dialog or popover owns the keyboard (the preview's own sheet excepted); `[` `]` only with
   * single-key shortcuts on.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (this.preview() === null || event.defaultPrevented || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (target?.closest('dialog, [popover]') && !target.closest('[data-inspector-sheet]')) return;
    let handled = false;
    if (event.key === 'Escape') {
      this.closePreview();
      handled = true;
    } else if ((event.key === '[' || event.key === ']') && this.settings.settings().singleKeyShortcuts) {
      handled = this.step(event.key === '[' ? -1 : 1);
    }
    if (handled) event.preventDefault();
  }
}

type DashboardPageView = DashboardView & KpiBandModel & { readonly brief: BriefModel | null };

/** The body as the components' view, or null when it lacks the KPI block and the spec rows they all read. */
function readView(body: unknown): DashboardPageView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { kpis, specs } = body as { kpis?: unknown; specs?: unknown };
  return typeof kpis === 'object' && kpis !== null && Array.isArray(specs) ? (body as DashboardPageView) : null;
}
