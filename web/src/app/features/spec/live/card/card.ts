import { ChangeDetectionStrategy, Component, computed, inject, input, resource, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec, stateKey } from '../../../../shared/ui/glyph/states';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { toneMark } from '../../../../shared/ui/tone';
import { CardDetail } from './card-detail';
import { cardHistory, type HistoryFrame } from './card-history';

export type CardDensity = 'comfortable' | 'compact';

/**
 * One board card (design.md § Live, card anatomy; ISC-88), the same in the Lanes and the Flow view: an `<article>`
 * named "T14, ISC-333, in flight, web" with a 3 px inline-start edge in the state's tone. Every one of the eleven
 * states carries its glyph, its chip word (`states.card.*`) and its tone; no two share a (shape, tone) pair.
 *
 * Two densities, from the board's `?density` param:
 * - comfortable, three rows: glyph, mono id, claim chip, state chip; the text clamped to two lines; builder tag, flags
 *   (parallel, seam, tries, note, stale) and the lock's session for work in flight (ISC-90);
 * - compact, two rows: glyph, id and state chip; the text clamped to two lines. Claim chip, builder, flags and session
 *   move into the detail.
 *
 * The id is the button that opens the card detail (`card-detail.ts`), owned by the card: the frames for its state
 * history load only while it is open.
 */
@Component({
  selector: 'app-board-card',
  imports: [CardDetail, TranslocoPipe, UiChip, UiGlyph, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-inline-size: 0; }
    article { display: grid; gap: 4px; min-inline-size: 0; padding: 8px 8px 8px 12px; border: 1px solid var(--line); border-inline-start: 3px solid var(--edge); border-radius: var(--radius-field); background: var(--color-base-100); }
    :host([data-density='compact']) article { gap: 2px; padding-block: 4px; }
    .r1, .r3 { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-inline-size: 0; }
    .id { min-block-size: 24px; padding: 0 4px; border: 0; border-radius: 4px; background: none; color: var(--color-base-content); font-family: var(--font-mono); font-size: 13px; font-weight: 600; cursor: pointer; }
    .id:hover { text-decoration: underline; }
    .state { margin-inline-start: auto; }
    .text { display: -webkit-box; overflow: hidden; margin: 0; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
    .r3 { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
    .r3:empty { display: none; }
    .builder { font-weight: 600; }
    .session { font-family: var(--font-mono); overflow-wrap: anywhere; }
    .flag[data-flag='stale'] { color: var(--fail-ink); font-weight: 600; }
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
    >
      <div class="r1">
        <ui-glyph [state]="c.state" family="card" />
        <button type="button" class="id" aria-haspopup="dialog" [attr.aria-label]="'board.card.open' | transloco: { task: c.task }" (click)="detailOpen.set(true)">{{ c.task }}</button>
        @if (density() === 'comfortable') {
          <ui-chip class="claim">{{ c.claim }}</ui-chip>
        }
        <ui-state-chip class="state" [state]="c.state" family="card" />
      </div>
      <p class="text">{{ c.text }}</p>
      @if (density() === 'comfortable') {
        <div class="r3">@if (c.builder) {<span class="builder" data-builder>{{ c.builder }}</span>}@if (c.parallel) {<span class="flag" data-flag="parallel">{{ 'board.card.parallel' | transloco }}</span>}@if (c.seam) {<span class="flag" data-flag="seam">{{ 'board.card.seam' | transloco }}</span>}@if (c.tries > 1) {<span class="flag" data-flag="tries">{{ 'board.card.tries' | transloco: { tries: c.tries } }}</span>}@if (c.note) {<span class="flag" data-flag="note">{{ 'board.card.note' | transloco }}</span>}@if (stale()) {<span class="flag" data-flag="stale">{{ 'board.card.stale' | transloco }}</span>}@if (c.lock; as lock) {<span class="session" data-session>{{ 'board.card.session' | transloco: { session: lock.session } }}</span>}</div>
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

  protected readonly detailOpen = signal(false);
  protected readonly spec = computed(() => glyphSpec(this.card().state, 'card'));
  protected readonly stateWord = computed(() => stateKey(this.card().state, 'card'));
  protected readonly edge = computed(() => toneMark(this.spec().tone));
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
