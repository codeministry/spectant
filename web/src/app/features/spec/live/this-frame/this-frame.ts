import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { agentKey, agentsOf, lockSourceOf } from '../live-frame';
import { AgentChip } from './agent-chip';
import { RAIL_BLOCK_STYLES } from './rail-block.styles';

/**
 * "This frame" (T88, ISC-87; design.md § Live, Rail): the collapsible event list of the frame on screen, i.e. the
 * cards new in it or in another state than in the previous frame (`frameEvents`), each as the prototype's compact
 * `.fevents` line (`T9 → closed · ISC-330`) that opens the card detail, then, for the live frame, the lock
 * source the reading names and one agent chip per session holding a lock (T85, ISC-90). The rail block at wide and the
 * first tab of the bottom bar's sheet below wide; in the sheet the segment names it, so it renders without the fold.
 */
@Component({
  selector: 'app-this-frame',
  imports: [AgentChip, NgTemplateOutlet, TranslocoPipe, UiDisclosure],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-this-frame': '' },
  styles: [
    RAIL_BLOCK_STYLES,
    `
      /* spec 024: the prototype .fevents: 13 px lines, a 6 px cyan dot, the task id in mono 600 12 px; a line stays a
         button (24 px, 44 px on a coarse pointer) that opens the card detail. */
      .fevents { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
      .fev { position: relative; display: block; inline-size: 100%; min-block-size: 24px; padding: 2px 4px 2px 14px; border: 0; border-radius: var(--radius-field); background: none; color: var(--color-base-content); font-size: 13px; line-height: 20px; text-align: start; cursor: pointer; transition: background-color var(--motion-duration-fast) var(--motion-ease-standard); }
      .fev::before { position: absolute; inset-block-start: 9px; inset-inline-start: 2px; inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--color-primary); content: ""; }
      .fev:hover { background: var(--color-base-300); }
      .fev:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
      .fev .text { display: block; }
      .fid { font-family: var(--font-mono); font-size: 12px; font-weight: 600; }
      @media (pointer: coarse) { .fev { min-block-size: 44px; padding-block: 12px; } .fev::before { inset-block-start: 19px; } }
    `,
  ],
  template: `
    @if (collapsible()) {
      <section class="block" [attr.aria-label]="'board.rail.thisFrame' | transloco">
        <ui-disclosure [open]="open()" [count]="events().length" (openChange)="open.set($event)">
          <span uiDisclosureSummary class="eyebrow-head">{{ 'board.rail.thisFrame' | transloco }}<span class="end" data-frame-label>{{ frame().label }}</span></span>
          <ng-container [ngTemplateOutlet]="body" />
        </ui-disclosure>
      </section>
    } @else {
      <ng-container [ngTemplateOutlet]="body" />
    }

    <ng-template #body>
      @if (source(); as source) {
        <div class="agents" data-agents>
          <p class="source" data-lock-source [attr.data-lock-source]="source">{{ 'board.agent.source' | transloco: { source } }}</p>
          @for (agent of agents(); track agentKey(agent)) {
            <app-agent-chip [session]="agent.session" [since]="agent.since" [stale]="agent.stale" />
          } @empty {
            <p class="empty">{{ 'board.agent.none' | transloco }}</p>
          }
        </div>
      }
      @if (events().length > 0) {
        <!-- spec 024: the prototype .fevents, a cyan dot and one compact line "T9 → closed · ISC-330"; each line still
             opens the card's detail, the card text in its title. -->
        <ul class="fevents">
          @for (c of events(); track c.task) {
            <li>
              <button type="button" class="fev" [attr.data-frame-event]="c.task" [attr.data-state]="c.state" [attr.title]="c.text" (click)="opened.emit(c)">
                <span class="text"><b class="fid">{{ c.task }}</b>{{ ' ' }}<span aria-hidden="true">→</span> {{ 'states.card.' + c.state | transloco }}@if (c.claim) { · {{ c.claim }}}</span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ 'board.rail.emptyFrame' | transloco }}</p>
      }
    </ng-template>
  `,
})
export class ThisFrame {
  readonly frame = input.required<Frame | LiveFrame>();
  /** The frame's events, as the board computed them against the previous frame. */
  readonly events = input.required<readonly FrameCard[]>();
  /** The rail folds the list; the sheet's segment already names it. */
  readonly collapsible = input(true);
  readonly opened = output<FrameCard>();

  protected readonly open = signal(true);
  protected readonly source = computed(() => lockSourceOf(this.frame()));
  protected readonly agents = computed(() => agentsOf(this.frame()));
  protected readonly agentKey = agentKey;
}
