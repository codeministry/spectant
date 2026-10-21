import { ChangeDetectionStrategy, Component, computed, inject, input, model, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { stateKey } from '../../../../shared/ui/glyph/states';
import { UiKbd } from '../../../../shared/ui/kbd/kbd';
import { UiDialog } from '../../../../shared/ui/overlay/dialog';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { specWaitOf } from '../board/board-model';
import { agentOfCard } from '../live-frame';
import { StepTimeline } from '../steps/step-timeline';
import { AgentChip } from '../this-frame/agent-chip';
import type { CardHistoryEntry } from './card-history';
import { CardContext } from './card-context';

/** How many of a task's latest steps the detail lists; the Tasks tab holds the full timeline (spec 015). */
const DETAIL_STEPS = 8;

/**
 * The card detail (design.md § Live, card detail; ISC-88; spec 024: the prototype `.cdetail`): a `ui-dialog`, full
 * screen at the compact tier and centred above it. The head is the prototype's `.cd-head` (glyph, mono id and claim,
 * state chip, `lane · frame`, close), then the full text, the task's path chips (`.cd-paths`, from the tasks.md line
 * core parsed) and the `.cd-dl`: reason, builder and reader with their icons and verdict dot, tries, note, the probe of
 * the claim's mapping row, the agent holding the lock; the state history across the frames (`card-history.ts`); last
 * the links Open claim · Evidence · Timeline entry and `←` `→`, which step to the previous or next card on the board.
 * `history` is null while the frames load.
 */
@Component({
  selector: 'app-card-detail',
  imports: [AgentChip, RouterLink, StepTimeline, TranslocoPipe, UiDialog, UiGlyph, UiIcon, UiKbd, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKey($event)' },
  styleUrl: './card-detail.css',
  templateUrl: './card-detail.html',
})
export class CardDetail {
  private readonly shell = inject(ShellState);
  private readonly api = inject(ApiClient);
  private readonly context = inject(CardContext, { optional: true });

  readonly card = input.required<FrameCard | LiveCard>();
  readonly history = input<readonly CardHistoryEntry[] | null>(null);
  /** The specs a `waits on NNN` reason names (spec 025, ISC-163), null for any other reason. */
  protected readonly specWaitOf = specWaitOf;
  readonly open = model(false);

  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly frameLabel = computed(() => this.context?.frameLabel() ?? null);
  protected readonly agent = computed(() => agentOfCard(this.card()));
  /** The task's agent steps from the live answer (spec 015, ISC-232); the detail shows the last eight. */
  protected readonly steps = computed(() => this.context?.steps()[this.card().task] ?? []);
  protected readonly shownSteps = computed(() => this.steps().slice(-DETAIL_STEPS));
  protected readonly specLink = computed(() => {
    const ws = this.shell.ws();
    const id = this.shell.specId();
    return ws === null || id === null ? null : ['/w', ws, 's', id];
  });

  /** The tasks.md read (core's parse, served by the server): the task's paths and its claim's probe. */
  private readonly tasks = resource({
    params: () => {
      const ws = this.shell.ws();
      const id = this.shell.specId();
      return this.open() && ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: ({ params }) => this.api.tasks(params.ws, params.id),
  });
  private readonly body = computed(() => {
    if (!this.tasks.hasValue()) return null;
    const result = this.tasks.value();
    return result.kind === 'ok' ? (result.body ?? null) : null;
  });
  protected readonly paths = computed<readonly string[]>(() => this.body()?.tasks.find((t) => t.id === this.card().task)?.paths ?? []);
  protected readonly probe = computed(() => this.body()?.probeMapping.find((m) => m.claim === this.card().claim)?.probe ?? null);

  protected word(step: CardHistoryEntry): string {
    return stateKey(step.state, 'card');
  }

  /** `←` / `→`: the previous or next card in board order (the prototype's `cardOrder`), opened in its place. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const order = [...new Set([...document.querySelectorAll<HTMLElement>('article[data-card]')].map((el) => el.dataset['card'] ?? ''))];
    const i = order.indexOf(this.card().task);
    const next = i < 0 ? undefined : order[i + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next === undefined) return;
    event.preventDefault();
    this.open.set(false);
    setTimeout(() => document.querySelector<HTMLButtonElement>(`article[data-card="${CSS.escape(next)}"] button.id`)?.click());
  }
}
