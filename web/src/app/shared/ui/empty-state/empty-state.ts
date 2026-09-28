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
  styles: `
    :host { display: grid; gap: 8px; justify-items: center; max-inline-size: 560px; margin-inline: auto; padding: 32px 16px; text-align: center; }
    .icon { display: grid; place-items: center; inline-size: 48px; block-size: 48px; margin-block-end: 8px; border-radius: 50%; background: var(--disp-t); color: var(--disp-ink); }
    .title { margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; }
    .body { margin: 0; color: var(--muted-ink); font-size: 14px; line-height: 20px; text-wrap: pretty; }
    .slot:empty { display: none; }
    .slot { margin-block-start: 8px; }
  `,
  template: `
    <span class="icon"><ui-icon [name]="icon()" [size]="24" /></span>
    <p class="title">{{ heading() }}</p>
    @if (body()) {
      <p class="body">{{ body() }}</p>
    }
    <div class="slot"><ng-content /></div>
  `,
})
export class UiEmptyState {
  readonly heading = input.required<string>();
  readonly body = input<string>();
  readonly icon = input<IconName>('folder-plus');
}
