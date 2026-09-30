import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { OverviewData } from './overview-data.service';
import { WorkspaceColumn } from './workspace-column';

/**
 * `/`, all workspaces side by side (T65, ISC-16; prototype `index.html`, `app.js` `pageOverview`): the page head
 * (eyebrow "ALL WORKSPACES · n", title) and `.overview`, an auto-fit grid of `workspace-column`s at least 360 px wide,
 * three equal columns from 1300 px of shell width. An unreadable workspace keeps its place in the grid with a notice;
 * no workspace at all is the "Add your first workspace" empty state with `spectant add <path>`.
 */
@Component({
  selector: 'app-overview-page',
  imports: [TranslocoPipe, UiCard, UiCommandChip, UiEmptyState, UiNotice, UiSkeleton, WorkspaceColumn],
  providers: [OverviewData],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'overview' },
  templateUrl: './overview-page.html',
  styleUrl: './overview-page.css',
})
export class OverviewPage {
  private readonly data = inject(OverviewData);

  protected readonly list = this.data.list;
  protected readonly failed = this.data.failed;
  protected readonly slots = this.data.slots;
  protected readonly count = computed(() => this.list()?.length ?? 0);
}
