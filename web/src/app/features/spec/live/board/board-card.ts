import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec, stateKey } from '../../../../shared/ui/glyph/states';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { toneMark } from '../../../../shared/ui/tone';

/**
 * One board card (design.md § Live, card anatomy; ISC-88): an `<article>` named "T14, ISC-333, in flight, web" with a
 * 3 px edge in the state's colour. Row 1: glyph, mono id (the button that opens the detail), claim chip, state chip.
 * Row 2: the task text clamped to two lines. Row 3: builder tag, flags, and the lock's session for work in flight
 * (ISC-90). The same card serves the Lanes view and (T82) the Flow view.
 */
@Component({
  selector: 'app-board-card',
  imports: [TranslocoPipe, UiChip, UiGlyph, UiStateChip],
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
      [style.--edge]="edge()"
    >
      <div class="r1">
        <ui-glyph [state]="c.state" family="card" />
        <button type="button" class="id" [attr.aria-label]="'board.card.open' | transloco: { task: c.task }" (click)="opened.emit(c)">{{ c.task }}</button>
        <ui-chip class="claim">{{ c.claim }}</ui-chip>
        <ui-state-chip class="state" [state]="c.state" family="card" />
      </div>
      <p class="text">{{ c.text }}</p>
      <div class="r3">@if (c.builder) {<span class="builder" data-builder>{{ c.builder }}</span>}@if (c.parallel) {<span class="flag" data-flag="parallel">{{ 'board.card.parallel' | transloco }}</span>}@if (c.seam) {<span class="flag" data-flag="seam">{{ 'board.card.seam' | transloco }}</span>}@if (c.tries > 1) {<span class="flag" data-flag="tries">{{ 'board.card.tries' | transloco: { tries: c.tries } }}</span>}@if (c.note) {<span class="flag" data-flag="note">{{ 'board.card.note' | transloco }}</span>}@if (stale()) {<span class="flag" data-flag="stale">{{ 'board.card.stale' | transloco }}</span>}@if (c.lock; as lock) {<span class="session" data-session>{{ 'board.card.session' | transloco: { session: lock.session } }}</span>}</div>
    </article>
  `,
})
export class BoardCard {
  readonly card = input.required<FrameCard | LiveCard>();
  readonly density = input<'comfortable' | 'compact'>('comfortable');
  readonly opened = output<FrameCard | LiveCard>();

  protected readonly stateWord = computed(() => stateKey(this.card().state, 'card'));
  protected readonly edge = computed(() => toneMark(glyphSpec(this.card().state, 'card').tone));
  protected readonly stale = computed(() => {
    const c = this.card();
    return 'stale' in c && c.stale === true;
  });
}
