import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { agentKey, agentsOf, lockSourceOf } from '../live-frame';
import { AgentChip } from './agent-chip';

/**
 * "This frame" (T88, ISC-87; design.md § Live, Rail): the collapsible event list of the frame on screen, i.e. the
 * cards new in it or in another state than in the previous frame (`frameEvents`), each as the compact
 * `.fevents` line (`T9 → closed · ISC-330`) that opens the card detail, then, for the live frame, the lock
 * source the reading names and one agent chip per session holding a lock (T85, ISC-90). The rail block at wide and the
 * first tab of the bottom bar's sheet below wide; in the sheet the segment names it, so it renders without the fold.
 */
@Component({
  selector: 'app-this-frame',
  imports: [AgentChip, NgTemplateOutlet, TranslocoPipe, UiDisclosure],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-this-frame': '' },
  styleUrl: './this-frame.css',
  templateUrl: './this-frame.html',
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
