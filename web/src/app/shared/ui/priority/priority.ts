import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Priority } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { type Tone, toneInk, toneTint } from '../tone';

/** A missing or invalid `priority:` reads as this level (FORMAT.md, ISC-118). */
export const DEFAULT_PRIORITY: Priority = 'P3';

export interface PriorityLook {
  readonly icon: IconName;
  /** The tinted levels' tone; null for the outlined ones. */
  readonly tone: Tone | null;
  readonly ink: string;
}

/**
 * Glyph and look per level (ISC-118): P1 and P2 sit on their tone's tint with its ink; P3 and P4 are outlines, P3 in
 * the neutral ink, P4 in the muted one. The glyph's shape carries the level as well, so colour is never alone.
 */
export const PRIORITY_LOOK: Readonly<Record<Priority, PriorityLook>> = {
  P1: { icon: 'chevrons-up', tone: 'error', ink: toneInk('error') },
  P2: { icon: 'chevron-up', tone: 'warning', ink: toneInk('warning') },
  P3: { icon: 'minus', tone: null, ink: toneInk('neutral') },
  P4: { icon: 'chevron-down', tone: null, ink: 'var(--muted-ink)' },
};

/**
 * The priority chip of the board card, the dashboard row, the spec head and the breadcrumb (DS-APP-26): the level's
 * glyph and its text `P1`…`P4`, always together and never truncated. Its accessible name is "priority P1"; the
 * tooltip adds the level's short word. A missing value renders as P3 with a dashed outline (`data-unmarked`), which is
 * information, not a diagnostic.
 */
@Component({
  selector: 'ui-priority',
  imports: [TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-level]': 'level()',
    '[attr.data-unmarked]': 'unmarked() ? "" : null',
    '[attr.data-mark]': 'mark() ? "" : null',
    '[style.--priority-tint]': 'tint()',
    '[style.--priority-ink]': 'look().ink',
  },
  styleUrl: './priority.css',
  templateUrl: './priority.html',
})
export class UiPriority {
  /** Frontmatter `priority:`; null or undefined reads as P3. */
  readonly value = input<Priority | null | undefined>(undefined);
  /** The `pmark` look: the level as framed mono text only, once after the stage chip of the spec head (spec 024). */
  readonly mark = input(false);

  protected readonly level = computed<Priority>(() => this.value() ?? DEFAULT_PRIORITY);
  protected readonly unmarked = computed(() => this.value() == null);
  protected readonly hintKey = computed(() => (this.unmarked() ? 'priority.unmarked' : `priority.hint.${this.level()}`));
  protected readonly look = computed(() => PRIORITY_LOOK[this.level()]);
  protected readonly tint = computed(() => {
    const tone = this.look().tone;
    return tone === null ? 'transparent' : toneTint(tone);
  });
}
