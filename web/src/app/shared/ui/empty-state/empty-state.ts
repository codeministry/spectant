import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';

/**
 * A centred empty state (design.md § States: zero workspaces, no specs, nothing takeable), at most 560 px wide:
 * icon, title, body and projected content, typically a `ui-command-chip` (`spectant add <path-to-repo>`).
 */
@Component({
  selector: 'ui-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  styleUrl: './empty-state.css',
  templateUrl: './empty-state.html',
})
export class UiEmptyState {
  readonly heading = input.required<string>();
  readonly body = input<string>();
  readonly icon = input<IconName>('folder-plus');
}
