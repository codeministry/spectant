import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { RefreshService } from '../../layout/shell/refresh.service';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { fragmentTarget } from '../../shared/arrival';
import { OpenState } from '../../shared/open-state';
import { UiWorkingBlock } from '../../shared/ui/guidance/working-block';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { Brief, type BriefModel } from '../../shared/brief/brief';
import { type DashboardView, dashboardViewOf } from './context-rail/dashboard-view';
import { WaitingSection } from './context-rail/waiting-section';
import { KpiBand, type KpiBandModel } from './kpi-band/kpi-band';
import { NextUpList } from './next-up-list/next-up-list';
import { WARNINGS_HEADING, WarningsPanel } from './warnings-panel/warnings-panel';
import { workspacePage } from './workspace-page';

/**
 * The workspace dashboard `/w/:ws` (spec 058, design.md § Across viewports): the head, then the KPI band, the TL;DR,
 * the row `.lists` (spec 064: the section `#waiting`, "Waits on you", and the block "In progress"), Next up, the
 * warnings `#warnings`, in the same DOM and visual order at every tier. The row sets its two lists
 * side by side where both fit 480 px and stacks them below; without a held claim "In progress" renders nothing and
 * the waits take the row. The shell gives this page no rail; the spec list and the backlog are the Specs page's
 * (`/w/:ws/specs`).
 *
 * A stale TL;DR keeps the second place and arrives collapsed (the Brief's own short form). The block headings are h2
 * under the page's h1. While the body is loading the head stands alone, with a skeleton where the KPI band and Next
 * up will stand. The page selects nothing of its own and never docks the detail sidebar.
 *
 * The warnings' fold is the key `warnings` of `?open=` (spec 064, ISC-473 to ISC-475), as the TL;DR's is `tldr`: the
 * toggle writes or removes it and keeps every other key. Arriving over `#warnings` opens the fold (writing the key)
 * and focuses its heading once, after it has rendered.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [TranslocoPipe, NotFound, UiNotice, UiPageHead, UiSkeleton, UiWsBadge, UiWorkingBlock, KpiBand, Brief, WaitingSection, NextUpList, WarningsPanel],
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
  private readonly openState = inject(OpenState);

  /**
   * The open workspace and the dashboard body read through the
   * narrow structural views the components declare (`view`): core's model type is not importable under the web
   * tsconfig (see `DashboardBody`), so each component names only the fields it reads.
   */
  protected readonly page = workspacePage(this.state, this.data, readView);

  /** The spec titles by id, the waits tiles' main text (ISC-478). */
  protected readonly titles = computed(() => Object.fromEntries((this.page.view()?.specs ?? []).map((row) => [row.id, row.title])));

  /** The warnings stand open while `?open=` holds `warnings`. */
  protected readonly warningsOpen = computed(() => this.openState.isOpen('warnings'));

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const fragment = fragmentTarget();
    let arrived = false;
    afterRenderEffect(() => {
      if (fragment() !== WARNINGS_HEADING) {
        arrived = false;
        return;
      }
      this.page.view();
      const heading = host.querySelector<HTMLElement>(`h2[id="${WARNINGS_HEADING}"]`);
      if (arrived || !heading) return;
      arrived = true;
      if (!this.openState.isOpen('warnings')) void this.openState.set('warnings', true);
      heading.focus();
    });
  }

  protected setWarningsOpen(open: boolean): void {
    void this.openState.set('warnings', open);
  }
}

/** `tldrCommand` is core's (spec 074, ISC-627); absent in a model older than it, which the Brief reads as null. */
type DashboardPageView = DashboardView & KpiBandModel & { readonly brief: BriefModel | null; readonly tldrCommand?: string | null };

/** The body as the components' view, `working` included (`dashboardViewOf`); null while it lacks what they all read. */
function readView(body: unknown): DashboardPageView | null {
  return dashboardViewOf(body) as DashboardPageView | null;
}
