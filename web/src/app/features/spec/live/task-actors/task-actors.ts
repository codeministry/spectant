import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { UiActorChip } from '../../../../shared/ui/actor-chip/actor-chip';
import { staleAgeLabel, taskActorsOf } from '../live-frame';
import { activeLang } from '../../spec-view';
import { ticker } from '../ticker';

/** How often the stale age re-reads the clock (as `app-agent-chip`). */
const TICK_MS = 10_000;

/**
 * The agent and sub-agent working one task (T135, ISC-131.1), as `ui-actor-chip`s: the agent session, then the
 * sub-agent with its task suffix. The lock's state (active, or stale with its age) sits on the innermost holder, the
 * sub-agent when there is one, so "no release" is said once per task. Used under a card in flight on the Board tab and
 * in a row of the Tasks tab; the caller renders it only when `taskActorsOf(card)` is not null.
 */
@Component({
  selector: 'app-task-actors',
  imports: [UiActorChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    '[attr.data-task-actors]': 'card().task',
    '[attr.aria-label]': 'label()',
  },
  styleUrl: './task-actors.css',
  templateUrl: './task-actors.html',
})
export class TaskActors {
  private readonly transloco = inject(TranslocoService);

  readonly card = input.required<FrameCard | LiveCard>();

  private readonly now = ticker(TICK_MS);
  private readonly lang = activeLang(this.transloco);

  protected readonly actors = computed(() => taskActorsOf(this.card()));
  /** The stale holder's age ("54 minutes ago"); undefined while the lock is fresh. */
  protected readonly age = computed(() => {
    const actors = this.actors();
    return actors?.stale ? (staleAgeLabel(actors, this.now(), this.lang()) ?? undefined) : undefined;
  });
  protected readonly label = computed(() => {
    this.lang();
    return this.transloco.translate('live.taskActors', { task: this.card().task });
  });
}
