import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { stateKey } from '../../../../shared/ui/glyph/states';
import { UiDialog } from '../../../../shared/ui/overlay/dialog';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import type { CardHistoryEntry } from './card-history';

/**
 * The card detail (design.md § Live, card detail; ISC-88): a `ui-dialog`, full screen at the compact tier and centred
 * above it. It shows what the card has no room for: the full text, claim and lane, builder, reader and verdict, tries,
 * the reason, the session of work in flight, the note, and the state history across the frames (`card-history.ts`),
 * each step with its glyph, frame label and state word. `history` is null while the frames load.
 */
@Component({
  selector: 'app-card-detail',
  imports: [TranslocoPipe, UiChip, UiDialog, UiGlyph, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: contents; }
    .body { display: grid; gap: 12px; min-inline-size: 0; }
    .head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .text { margin: 0; overflow-wrap: anywhere; }
    dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 0; font-size: 13px; }
    dt { color: var(--muted-ink); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .mono { font-family: var(--font-mono); }
    .num { font-variant-numeric: tabular-nums; }
    h3 { margin: 0; font-size: 13px; font-weight: 600; }
    ol { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
    li { display: flex; gap: 8px; align-items: center; min-block-size: 24px; }
    .frame { min-inline-size: 88px; font-family: var(--font-mono); color: var(--muted-ink); }
    .muted { margin: 0; color: var(--muted-ink); font-size: 13px; }
  `,
  template: `
    @let c = card();
    <ui-dialog
      [attr.data-fullscreen]="compact() ? '' : null"
      [(open)]="open"
      [heading]="'board.detail.heading' | transloco: { task: c.task, claim: c.claim }"
    >
      <div class="body" data-card-detail [attr.data-task]="c.task">
        <div class="head">
          <ui-state-chip [state]="c.state" family="card" />
          <ui-chip class="mono">{{ c.claim }}</ui-chip>
        </div>
        <p class="text" data-detail-text>{{ c.text }}</p>
        <dl>
          <dt>{{ 'board.detail.claim' | transloco }}</dt>
          <dd class="mono">{{ c.claim }}</dd>
          <dt>{{ 'board.detail.lane' | transloco }}</dt>
          <dd>{{ c.lane }}</dd>
          @if (c.builder) {
            <dt>{{ 'board.detail.builder' | transloco }}</dt>
            <dd data-detail-builder>{{ c.builder }}</dd>
          }
          @if (c.reader) {
            <dt>{{ 'board.detail.reader' | transloco }}</dt>
            <dd>{{ c.reader }}</dd>
          }
          @if (c.verdict) {
            <dt>{{ 'board.detail.verdict' | transloco }}</dt>
            <dd>{{ c.verdict }}</dd>
          }
          <dt>{{ 'board.detail.tries' | transloco }}</dt>
          <dd class="num" data-detail-tries>{{ c.tries }}</dd>
          @if (c.reason) {
            <dt>{{ 'board.detail.reason' | transloco }}</dt>
            <dd>{{ c.reason }}</dd>
          }
          @if (c.lock; as lock) {
            <dt>{{ 'board.detail.session' | transloco }}</dt>
            <dd class="mono" data-detail-session>{{ lock.session }}@if (stale()) { · {{ 'board.card.stale' | transloco }}}</dd>
          }
          @if (c.note) {
            <dt>{{ 'board.detail.note' | transloco }}</dt>
            <dd data-detail-note>{{ c.note }}</dd>
          }
        </dl>
        <h3>{{ 'board.detail.history' | transloco }}</h3>
        @if (history(); as steps) {
          @if (steps.length > 0) {
            <ol data-history>
              @for (step of steps; track step.frame) {
                <li [attr.data-history-frame]="step.frame" [attr.data-history-state]="step.state">
                  <span class="frame">{{ step.label }}</span>
                  <ui-glyph [state]="step.state" family="card" [size]="14" />
                  <span>{{ word(step) | transloco }}</span>
                </li>
              }
            </ol>
          } @else {
            <p class="muted" data-history-empty>{{ 'board.detail.historyEmpty' | transloco }}</p>
          }
        } @else {
          <p class="muted" data-history-loading>{{ 'common.loading' | transloco }}</p>
        }
      </div>
    </ui-dialog>
  `,
})
export class CardDetail {
  private readonly shell = inject(ShellState);

  readonly card = input.required<FrameCard | LiveCard>();
  readonly history = input<readonly CardHistoryEntry[] | null>(null);
  readonly open = model(false);

  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly stale = computed(() => {
    const c = this.card();
    return 'stale' in c && c.stale === true;
  });
  protected word(step: CardHistoryEntry): string {
    return stateKey(step.state, 'card');
  }
}
