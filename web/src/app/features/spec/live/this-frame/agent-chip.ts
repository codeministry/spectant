import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { elapsedLabel } from '../live-frame';

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
  styles: `
    :host { display: inline-flex; min-inline-size: 0; max-inline-size: 100%; }
    .chip { display: inline-flex; flex-wrap: wrap; gap: 0 8px; align-items: center; min-inline-size: 0; min-block-size: 24px; padding: 2px 8px; border: 1px solid var(--line); border-radius: var(--radius-field); background: var(--color-base-200); font-size: 12px; line-height: 16px; }
    .dot { inline-size: 6px; block-size: 6px; flex: none; border-radius: 50%; background: var(--color-primary); }
    :host([data-stale]) .dot { background: var(--fail-ink); }
    .session { font-family: var(--font-mono); font-weight: 600; overflow-wrap: anywhere; }
    time { color: var(--muted-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .stale { color: var(--fail-ink); font-weight: 600; }
    @media (forced-colors: active) { .dot { background: CanvasText; } }
  `,
  template: `
    <span class="chip" data-agent-chip [attr.data-session]="session()">
      <span class="dot" aria-hidden="true"></span>
      <span class="session" data-agent-session>{{ session() }}</span>
      @if (elapsed(); as elapsed) {
        <time data-agent-elapsed [attr.datetime]="since()">{{ elapsed }}</time>
      }
      @if (stale()) {
        <span class="stale" data-agent-stale>{{ 'board.agent.stale' | transloco }}</span>
      }
    </span>
  `,
})
export class AgentChip {
  private readonly transloco = inject(TranslocoService);

  readonly session = input.required<string>();
  /** ISO 8601, when the lock was taken; null shows no time. */
  readonly since = input<string | null>(null);
  readonly stale = input(false);

  private readonly now = signal(Date.now());
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  protected readonly elapsed = computed(() => {
    const since = this.since();
    return since === null ? null : elapsedLabel(since, this.now(), this.lang());
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
