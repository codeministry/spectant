import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { agentsOf, lockSourceOf } from '../live-frame';
import { AgentChip } from './agent-chip';
import { RAIL_BLOCK_STYLES } from './rail-block.styles';

/**
 * "This frame" (T88, ISC-87; design.md § Live, Rail): the collapsible event list of the frame on screen, i.e. the
 * cards new in it or in another state than in the previous frame (`frameEvents`), then, for the live frame, the lock
 * source the reading names and one agent chip per session holding a lock (T85, ISC-90). The rail block at wide and the
 * first tab of the bottom bar's sheet below wide; in the sheet the segment names it, so it renders without the fold.
 */
@Component({
  selector: 'app-this-frame',
  imports: [AgentChip, NgTemplateOutlet, TranslocoPipe, UiDisclosure, UiGlyph, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-this-frame': '' },
  styles: RAIL_BLOCK_STYLES,
  template: `
    @if (collapsible()) {
      <section class="block" [attr.aria-label]="'board.rail.thisFrame' | transloco">
        <ui-disclosure [open]="open()" [count]="events().length" (openChange)="open.set($event)">
          <span uiDisclosureSummary class="title">{{ 'board.rail.thisFrame' | transloco }}</span>
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
          @for (agent of agents(); track agent.session) {
            <app-agent-chip [session]="agent.session" [since]="agent.since" [stale]="agent.stale" />
          } @empty {
            <p class="empty">{{ 'board.agent.none' | transloco }}</p>
          }
        </div>
      }
      @if (events().length > 0) {
        <ul class="rows">
          @for (c of events(); track c.task) {
            <li>
              <button type="button" class="row" [attr.data-frame-event]="c.task" (click)="opened.emit(c)">
                <ui-glyph [state]="c.state" family="card" [size]="14" />
                <span class="mono">{{ c.task }}</span>
                <span class="text">{{ c.text }}</span>
                <ui-state-chip [state]="c.state" family="card" />
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
}
