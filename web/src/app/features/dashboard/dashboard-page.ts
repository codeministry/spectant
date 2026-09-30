import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiNotice } from '../../shared/ui/notice/notice';
import { Brief, type BriefModel } from './brief/brief';
import { ContextRail } from './context-rail/context-rail';
import type { DashboardView } from './context-rail/dashboard-view';
import { KpiBand, type KpiBandModel } from './kpi-band/kpi-band';
import { SpecTable } from './spec-table/spec-table';
import { WarningsPanel } from './warnings-panel/warnings-panel';
import { type ListQuery, listQueryParams, parseListQuery, readArchiveRows, readSpecRows } from './spec-table/spec-table-model';

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
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [TranslocoPipe, NotFound, UiNotice, KpiBand, Brief, ContextRail, SpecTable, WarningsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
  host: { 'data-page': 'workspace' },
})
export class DashboardPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

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
  protected readonly archive = computed(() => readArchiveRows(this.body()));
  /** The warnings sit in the rail at wide, after the Specs panel below it. */
  protected readonly railHolds = computed(() => this.state.tier() === 'wide');

  protected setQuery(query: ListQuery): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: listQueryParams(query),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

type DashboardPageView = DashboardView & KpiBandModel & { readonly brief: BriefModel | null };

/** The body as the components' view, or null when it lacks the KPI block and the spec rows they all read. */
function readView(body: unknown): DashboardPageView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { kpis, specs } = body as { kpis?: unknown; specs?: unknown };
  return typeof kpis === 'object' && kpis !== null && Array.isArray(specs) ? (body as DashboardPageView) : null;
}
