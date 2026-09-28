import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { type Tone, toneColor, toneInk, toneTint } from '../tone';

export type NoticeTone = 'warning' | 'error' | 'info';

const TONE: Record<NoticeTone, Tone> = { warning: 'warning', error: 'error', info: 'primary' };

/**
 * An inline notice (design.md § States: unreadable workspace, server unreachable): tinted surface, 3 px left edge in
 * the tone, an icon, the projected message and an optional `[action]` slot (Retry). `warning` is the inherited
 * `--hover` orange. `error` is an alert; the others are a polite status, so a refresh never interrupts the reader.
 */
@Component({
  selector: 'ui-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  host: {
    '[attr.role]': 'tone() === "error" ? "alert" : "status"',
    '[attr.data-tone]': 'tone()',
    '[style.--notice-color]': 'colors().color',
    '[style.--notice-tint]': 'colors().tint',
    '[style.--notice-ink]': 'colors().ink',
  },
  styles: `
    :host { display: flex; gap: 8px 16px; align-items: center; padding: 8px 16px; border: 1px solid var(--line); border-radius: var(--radius-field); background: var(--notice-tint); box-shadow: inset 3px 0 0 var(--notice-color); font-size: 14px; line-height: 20px; }
    .icon { display: inline-flex; color: var(--notice-ink); }
    .message { flex: 1; min-inline-size: 0; }
    .action:empty { display: none; }
    @media (forced-colors: active) {
      :host { box-shadow: none; border-inline-start: 3px solid CanvasText; }
    }
  `,
  template: `
    <span class="icon"><ui-icon [name]="icon()" [size]="16" /></span>
    <div class="message"><ng-content /></div>
    <div class="action"><ng-content select="[action]" /></div>
  `,
})
export class UiNotice {
  readonly tone = input<NoticeTone>('warning');
  readonly icon = input<IconName>('triangle-alert');

  protected readonly colors = computed(() => {
    const tone = TONE[this.tone()];
    return { color: toneColor(tone), tint: toneTint(tone), ink: toneInk(tone) };
  });
}
