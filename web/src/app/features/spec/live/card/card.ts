import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec, runGlyphState, stateKey } from '../../../../shared/ui/glyph/states';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { UiTime } from '../../../../shared/time';
import { toneMark } from '../../../../shared/ui/tone';
import { agentOfCard } from '../live-frame';
import { LiveSource } from '../live-source';
import { runOf } from '../board/board-model';
import { absentNote } from '../recut';
import { lookOf } from '../steps/step-timeline';
import { AgentChip } from '../this-frame/agent-chip';
import { CardContext } from './card-context';
import { CardDetail } from './card-detail';
import { RunChip } from './run-chip';
import { cardHistory, type HistoryFrame } from './card-history';

export type CardDensity = 'comfortable' | 'compact' | 'step';

/**
 * One board card (design.md § Live, card anatomy; ISC-88), the same in the Lanes and the Flow view: an `<article>`
 * named "T14, ISC-333, in flight, web" with a 4 px inline-start edge (`.tcard`) in the state's tone. Every one of the eleven
 * states carries its glyph, its chip word (`states.card.*`) and its tone; no two share a (shape, tone) pair.
 *
 * Two densities, from the board's `?density` param:
 * - comfortable, three rows: glyph, mono id, claim chip, the small state chip (one line, ISC-148; Flow's medium tier drops the claim chip); the text clamped to two lines; builder tag, flags
 *   (parallel, seam, tries, note, stale) and the lock's session for work in flight (ISC-90); an absent card shows its
 *   strike note under the text instead of the note flag, in both densities (ISC-91, `live/recut.ts`);
 * - compact, two rows: glyph, id and state chip; the text clamped to two lines. Claim chip, builder, flags and session
 *   move into the detail;
 * - step, one 36 px row (design.md § Live · Operator lane): glyph, id, the text cut to one line and the state chip, the
 *   operator lane's checklist card.
 *
 * The id is the button that opens the card detail (`card-detail.ts`), owned by the card: the frames for its state
 * history load only while it is open.
 */
@Component({
  selector: 'app-board-card',
  imports: [AgentChip, CardDetail, RunChip, TranslocoPipe, UiChip, UiGlyph, UiIcon, UiStateChip, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './card.css',
  host: {
    '[attr.data-density]': 'density()',
    '[attr.data-run]': 'run()?.state ?? null',
  },
  templateUrl: './card.html',
})
export class BoardCard {
  readonly card = input.required<FrameCard | LiveCard>();
  readonly density = input<CardDensity>('comfortable');

  private readonly context = inject(CardContext, { optional: true });
  protected readonly detailOpen = signal(false);
  /** The lock's agent, drawn as the .agent chip on the card (live frames only carry locks). */
  protected readonly agent = computed(() => (this.card().state === 'running' ? agentOfCard(this.card()) : null));
  protected readonly selected = computed(() => this.detailOpen() || this.context?.selected() === this.card().task);
  protected readonly changed = computed(() => this.context?.changed().has(this.card().task) === true);

  protected openDetail(): void {
    this.context?.selected.set(this.card().task);
    this.detailOpen.set(true);
  }
  /** The card's run while it is in the round (spec 027): its chip replaces the state chip, its glyph leads the card. */
  protected readonly run = computed(() => runOf(this.card()));
  protected readonly glyph = computed(() => {
    const run = this.run();
    return run === null ? this.card().state : runGlyphState(run.state);
  });
  protected readonly spec = computed(() => glyphSpec(this.glyph(), 'card'));
  protected readonly stateWord = computed(() => {
    const run = this.run();
    return run === null ? stateKey(this.card().state, 'card') : `states.run.${run.state}`;
  });
  protected readonly edge = computed(() => toneMark(this.spec().tone));
  /** An absent card's strike note, shown on its face in both densities (ISC-91); null for any other card. */
  protected readonly strikeNote = computed(() => absentNote(this.card()));
  /**
   * The task's latest agent step (spec 015, ISC-232) as a list of at most one, keyed by the step so a new step renders
   * a fresh line that fades in. None in the step density (operator tasks have no agent) and none on a past frame.
   */
  protected readonly latestStep = computed(() => {
    if (this.density() === 'step' || this.context?.live() === false) return [];
    const step = this.context?.steps()[this.card().task]?.at(-1);
    if (step === undefined) return [];
    const look = lookOf(step);
    const color = look.tone === 'muted' ? 'var(--muted-ink)' : `var(--${look.tone}-text)`;
    return [{ ...look, step, color, key: `${step.ts} ${step.kind}` }];
  });
  protected readonly stale = computed(() => {
    const c = this.card();
    return 'stale' in c && c.stale === true;
  });

  private readonly source = inject(LiveSource);
  /** The live frame the board and the matrix read too: one shared read per refresh tick (ISC-371). */
  private readonly live = this.source.attach(() => this.detailOpen());
  /** The history frames, read only while the detail is open; the live frame comes from `LiveSource`. */
  private readonly historyFrames = this.source.history(() => this.detailOpen());
  /** Every frame on the scrubber, history then live, once the detail's history is read. */
  private readonly frames = computed<readonly HistoryFrame[] | undefined>(() => {
    const history = this.historyFrames.value();
    if (history === undefined) return undefined;
    const live = this.live.value();
    return [...history, ...(live?.kind === 'ok' ? [live.body] : [])];
  });
  protected readonly history = computed(() => {
    const frames = this.frames();
    return frames === undefined ? null : cardHistory(frames, this.card());
  });
}
