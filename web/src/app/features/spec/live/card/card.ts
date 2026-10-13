import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec, stateKey } from '../../../../shared/ui/glyph/states';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { toneMark } from '../../../../shared/ui/tone';
import { agentOfCard } from '../live-frame';
import { absentNote } from '../recut';
import { AgentChip } from '../this-frame/agent-chip';
import { CardContext } from './card-context';
import { CardDetail } from './card-detail';
import { cardHistory, type HistoryFrame } from './card-history';

export type CardDensity = 'comfortable' | 'compact' | 'step';

/**
 * One board card (design.md § Live, card anatomy; ISC-88), the same in the Lanes and the Flow view: an `<article>`
 * named "T14, ISC-333, in flight, web" with a 4 px inline-start edge (prototype `.tcard`) in the state's tone. Every one of the eleven
 * states carries its glyph, its chip word (`states.card.*`) and its tone; no two share a (shape, tone) pair.
 *
 * Two densities, from the board's `?density` param:
 * - comfortable, three rows: glyph, mono id, claim chip, the small state chip (one line, ISC-148; Flow's medium tier drops the claim chip); the text clamped to two lines; builder tag, flags
 *   (parallel, seam, tries, note, stale) and the lock's session for work in flight (ISC-90); an absent card shows its
 *   strike note under the text instead of the note flag, in both densities (ISC-91, `live/recut.ts`);
 * - compact, two rows: glyph, id and state chip; the text clamped to two lines. Claim chip, builder, flags and session
 *   move into the detail;
 * - step, one 36 px row (design.md § Live · Operator-Lane): glyph, id, the text cut to one line and the state chip, the
 *   operator lane's checklist card.
 *
 * The id is the button that opens the card detail (`card-detail.ts`), owned by the card: the frames for its state
 * history load only while it is open.
 */
