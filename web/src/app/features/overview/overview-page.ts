import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { OverviewData } from './overview-data.service';
import { WorkspaceColumn } from './workspace-column';

/**
 * `/`, all workspaces side by side (T65, ISC-16; prototype `index.html`, `app.js` `pageOverview`): the page head
 * (eyebrow "ALL WORKSPACES · n", title) and `.overview`, an auto-fit grid of `workspace-column`s at least 360 px wide,
 * three equal columns from 1300 px of shell width. An unreadable workspace keeps its place in the grid with a notice;
 * no workspace at all is the "Add your first workspace" empty state with `spectant add <path>`. The footnote names the
 * loopback origin the app is served from (prototype `.footer-note`, "Running locally at http://127.0.0.1:7717").
 */
@Component({
  selector: 'app-overview-page',
  imports: [NgTemplateOutlet, TranslocoPipe, UiCard, UiCommandChip, UiIcon, UiNotice, UiPageHead, UiSkeleton, WorkspaceColumn],
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
  protected readonly origin = inject(DOCUMENT).location.origin;
}
