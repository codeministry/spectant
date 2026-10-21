import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { CardState, FrameCard, RunState } from '../../../../../../../core/src/files';
import { prefersReducedMotion } from '../../../../core/motion';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { glyphSpec, runGlyphState, stateKey } from '../../../../shared/ui/glyph/states';
import { UiKbd } from '../../../../shared/ui/kbd/kbd';
import { UiLiveRegion } from '../../../../shared/ui/live-region/live-region';
import { type MeterSegment, UiMeter } from '../../../../shared/ui/meter/meter';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { UiSheet } from '../../../../shared/ui/overlay/sheet';
import { UiScrubber } from '../../../../shared/ui/scrubber/scrubber';
import { UiSegmented } from '../../../../shared/ui/segmented/segmented';
import { toneMark } from '../../../../shared/ui/tone';
import { UiWaitsChip } from '../../../../shared/ui/waits-chip/waits-chip';
import { CardContext } from '../card/card-context';
import { CardDetail } from '../card/card-detail';
import { FlowView } from '../flow/flow-view';
import { taskActorsOf } from '../live-frame';
import { LiveStore } from '../live.store';
import { TaskActors } from '../task-actors/task-actors';
import { barKey, LiveRail, registerLiveRail } from '../this-frame/live-rail';
import { YourSteps } from '../this-frame/your-steps';
import { BoardCard } from './board-card';
import { type LaneView, runChanges, runStates, specWaitOf } from './board-model';
import { LiveBoardStore } from './live-board.store';

/** How long a played frame stays on screen before the next one. */
const PLAY_STEP_MS = 1200;

/**
 * The FLIP's timing from the motion tokens of `motion.css` (spec 057, ISC-377): the duration in ms and the easing, read
 * from the root as computed, so the one token source (and its reduced-motion 0ms) holds for the Web Animations call
 * too. A token that does not resolve reads as no motion.
 */
function flipTiming(el: Element): { duration: number; easing: string } {
  const root = getComputedStyle(el.ownerDocument.documentElement);
  const raw = root.getPropertyValue('--motion-duration-base').trim();
  const value = Number.parseFloat(raw);
  const duration = Number.isFinite(value) ? (raw.endsWith('ms') ? value : value * 1000) : 0;
  return { duration, easing: root.getPropertyValue('--motion-ease-standard').trim() || 'linear' };
}

/**
 * The Board tab (T81, ISC-87 to ISC-93): core's frames (`…/frames`) and live frame (`…/live`) behind the scrubber,
 * shown as the Lanes view or the Flow view (T82, `app-flow-view` over the same lanes and cards); the Matrix (T88) is a
 * later task. The web never reads rounds.jsonl
 * and scrubbing writes no file: every control is a query param (`?view`, `?frame`, `?q`, `?hide`, `?lanes`,
 * `?density`), so reload and back land on the same board (the keyboard service writes `?view` and `?frame` too).
 * The frames live in the tab's `LiveStore`, the query params, lanes and toggles in its `LiveBoardStore` (spec 061,
 * ISC-436); the page keeps the DOM work: the run announcer, playback, the FLIP and the hand-over to the shell's rail.
 *
 * Lanes come in constitution order (the spec model's `lanes`), then lanes only the cards name, `operator` last. Each
 * lane holds four sections (Needs you, In flight with the lock's session, Waiting grouped by reason, Landed). At wide
 * the operator lane is "Your steps", rendered with "This frame" and "Needs you" in the shell rail (T88); below wide
 * and in zen a sticky bottom bar steps frames and opens both lists in a sheet. In zen the scrub row (scrubber, play,
 * frame chip, progress line) leaves the board, so the bar is the only frame control there (spec 047).
 *
 * Each card owns its detail dialog, opened from its id button (T83, `card/card.ts`). The board opens the same
 * `app-card-detail` only for a row of This frame or Needs you, which are rows and not cards.
 */
@Component({
  selector: 'app-board-tab',
  imports: [
    BoardCard,
    CardDetail,
    FlowView,
    LiveRail,
    RouterLink,
    UiWaitsChip,
    NgTemplateOutlet,
    TaskActors,
    TranslocoPipe,
    YourSteps,
    UiKbd,
    UiLiveRegion,
    UiDisclosure,
    UiIcon,
    UiMeter,
    UiScrubber,
    UiSegmented,
    UiSheet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CardContext, LiveStore, LiveBoardStore],
  host: { 'data-page': 'board', '[attr.data-tier]': 'tier()', '(document:keydown)': 'onKey($event)' },
  templateUrl: './board-tab.html',
  // The controls' rules come first, then the lanes'; two sheets keep each under the per-stylesheet budget.
  styleUrls: ['./_board-controls.css', './board-tab.css'],
})
export class BoardTab {
  private readonly transloco = inject(TranslocoService);
  protected readonly state = inject(ShellState);
  protected readonly live = inject(LiveStore);
  protected readonly board = inject(LiveBoardStore);

  protected readonly tier = computed(() => this.state.tier());
  protected readonly compact = computed(() => this.tier() === 'compact');
  protected readonly wide = computed(() => this.tier() === 'wide');

  /**
   * Spec 025 (T25, ISC-163): held cards group under core's `waits on NNN`, shown as "waits on" / "wartet auf" with the
   * numbers in mono and, first in the open group, a link to each blocker spec (never in the summary: no nested control).
   */
  protected readonly specWaitOf = specWaitOf;
  private readonly announcer = viewChild(UiLiveRegion);
  /** This frame, Needs you and the bottom bar (T88), handed to the shell's rail. */
  private readonly rail = viewChild(LiveRail);

