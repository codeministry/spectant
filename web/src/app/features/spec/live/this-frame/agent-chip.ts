import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { elapsedLabel } from '../live-frame';
import { activeLang } from '../../spec-view';
import { ticker } from '../ticker';

/** How often the elapsed time re-reads the clock (as `ui-relative-time`). */
const TICK_MS = 10_000;

/**
 * One agent holding a lock (T85, ISC-90): the session name, the time since the lock was taken (`Intl.RelativeTimeFormat`
 * in the viewer's language, counting between readings) and, when the model marked the lock stale, a visible "stale"
 * marker in the fail ink, never colour alone. Used under a card in flight, in "This frame" and in the stale alert.
 */
@Component({
  selector: 'app-agent-chip',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-stale]': "stale() ? '' : null" },
  styleUrl: './agent-chip.css',
  templateUrl: './agent-chip.html',
})
export class AgentChip {
  private readonly transloco = inject(TranslocoService);

  readonly session = input.required<string>();
  /** ISO 8601, when the lock was taken; null shows no time. */
  readonly since = input<string | null>(null);
  readonly stale = input(false);

  private readonly now = ticker(TICK_MS);
  private readonly lang = activeLang(this.transloco);
  protected readonly elapsed = computed(() => {
    const since = this.since();
    return since === null ? null : elapsedLabel(since, this.now(), this.lang());
  });
}
