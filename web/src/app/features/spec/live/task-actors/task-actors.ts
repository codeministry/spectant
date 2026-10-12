import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { UiActorChip } from '../../../../shared/ui/actor-chip/actor-chip';
import { staleAgeLabel, taskActorsOf } from '../live-frame';

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
  styles: `
    :host { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; min-inline-size: 0; max-inline-size: 100%; }
  `,
  template: `
    @if (actors(); as a) {
      @if (a.agent; as agent) {
        <ui-actor-chip
          data-task-agent
          [actor]="agent"
          [active]="a.subagent === null && !a.stale"
          [stale]="a.subagent === null && a.stale"
          [staleAge]="a.subagent === null ? age() : undefined"
        />
      }
      @if (a.subagent; as sub) {
        <ui-actor-chip data-task-subagent [actor]="sub" [active]="!a.stale" [stale]="a.stale" [staleAge]="age()" />
      }
    }
  `,
})
export class TaskActors {
  private readonly transloco = inject(TranslocoService);

  readonly card = input.required<FrameCard | LiveCard>();

  private readonly now = signal(Date.now());
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

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

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