@Component({
  selector: 'app-board-card',
  imports: [AgentChip, CardDetail, TranslocoPipe, UiChip, UiGlyph, UiIcon, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-inline-size: 0; }
    article { display: grid; gap: 4px; min-inline-size: 0; padding: 10px 12px 10px 14px; border: 1px solid var(--line); border-inline-start: 4px solid var(--edge); border-radius: var(--radius-field); background: var(--color-base-100); }
    article:hover { background: var(--color-base-300); }
    :host([data-density='compact']) article { gap: 2px; padding: 6px 10px 6px 12px; }
    /* spec 024: the operator lane's checklist card, one 36 px row (design.md § Live · Operator-Lane (Principal 2026-10-13)). */
    :host([data-density='step']) article { display: flex; gap: 6px; align-items: center; min-block-size: 36px; padding: 4px 10px 4px 12px; }
    :host([data-density='step']) .r1 { display: contents; }
    :host([data-density='step']) .text { display: block; flex: 1; order: 1; min-inline-size: 0; white-space: nowrap; text-overflow: ellipsis; }
    :host([data-density='step']) .state { order: 2; }
    :host([data-density='step']) .strike-note { display: none; }
    .r1, .r3 { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-inline-size: 0; }
    /* The header stays one line, as the prototype's .r1: the state word never shrinks, the claim chip gives way. */
    .r1 { flex-wrap: nowrap; gap: 6px; }
    .r1 > ui-glyph, .r1 > .id { flex: none; }
    .r1 > .claim { min-inline-size: 0; overflow: hidden; }
    .id { min-block-size: 24px; padding: 0 4px; border: 0; border-radius: 4px; background: none; color: var(--color-base-content); font-family: var(--font-mono); font-size: 13px; font-weight: 600; cursor: pointer; }
    .id:hover { text-decoration: underline; }
    .state { flex: none; margin-inline-start: auto; }
    /* Flow at the medium tier (four narrow columns), as the prototype's .flow-grid: no claim chip, the word stays readable. */
    @container shell (640px <= width < 1120px) {
      :host([data-flow-card]) .claim { display: none; }
    }
    .text { display: -webkit-box; overflow: hidden; margin: 0; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
    .r3 { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
    .r3:empty { display: none; }
    /* spec 024: the prototype marks (.pmark, .seam), role tags with icon (.tag, .vdot) and the try chip (.try). */
    .pmark, .seam { flex: none; padding: 0 4px; border: 1px solid var(--line); border-radius: 4px; color: var(--muted); font: 600 10px/14px var(--font-mono); }
    .seam { padding: 0 5px; border-color: var(--color-primary); background: repeating-linear-gradient(135deg, var(--disp-t) 0 3px, transparent 3px 6px); color: var(--disp-text); }
    .tag { display: inline-flex; gap: 3px; align-items: center; color: var(--muted); font-size: 11px; }
    .vdot { display: inline-block; inline-size: 7px; block-size: 7px; margin-inline-start: 2px; border-radius: 50%; background: var(--muted); }
    .vdot[data-verdict="pass"] { background: var(--color-accent); }
    .vdot[data-verdict="concerns"] { background: var(--conc); }
    .vdot[data-verdict="fail"] { background: var(--color-error); }
    .vdot[data-verdict="skipped"] { border: 1.5px solid var(--muted); background: none; }
    .try { padding: 0 5px; border-radius: 4px; background: var(--hover-t); color: var(--hover-text); font-family: var(--font-mono); font-size: 10px; }
    .session { font-family: var(--font-mono); overflow-wrap: anywhere; }
    /* spec 024: the prototype .lane-chip (dot + lane), drawn only on a Flow card, hidden in Flow's narrow columns. */
    .lane-chip { display: none; flex: none; gap: 4px; align-items: center; color: var(--muted); font-size: 11px; }
    .lane-chip i { inline-size: 7px; block-size: 7px; border-radius: 50%; background: var(--lane-c, var(--muted)); }
    :host([data-flow-card]) .lane-chip { display: inline-flex; }
    @container shell (width < 1120px) { :host([data-flow-card]) .lane-chip { display: none; } }
    /* spec 024: the prototype .tcard.sel (2 px cyan outline) and .tcard.changed (a 1200 ms cyan tint after a frame change). */
    article[data-sel] { outline: 2px solid var(--color-primary); outline-offset: 1px; }
    article[data-changed] { animation: card-tint 1200ms var(--ease); }
    @keyframes card-tint { from { background: var(--disp-t); } }
    @media (prefers-reduced-motion: reduce) { article[data-changed] { animation: none; } }
    .flag[data-flag='stale'] { color: var(--fail-ink); font-weight: 600; }
    .strike-note { margin: 0; color: var(--muted-ink); font-size: 12px; line-height: 16px; overflow-wrap: anywhere; }
    @media (forced-colors: active) {
      article { border-inline-start-color: CanvasText; }
    }
  `,
  host: {
    '[attr.data-density]': 'density()',
  },
  template: `
    @let c = card();
    <article
      [attr.aria-label]="'board.card.name' | transloco: { task: c.task, claim: c.claim, state: (stateWord() | transloco), lane: c.lane }"
      [attr.data-card]="c.task"
      [attr.data-state]="c.state"
      [attr.data-lane]="c.lane"
      [attr.data-edge]="spec().tone"
      [style.--edge]="edge()"
      [attr.data-sel]="selected() ? '' : null"
      [attr.data-changed]="changed() ? '' : null"
    >
      <div class="r1">
        <ui-glyph [state]="c.state" family="card" [size]="20" />
        <button type="button" class="id" aria-haspopup="dialog" [attr.aria-label]="'board.card.open' | transloco: { task: c.task }" (click)="openDetail()">{{ c.task }}</button>
        @if (density() === 'comfortable') {
          <ui-chip class="claim">{{ c.claim }}</ui-chip>
        }
        @if (c.parallel) {<span class="pmark" data-flag="parallel" [attr.title]="'board.card.parallel' | transloco">P</span>}
        @if (c.seam) {<span class="seam" data-flag="seam">{{ 'board.card.seam' | transloco }}</span>}
        <span class="lane-chip" data-lane-chip><i aria-hidden="true"></i>{{ c.lane }}</span>
        <ui-state-chip small class="state" [state]="c.state" family="card" />
      </div>
      <p class="text">{{ c.text }}</p>
      @if (strikeNote(); as note) {
        <p class="strike-note" data-strike-note>{{ note }}</p>
      } @else if (strikeNote() === '') {
        <p class="strike-note" data-strike-note>{{ 'board.card.struck' | transloco }}</p>
      }
      @if (density() === 'comfortable') {
        <div class="r3">@if (c.builder) {<span class="tag builder" data-builder><ui-icon name="wrench" [size]="12" />{{ c.builder }}</span>}@if (c.reader) {<span class="tag reader" data-reader><ui-icon name="eye" [size]="12" />{{ c.reader }}@if (c.verdict) {<i class="vdot" [attr.data-verdict]="c.verdict" [attr.title]="c.verdict"></i>}</span>}@if (c.tries > 1) {<span class="try" data-flag="tries">{{ 'board.card.tries' | transloco: { tries: c.tries } }}</span>}@if (c.note && strikeNote() === null) {<span class="flag" data-flag="note">{{ 'board.card.note' | transloco }}</span>}@if (stale()) {<span class="flag" data-flag="stale">{{ 'board.card.stale' | transloco }}</span>}@if (agent(); as agent) {<app-agent-chip [attr.data-agent-of]="c.task" [session]="agent.session" [since]="agent.since" [stale]="agent.stale" />}</div>
      } @else if (agent(); as agent) {
        <div class="r3"><app-agent-chip [attr.data-agent-of]="c.task" [session]="agent.session" [since]="agent.since" [stale]="agent.stale" /></div>
      }
    </article>
    @if (detailOpen()) {
      <app-card-detail [card]="c" [history]="history()" [(open)]="detailOpen" />
    }
  `,
})
export class BoardCard {
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellState);

  readonly card = input.required<FrameCard | LiveCard>();
  readonly density = input<CardDensity>('comfortable');

  private readonly context = inject(CardContext, { optional: true });
  protected readonly detailOpen = signal(false);
  /** The lock's agent, drawn as the prototype's .agent chip on the card (live frames only carry locks). */
  protected readonly agent = computed(() => (this.card().state === 'running' ? agentOfCard(this.card()) : null));
  protected readonly selected = computed(() => this.detailOpen() || this.context?.selected() === this.card().task);
  protected readonly changed = computed(() => this.context?.changed().has(this.card().task) === true);

  protected openDetail(): void {
    this.context?.selected.set(this.card().task);
    this.detailOpen.set(true);
  }
  protected readonly spec = computed(() => glyphSpec(this.card().state, 'card'));
  protected readonly stateWord = computed(() => stateKey(this.card().state, 'card'));
  protected readonly edge = computed(() => toneMark(this.spec().tone));
  /** An absent card's strike note, shown on its face in both densities (ISC-91); null for any other card. */
  protected readonly strikeNote = computed(() => absentNote(this.card()));
  protected readonly stale = computed(() => {
    const c = this.card();
    return 'stale' in c && c.stale === true;
  });

  /** Every frame on the scrubber, history then live, read only while the detail is open. */
  private readonly frames = resource({
    params: () => {
      const ws = this.shell.ws();
      const id = this.shell.specId();
      return this.detailOpen() && ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: async ({ params }): Promise<readonly HistoryFrame[]> => {
      const [history, live] = await Promise.all([this.api.frames(params.ws, params.id), this.api.live(params.ws, params.id)]);
      return [...(history.kind === 'ok' ? history.body : []), ...(live.kind === 'ok' ? [live.body] : [])];
    },
  });
  protected readonly history = computed(() => {
    const frames = this.frames.value();
    return frames === undefined ? null : cardHistory(frames, this.card());
  });
}
