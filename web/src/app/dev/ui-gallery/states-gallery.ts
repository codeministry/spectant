import { ChangeDetectionStrategy, Component } from '@angular/core';
import { WarningsPanel } from '../../features/dashboard/warnings-panel/warnings-panel';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard, UiCommandChip, UiEmptyState, UiNotice, UiSkeleton } from '../../shared/ui';
import { GalleryGate, type GateSample } from './gallery-samples';

/**
 * The state gallery (spec 024 T55) as the
 * section `[data-gallery="states"]` of `/__ui`: loading skeletons at final geometry, the empty states, the server
 * notice, the 409/423 conflict notices, the task checkbox and gate button states, the agent banner and reduced motion, each
 * rendered with the app's own components and static sample inputs (`gallery-samples.ts`). Dev-only strings.
 */
@Component({
  selector: 'app-states-gallery',
  imports: [GalleryGate, UiCard, UiCommandChip, UiEmptyState, UiIcon, UiNotice, UiSkeleton, WarningsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './states-gallery.html',
  styleUrl: './state-galleries.css',
})
export class StatesGallery {
  protected readonly noWarnings = { warnings: 0, fog: 0 };
  protected readonly gates: readonly GateSample[] = ['ready', 'stale', 'done', 'paused'];
}
