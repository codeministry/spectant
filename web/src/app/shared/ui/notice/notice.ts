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
  styleUrl: './notice.css',
  templateUrl: './notice.html',
})
export class UiNotice {
  readonly tone = input<NoticeTone>('warning');
  readonly icon = input<IconName>('triangle-alert');

  protected readonly colors = computed(() => {
    const tone = TONE[this.tone()];
    return { color: toneColor(tone), tint: toneTint(tone), ink: toneInk(tone) };
  });
}
