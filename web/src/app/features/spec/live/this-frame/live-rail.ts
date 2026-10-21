import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, model, output, type Signal, signal, type TemplateRef, viewChild } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { type RailBadge, RailContent } from '../../../../layout/shell/rail-content';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiSheet } from '../../../../shared/ui/overlay/sheet';
import { type SegmentedOption, UiSegmented } from '../../../../shared/ui/segmented/segmented';
import { activeLang } from '../../spec-view';
import { FrameBar } from './frame-bar';
import { NeedsYou } from './needs-you';
import { ThisFrame } from './this-frame';

/**
 * This frame and Needs you of a live tab (T88), the same on the Board and the Matrix (the prototype renders the matrix
 * inside the round board, `board-matrix.html`): the two rail blocks and the 48 px bottom bar as templates the tab
 * hands to the shell (`registerLiveRail`), the bar drawn here below wide outside zen, and the bar's sheet below wide
 * and in zen, where the zen footer renders the bar, so there is one bar. The host draws no box (`display: contents`).
 */
@Component({
  selector: 'app-live-rail',
  imports: [FrameBar, NeedsYou, NgTemplateOutlet, ThisFrame, TranslocoPipe, UiSegmented, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './live-rail.html',
  styleUrl: './live-rail.css',
})
export class LiveRail {
  private readonly transloco = inject(TranslocoService);
  protected readonly state = inject(ShellState);

  readonly frame = input.required<Frame | LiveFrame>();
  readonly events = input.required<readonly FrameCard[]>();
  readonly needsYou = input.required<readonly FrameCard[]>();
  /** The operator steps Needs you lists in the rail (the board at wide); none on the matrix. */
  readonly steps = input<readonly FrameCard[]>([]);
  readonly index = input.required<number>();
  readonly last = input.required<number>();
  readonly live = input(false);
  readonly barOpen = model(false);
  /** A row of This frame or Needs you: the tab opens the card detail. */
  readonly opened = output<FrameCard>();
  /** The bar's step to another frame. */
  readonly step = output<number>();

  /** The rail blocks and the bottom bar, rendered by the shell (`RailContent`). */
  readonly railBlocks = viewChild<TemplateRef<unknown>>('railBlocks');
  readonly frameBar = viewChild<TemplateRef<unknown>>('frameBar');

  private readonly lang = activeLang(this.transloco);
  protected readonly wide = computed(() => this.state.tier() === 'wide');
  protected readonly barTab = signal<'frame' | 'needs'>('frame');
  protected readonly barTabs = computed<readonly SegmentedOption[]>(() => {
    this.lang();
    return [
      { key: 'frame', label: this.transloco.translate('board.rail.thisFrameCount', { count: this.events().length }) },
      { key: 'needs', label: this.transloco.translate('board.rail.needsYouCount', { count: this.needsYou().length }) },
    ];
  });

  protected setBarTab(tab: string | undefined): void {
    this.barTab.set(tab === 'needs' ? 'needs' : 'frame');
  }
}

/**
 * Hands a live tab's rail to the shell (T88): the blocks at wide, the bar in every tier (the zen footer reads it), and
 * the collapsed strip's badges. Call it in the tab's injection context.
 */
export function registerLiveRail(rail: Signal<LiveRail | undefined>, badges: Signal<readonly RailBadge[]>): void {
  const state = inject(ShellState);
  inject(RailContent).register(
    {
      blocks: computed(() => (state.tier() === 'wide' ? (rail()?.railBlocks() ?? null) : null)),
      bar: computed(() => rail()?.frameBar() ?? null),
      badges,
    },
    inject(DestroyRef),
  );
}

/**
 * `o` opens This frame / Needs you below wide and in zen (prototype `.sheet-bar kbd`); `f` is the shell's search key.
 * True when the key is taken (its default prevented); never inside a field.
 */
export function barKey(event: KeyboardEvent, wide: boolean, zen: boolean): boolean {
  if (event.key !== 'o' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (wide && !zen) return false;
  const target = event.target as HTMLElement | null;
  if (target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return false;
  event.preventDefault();
  return true;
}
