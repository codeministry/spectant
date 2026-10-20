import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RefreshService } from '../../core/refresh.service';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { Brief, type BriefModel } from './brief/brief';
import type { DashboardView } from './context-rail/dashboard-view';
import { WaitingSection } from './context-rail/waiting-section';
import { KpiBand, type KpiBandModel } from './kpi-band/kpi-band';
import { NextUpList } from './next-up-list/next-up-list';
import { WarningsPanel } from './warnings-panel/warnings-panel';

/**
 * The workspace dashboard `/w/:ws` (spec 058, design.md § Across viewports): the head, then the KPI band, the TL;DR,
 * the section `#waiting` ("Waits on you"), Next up, the warnings `#warnings` and the footnote, in one column and in
 * the same DOM and visual order at every tier. The shell gives this page no rail; the spec list and the backlog are
 * the Specs page's (`/w/:ws/specs`).
 *
 * A stale TL;DR keeps the second place and arrives collapsed (the Brief's own short form). The block headings are h2
 * under the page's h1. While the body is loading the head stands alone, with a skeleton where the KPI band and Next
 * up will stand. The page selects nothing of its own and never docks the detail sidebar.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [TranslocoPipe, NotFound, UiNotice, UiPageHead, UiSkeleton, UiWsBadge, KpiBand, Brief, WaitingSection, NextUpList, WarningsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.css',
  host: { 'data-page': 'workspace' },
})
export class DashboardPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  /** The live refresh's KPI tint (T68); the list's row marks belong to the Specs page. */
  protected readonly refresh = inject(RefreshService);

  protected readonly ws = computed(() => this.state.ws() ?? '');
  /** The registry's path tail of the open workspace, for the prototype's footnote (spec 024); '' while unknown. */
  protected readonly pathTail = computed(() => this.data.workspaceList().find((entry) => entry.slug === this.ws())?.pathTail ?? '');
  private readonly body = computed(() => {
    const result = this.data.dashboard.value();
    return result?.kind === 'ok' ? result.body : null;
  });
  /**
   * The dashboard body read through the narrow structural views the components declare: core's model type is not
   * importable under the web tsconfig (see `DashboardBody`), so each component names only the fields it reads.
   */
  protected readonly view = computed(() => readView(this.body()));
}

type DashboardPageView = DashboardView & KpiBandModel & { readonly brief: BriefModel | null };

/** The body as the components' view, or null when it lacks the KPI block and the spec rows they all read. */
function readView(body: unknown): DashboardPageView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { kpis, specs } = body as { kpis?: unknown; specs?: unknown };
  return typeof kpis === 'object' && kpis !== null && Array.isArray(specs) ? (body as DashboardPageView) : null;
}
