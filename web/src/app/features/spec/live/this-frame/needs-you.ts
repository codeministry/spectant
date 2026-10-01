import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec } from '../../../../shared/ui/glyph/states';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { toneMark } from '../../../../shared/ui/tone';
import { staleAgents } from '../live-frame';
import { AgentChip } from './agent-chip';
import { RAIL_BLOCK_STYLES } from './rail-block.styles';

/**
 * "Needs you" (T88, ISC-87; design.md § Live, Rail): the stale-agent alert first (a session the model marked stale may
 * have died, T85), then the frame's list as the model gives it (`needsYouOf`: question, concerns, open operator steps),
 * each row with a 4 px edge in its state's colour. The count is the list's length, never recomputed. The rail block at
 * wide and the second tab of the bottom bar's sheet below wide (`framed` false: the segment names it there).
 */
@Component({
  selector: 'app-needs-you',
  imports: [AgentChip, NgTemplateOutlet, TranslocoPipe, UiGlyph, UiIcon, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-needs-you': '' },
  styles: [
    RAIL_BLOCK_STYLES,
    `
      .count { font-variant-numeric: tabular-nums; }
      .edge { align-items: start; padding-block: 8px; border-inline-start: 4px solid var(--edge); border-start-start-radius: 0; border-end-start-radius: 0; }
      .edge ui-glyph { flex: none; margin-block-start: 3px; }
      .edge .mono, .edge ui-state-chip { flex: none; line-height: 20px; }
      .edge .text { line-height: 20px; overflow-wrap: anywhere; white-space: normal; }
      .alert { display: flex; gap: 8px; align-items: start; padding: 8px 12px; border: 1px solid var(--line); border-inline-start: 4px solid var(--fail-ink); border-radius: var(--radius-field); background: var(--color-base-200); font-size: 13px; line-height: 20px; }
      .alert ui-icon { flex: none; margin-block-start: 2px; color: var(--fail-ink); }
      .alert-body { display: grid; gap: 4px; min-inline-size: 0; }
      .alert p { margin: 0; overflow-wrap: anywhere; }
      @media (forced-colors: active) { .edge, .alert { border-inline-start-color: CanvasText; } }
    `,
  ],
  template: `
    @if (framed()) {
      <section class="block" aria-labelledby="needs-you-heading">
        <h3 class="head" id="needs-you-heading">
          {{ 'board.rail.needsYou' | transloco }}
          <span class="badge badge-sm count" data-needs-count>{{ cards().length }}</span>
        </h3>
        <ng-container [ngTemplateOutlet]="body" />
      </section>
    } @else {
      <ng-container [ngTemplateOutlet]="body" />
    }

    <ng-template #body>
      @for (agent of stale(); track agent.session) {
        <div class="alert" data-stale-agent [attr.data-session]="agent.session">
          <ui-icon name="triangle-alert" [size]="16" />
          <div class="alert-body">
            <p>{{ 'board.agent.staleAlert' | transloco: { session: agent.session, claims: agent.claims.join(', ') } }}</p>
            <app-agent-chip [session]="agent.session" [since]="agent.since" [stale]="true" />
          </div>
        </div>
      }
      @if (cards().length > 0) {
        <ul class="rows">
          @for (c of cards(); track c.task) {
            <li>
              <button type="button" class="row edge" [attr.data-needs-card]="c.task" [style.--edge]="edge(c)" (click)="opened.emit(c)">
                <ui-glyph [state]="c.state" family="card" [size]="14" />
                <span class="mono">{{ c.task }}</span>
                <span class="text">{{ c.text }}</span>
                <ui-state-chip [state]="c.state" family="card" />
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ 'board.rail.emptyNeeds' | transloco }}</p>
      }
    </ng-template>
  `,
})
export class NeedsYou {
  readonly frame = input.required<Frame | LiveFrame>();
  /** The frame's Needs you list (`needsYouOf`), in the model's order. */
  readonly cards = input.required<readonly FrameCard[]>();
  readonly framed = input(true);
  readonly opened = output<FrameCard>();

  protected readonly stale = computed(() => staleAgents(this.frame()));

  protected edge(card: FrameCard): string {
    return toneMark(glyphSpec(card.state, 'card').tone);
  }
}