  constructor() {
    // spec 027 (ISC-179.1): one polite announcement per refresh that moved a run chip ("T3: patch ready; T5:
    // building"), never one per chip, none on the first read.
    let seenRuns: ReadonlyMap<string, RunState> | null = null;
    effect(() => {
      const live = this.live.liveResult.value();
      if (live?.kind !== 'ok') return;
      const after = runStates(live.body.cards);
      const changes = runChanges(seenRuns, after);
      seenRuns = after;
      if (changes.length > 0) untracked(() => this.announcer()?.announceAll(changes.map((c) => this.runChanged(c.task, c.state))));
    });

    // Playback: one frame per step until the live frame, then stop. The timer is the I/O boundary here.
    effect((onCleanup) => {
      if (!this.board.playing()) return;
      const index = this.live.index();
      if (index >= this.live.lastIndex()) {
        this.board.playing.set(false);
        return;
      }
      const timer = setTimeout(() => this.board.setFrame(index + 1), PLAY_STEP_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // spec 024: the frame label for the card detail, the .changed tint for the cards whose
    // state changed with a frame change, and a FLIP of the Lanes view's cards over `--motion-duration-base` (none under reduced motion).
    const context = inject(CardContext);
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    let shownIndex: number | null = null;
    effect(() => {
      const f = this.live.frame();
      const index = this.live.index();
      context.frameLabel.set(f?.label ?? null);
      if (f === null) return;
      const events = untracked(() => this.live.events());
      context.changed.set(shownIndex !== null && shownIndex !== index ? new Set(events.map((c) => c.task)) : new Set());
      shownIndex = index;
    });
    // spec 015 (ISC-232): every task's agent steps from the live answer for the cards and their detail; a card names
    // its latest step only while the live frame is on screen.
    effect(() => {
      context.live.set(this.live.isLive());
      const live = this.live.liveResult.value();
      if (live?.kind === 'ok') context.steps.set('steps' in live.body ? live.body.steps : {});
    });
    let places = new Map<string, DOMRect>();
    let placedIndex: number | null = null;
    afterRenderEffect(() => {
      const index = this.live.index();
      this.board.lanes();
      const next = new Map<string, DOMRect>();
      const els = [...host.nativeElement.querySelectorAll<HTMLElement>('[data-lanes] article[data-card]')];
      for (const el of els) next.set(el.dataset['card'] ?? '', el.getBoundingClientRect());
      // Only a one-frame step animates (the scrubber, ← →): the first load lands on the live frame from frame 0, and a
      // jump across many frames would fly cards across lanes (and widen a lane while it runs).
      const move = placedIndex !== null && Math.abs(placedIndex - index) === 1 && !prefersReducedMotion();
      const timing = move ? flipTiming(host.nativeElement) : null;
      if (timing !== null && timing.duration > 0) {
        for (const el of els) {
          const before = places.get(el.dataset['card'] ?? '');
          const after = next.get(el.dataset['card'] ?? '');
          if (before === undefined || after === undefined) continue;
          const dx = before.left - after.left;
          const dy = before.top - after.top;
          if (dx !== 0 || dy !== 0) el.animate([{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }], timing);
        }
      }
      places = next;
      placedIndex = index;
    });

    // T88: This frame, Needs you and Your steps go to the shell's rail at wide; the bar below wide and in zen.
    registerLiveRail(this.rail, this.live.railBadges);
  }

  /** Whether core named an agent or sub-agent for the card (T135, ISC-131.1); only live cards carry them. */
  protected hasTaskActors(card: FrameCard): boolean {
    return taskActorsOf(card) !== null;
  }

  /** `o` opens This frame / Needs you below wide; `f` is the shell's search key. */
  protected onKey(event: KeyboardEvent): void {
    if (barKey(event, this.wide(), this.state.zen())) this.live.barOpen.set(true);
  }

  protected setSearch(event: Event): void {
    this.board.setSearch((event.target as HTMLInputElement).value);
  }

  /** The split meter of a lane header: one segment per section that holds cards. */
  protected laneSegments(lane: LaneView): readonly MeterSegment[] {
    return [
      { key: 'landed', count: lane.landed.length, tone: 'accent' as const },
      { key: 'inFlight', count: lane.inFlight.length, tone: 'primary' as const },
      { key: 'needsYou', count: lane.needsYou.length, tone: 'secondary' as const },
      { key: 'waiting', count: this.waitingCount(lane), tone: 'neutral' as const },
    ].filter((segment) => segment.count > 0);
  }

  protected waitingCount(lane: LaneView): number {
    return lane.waiting.reduce((sum, group) => sum + group.cards.length, 0);
  }

  protected stateWord(state: CardState): string {
    return stateKey(state, 'card');
  }

  protected stateColor(state: CardState): string {
    return toneMark(glyphSpec(state, 'card').tone);
  }

  protected runColor(state: RunState): string {
    return toneMark(glyphSpec(runGlyphState(state), 'card').tone);
  }

  /** One part of a tick's announcement: "T32: building". */
  private runChanged(task: string, state: RunState): string {
    const word: string = this.transloco.translate(`states.run.${state}`);
    return this.transloco.translate('live.runChanged', { task, state: word });
  }
}
