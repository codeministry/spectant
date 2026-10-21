import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiCard } from '../../shared/ui/card/card';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';

/** The board while the planning tree or the dashboard rows load, on the page's `div.board-loading`: three column skeletons. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the page's loading <div>, so the skeleton keeps its element
  selector: 'div[app-board-loading]',
  imports: [UiCard, UiSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-loading.html',
  styleUrl: './board-loading.css',
})
export class BoardLoading {}
