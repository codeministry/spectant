import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { BoardRefusal } from '../../features/board/board-drag';
import { RefusalNotice } from '../../features/board/refusal-notice';
import { WarningsPanel } from '../../features/dashboard/warnings-panel/warnings-panel';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard, UiCommandChip, UiEmptyState, UiNotice, UiSkeleton } from '../../shared/ui';
import { GalleryGate, type GateSample } from './gallery-samples';

/**
 * The state gallery (T55; prototype `states.html`: `app.js` `pageStates` plus `pages.js` `SPECTANT_STATES`) as the
 * section `[data-gallery="states"]` of `/__ui`: loading skeletons at final geometry, the empty states, the server
 * notice, the 409/423 refusal, the task checkbox and gate button states, the agent banner and reduced motion, each
 * rendered with the app's own components and static sample inputs (`gallery-samples.ts`). Dev-only strings.
 */
@Component({
  selector: 'app-states-gallery',
  imports: [GalleryGate, RefusalNotice, UiCard, UiCommandChip, UiEmptyState, UiIcon, UiNotice, UiSkeleton, WarningsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './states-gallery.html',
  styleUrl: './state-galleries.css',
})
export class StatesGallery {
  protected readonly noWarnings = { warnings: 0, fog: 0 };
  protected readonly gates: readonly GateSample[] = ['ready', 'stale', 'done', 'paused'];
  protected readonly conflict: BoardRefusal = { key: 'conflict', id: '005', stage: 'tasks', to: 'review', kind: 'stale' };
  protected readonly locked: BoardRefusal = { key: 'locked', id: '002', stage: 'build', to: 'review', kind: 'locked', session: 'spec-002-ISC-333', claim: 'ISC-333' };
}
