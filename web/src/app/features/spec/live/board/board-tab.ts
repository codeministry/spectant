import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, resource, signal, type TemplateRef, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { CardState, Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { RefreshService } from '../../../../core/refresh.service';
import { type RailBadge, RailContent } from '../../../../layout/shell/rail-content';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiKbd } from '../../../../shared/ui/kbd/kbd';
import { relativeParts } from '../../../../shared/ui/relative-time/relative-time';
import { glyphSpec, stateKey } from '../../../../shared/ui/glyph/states';
import { type MeterSegment, UiMeter } from '../../../../shared/ui/meter/meter';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { UiSheet } from '../../../../shared/ui/overlay/sheet';
import { UiScrubber } from '../../../../shared/ui/scrubber/scrubber';
import { type SegmentedOption, UiSegmented } from '../../../../shared/ui/segmented/segmented';
import { toneMark } from '../../../../shared/ui/tone';
import { prefersReducedMotion } from '../../../../core/motion';
import { CardContext } from '../card/card-context';
import { CardDetail } from '../card/card-detail';
import { cardHistory } from '../card/card-history';
import { FlowView } from '../flow/flow-view';
import { taskActorsOf } from '../live-frame';
import { TaskActors } from '../task-actors/task-actors';
import { FrameBar } from '../this-frame/frame-bar';
import { NeedsYou } from '../this-frame/needs-you';
import { ThisFrame } from '../this-frame/this-frame';
import { YourSteps } from '../this-frame/your-steps';
import { BoardCard } from './board-card';
import {
  buildLanes,
  frameEvents,
  laneOrder,
  type LaneView,
  matchesQuery,
  needsYouOf,
  LANE_COLORS,
  OPERATOR_LANE,
  parseList,
  recutMarkers,
  resolveFrameIndex,
  scrubberStops,
  stateCounts,
} from './board-model';

type AnyFrame = Frame | LiveFrame;
type Density = 'comfortable' | 'compact';

type BarTab = 'frame' | 'needs';

/** How long a played frame stays on screen before the next one. */
const PLAY_STEP_MS = 1200;

/**
 * The Board tab (T81, ISC-87 to ISC-93): core's frames (`…/frames`) and live frame (`…/live`) behind the scrubber,
 * shown as the Lanes view or the Flow view (T82, `app-flow-view` over the same lanes and cards); the Matrix (T88) is a
 * later task. The web never reads rounds.jsonl
 * and scrubbing writes no file: every control is a query param (`?view`, `?frame`, `?q`, `?hide`, `?lanes`,
 * `?density`), so reload and back land on the same board (the keyboard service writes `?view` and `?frame` too).
 *
 * Lanes come in constitution order (the spec model's `lanes`), then lanes only the cards name, `operator` last. Each
 * lane holds four sections (Needs you, In flight with the lock's session, Waiting grouped by reason, Landed). At wide
 * the operator lane is "Your steps", rendered with "This frame" and "Needs you" in the shell rail (T88); below wide
 * and in zen a sticky bottom bar steps frames and opens both lists in a sheet.
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
    FrameBar,
    NeedsYou,
    NgTemplateOutlet,
    TaskActors,
    ThisFrame,
    TranslocoPipe,
    YourSteps,
    UiKbd,
    UiDisclosure,
    UiIcon,
    UiMeter,
    UiScrubber,
    UiSegmented,
    UiSheet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CardContext],
  host: { 'data-page': 'board', '[attr.data-tier]': 'tier()', '(document:keydown)': 'onKey($event)' },
  templateUrl: './board-tab.html',
  styleUrl: './board-tab.css',
})
export class BoardTab {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly refresher = inject(RefreshService);

  private readonly params = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });
  readonly framesResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.frames(params.ws, params.id) });
  readonly liveResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.live(params.ws, params.id) });

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  /** The prototype lane-quiet hint names the next command for this spec (spec 024: `next /spec-implement 002`). */
  protected readonly nextCommand = computed(() => {
    const id = this.state.specId();
    return id === null ? null : `/spec-implement ${id}`;
  });
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly tier = computed(() => this.state.tier());
  protected readonly compact = computed(() => this.tier() === 'compact');
  protected readonly wide = computed(() => this.tier() === 'wide');

  /** Every frame on the scrubber: the history (`Frame[]`), then the live frame. */
  protected readonly frames = computed<readonly AnyFrame[]>(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return [...(history?.kind === 'ok' ? history.body : []), ...(live?.kind === 'ok' ? [live.body] : [])];
  });
  protected readonly failed = computed(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return history !== undefined && live !== undefined && history.kind !== 'ok' && live.kind !== 'ok';
  });
  protected readonly lastIndex = computed(() => Math.max(0, this.frames().length - 1));
  protected readonly index = computed(() => resolveFrameIndex(this.query().get('frame'), this.lastIndex()));
  protected readonly frame = computed<AnyFrame | null>(() => this.frames()[this.index()] ?? null);
  protected readonly isLive = computed(() => this.frame()?.kind === 'live');
  /** The clock the Live label reads, every 10 s like the header's "Updated 12 s ago". */
  private readonly now = signal(Date.now());
  /** "Live · updated 12 s ago" (prototype `.flabel`): whole units since the refresh service's last refresh. */
  protected readonly ago = computed(() => relativeParts(this.refresher.lastRefresh(), Math.max(this.now(), this.refresher.lastRefresh())));
  private readonly previous = computed<AnyFrame | null>(() => this.frames()[this.index() - 1] ?? null);

  protected readonly view = computed(() => (this.query().get('view') === 'flow' ? 'flow' : 'lanes'));
  protected readonly density = computed<Density>(() => (this.query().get('density') === 'compact' ? 'compact' : 'comfortable'));
  protected readonly search = computed(() => this.query().get('q') ?? '');
  protected readonly hiddenStates = computed(() => new Set(parseList(this.query().get('hide'))));
  protected readonly hiddenLanes = computed(() => new Set(parseList(this.query().get('lanes'))));

  /** Constitution lane order as the spec model carries it (`SpecPageModel.lanes`). */
  private readonly constitution = computed<readonly string[]>(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body.lanes.map((lane) => lane.name) : [];
  });
  protected readonly allCards = computed<readonly FrameCard[]>(() => this.frame()?.cards ?? []);
  protected readonly order = computed(() => laneOrder(this.constitution(), this.allCards()));
  protected readonly shownCards = computed(() => {
    const states = this.hiddenStates();
    const lanes = this.hiddenLanes();
    const q = this.search();
    return this.allCards().filter((c) => !states.has(c.state) && !lanes.has(c.lane) && matchesQuery(c, q));
  });
  protected readonly filtered = computed(() => this.shownCards().length !== this.allCards().length);
  protected readonly lanes = computed(() => buildLanes(this.order(), this.shownCards()));
  /** The lanes in the grid: at wide the operator lane is "Your steps", its own checklist lane (`stepCards`). */
  protected readonly gridLanes = computed(() => (this.wide() ? this.lanes().filter((l) => l.name !== OPERATOR_LANE) : this.lanes()));
  protected readonly operatorLane = computed(() => (this.wide() ? (this.lanes().find((l) => l.name === OPERATOR_LANE) ?? null) : null));

  protected readonly legend = computed(() => stateCounts(this.allCards()).map((s) => ({ ...s, pressed: !this.hiddenStates().has(s.state) })));
  protected readonly stops = computed(() => scrubberStops(this.frames(), this.compact()));
  protected readonly markers = computed(() => {
    this.lang();
    return recutMarkers(this.frames(), this.transloco.translate('board.frame.recut'), (counts) => this.transloco.translate('board.frame.recutTitle', counts));
  });
  protected readonly events = computed(() => {
    const frame = this.frame();
    return frame === null ? [] : frameEvents(this.previous(), frame);
  });
  protected readonly needsYou = computed(() => {
    const frame = this.frame();
    return frame === null ? [] : needsYouOf(frame);
  });

  protected readonly viewOptions = computed<readonly SegmentedOption[]>(() => {
    this.lang();
    return [
      { key: 'lanes', label: this.transloco.translate('board.view.lanes'), icon: 'rows-3' },
      { key: 'flow', label: this.transloco.translate('board.view.flow'), icon: 'workflow' },
    ];
  });
  protected readonly barTabs = computed<readonly SegmentedOption[]>(() => {
    this.lang();
    return [
      { key: 'frame', label: this.transloco.translate('board.rail.thisFrameCount', { count: this.events().length }) },
      { key: 'needs', label: this.transloco.translate('board.rail.needsYouCount', { count: this.needsYou().length }) },
    ];
  });

  /** Your steps at wide (T88): the operator lane's cards of the frame, board order. */
  protected readonly operatorCards = computed(() => this.allCards().filter((c) => c.lane === OPERATOR_LANE));
  /** spec 024 (design.md § Live · Operator-Lane): the operator lane drawn at wide as the checklist lane of the grid (Lanes) or the
   * row across all columns (Flow), after the board's filters; null when none is shown. */
  protected readonly stepCards = computed<readonly FrameCard[] | null>(() => {
    const lane = this.operatorLane();
    return lane === null ? null : this.shownCards().filter((c) => c.lane === OPERATOR_LANE);
  });
  /** The rail blocks and the bottom bar, declared in this template and rendered by the shell (`RailContent`). */
  private readonly railBlocks = viewChild<TemplateRef<unknown>>('railBlocks');
  private readonly frameBar = viewChild<TemplateRef<unknown>>('frameBar');
  /** The collapsed strip's two badges on the board: This frame and Needs you. */
  private readonly railBadges = computed<readonly RailBadge[]>(() => {
    this.lang();
    const thisFrame = this.events().length;
    const needsYou = this.needsYou().length;
    return [
      { key: 'thisFrame', count: thisFrame, label: this.transloco.translate('board.rail.badgeThisFrame', { count: thisFrame }) },
      { key: 'needsYou', count: needsYou, label: this.transloco.translate('board.rail.badgeNeedsYou', { count: needsYou }) },
    ];
  });

  /** Compact (design.md § Viewport-übergreifend, correction 2): one lane at a time, picked with the lane switch. */
  private readonly pickedLane = signal<string | null>(null);
  protected readonly currentLane = computed(() => {
    const lanes = this.gridLanes();
    const picked = this.pickedLane();
    if (picked !== null && lanes.some((l) => l.name === picked)) return picked;
    return (lanes.find((l) => l.needsYou.length > 0) ?? lanes.find((l) => l.inFlight.length > 0) ?? lanes.at(0))?.name ?? null;
  });
  protected readonly laneOptions = computed<readonly SegmentedOption[]>(() => this.gridLanes().map((l) => ({ key: l.name, label: l.name })));
  /** Lanes hidden with the lane filter: a stub "core · hidden · show" in their place (prototype `.lane-stub`). */
  protected readonly hiddenLaneNames = computed(() => this.order().filter((lane) => this.hiddenLanes().has(lane)));
  /** Landed sections the viewer opened past the first five cards. */
  protected readonly landedAll = signal<ReadonlySet<string>>(new Set());
  protected readonly playing = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly searchOpen = signal(false);
  protected readonly barOpen = signal(false);
  protected readonly barTab = signal<BarTab>('frame');
  /** The card a This frame or Needs you row opened, shown in the card detail until it closes. */
  protected readonly selected = signal<FrameCard | null>(null);
  protected readonly selectedHistory = computed(() => {
    const card = this.selected();
    return card === null ? null : cardHistory(this.frames(), card);
  });
  /** Disclosures the viewer toggled, by key; untouched ones take their tier default. */
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());
  private readonly collapsedLanes = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // The Live label's clock, and the live frame re-read on every refresh (ETag: a 304 costs no body), so "updated
    // n s ago" names when this board was last read.
    const clock = setInterval(() => this.now.set(Date.now()), 10_000);
    inject(DestroyRef).onDestroy(() => clearInterval(clock));
    let firstRefresh = true;
    effect(() => {
      this.refresher.lastRefresh();
      if (firstRefresh) firstRefresh = false;
      else untracked(() => this.liveResult.reload());
    });

    // Playback: one frame per step until the live frame, then stop. The timer is the I/O boundary here.
    effect((onCleanup) => {
      if (!this.playing()) return;
      const index = this.index();
      if (index >= this.lastIndex()) {
        this.playing.set(false);
        return;
      }
      const timer = setTimeout(() => this.setFrame(index + 1), PLAY_STEP_MS);
      onCleanup(() => clearTimeout(timer));
    });

    // spec 024 (prototype board.js render): the frame label for the card detail, the .changed tint for the cards whose
    // state changed with a frame change, and a 240 ms FLIP of the Lanes view's cards (none under reduced motion).
    const context = inject(CardContext);
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    let shownIndex: number | null = null;
    effect(() => {
      const f = this.frame();
      const index = this.index();
      context.frameLabel.set(f?.label ?? null);
      if (f === null) return;
      const events = untracked(() => this.events());
      context.changed.set(shownIndex !== null && shownIndex !== index ? new Set(events.map((c) => c.task)) : new Set());
      shownIndex = index;
    });
    let places = new Map<string, DOMRect>();
    let placedIndex: number | null = null;
    afterRenderEffect(() => {
      const index = this.index();
      this.lanes();
      const next = new Map<string, DOMRect>();
      const els = [...host.nativeElement.querySelectorAll<HTMLElement>('[data-lanes] article[data-card]')];
      for (const el of els) next.set(el.dataset['card'] ?? '', el.getBoundingClientRect());
      // Only a one-frame step animates (the scrubber, ← →): the first load lands on the live frame from frame 0, and a
      // jump across many frames would fly cards across lanes (and widen a lane while it runs).
      const move = placedIndex !== null && Math.abs(placedIndex - index) === 1 && !prefersReducedMotion();
      if (move) {
        for (const el of els) {
          const before = places.get(el.dataset['card'] ?? '');
          const after = next.get(el.dataset['card'] ?? '');
          if (before === undefined || after === undefined) continue;
          const dx = before.left - after.left;
          const dy = before.top - after.top;
          if (dx !== 0 || dy !== 0) el.animate([{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' });
        }
      }
      places = next;
      placedIndex = index;
    });

    // T88: This frame, Needs you and Your steps go to the shell's rail at wide; the bar below wide and in zen.
    inject(RailContent).register(
      {
        blocks: computed(() => (this.wide() ? (this.railBlocks() ?? null) : null)),
        bar: computed(() => this.frameBar() ?? null),
        badges: this.railBadges,
      },
      inject(DestroyRef),
    );
  }

  /** Whether core named an agent or sub-agent for the card (T135, ISC-131.1); only live cards carry them. */
  protected hasTaskActors(card: FrameCard): boolean {
    return taskActorsOf(card) !== null;
  }

  protected setFrame(index: number): void {
    const clamped = Math.min(this.lastIndex(), Math.max(0, index));
    this.setQuery({ frame: clamped >= this.lastIndex() ? null : String(clamped) });
  }

  protected setView(view: string | undefined): void {
    this.setQuery({ view: view === 'flow' ? 'flow' : 'lanes' });
  }

  protected toggleDensity(): void {
    this.setQuery({ density: this.density() === 'compact' ? null : 'compact' });
  }

  protected pickLane(lane: string | undefined): void {
    this.pickedLane.set(lane ?? null);
  }

  protected showAllLanded(lane: string): void {
    this.landedAll.update((set) => new Set(set).add(lane));
  }

  /** The lane dot: the prototype's lane colours in constitution order (cyan, violet, yellow, green, orange). */
  protected laneColor(lane: string): string {
    if (lane === OPERATOR_LANE) return 'var(--muted-ink)';
    const i = Math.max(0, this.order().indexOf(lane));
    return LANE_COLORS[i % LANE_COLORS.length] ?? 'var(--color-primary)';
  }

  /** `o` opens This frame / Needs you below wide (prototype `.sheet-bar kbd`); `f` is the shell's search key. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'o' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.wide() && !this.state.zen()) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    event.preventDefault();
    this.barOpen.set(true);
  }

  protected setSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.setQuery({ q: value === '' ? null : value }, true);
  }

  protected toggleState(state: CardState): void {
    const hidden = new Set(this.hiddenStates());
    if (hidden.has(state)) hidden.delete(state);
    else hidden.add(state);
    this.setQuery({ hide: hidden.size === 0 ? null : [...hidden].join(',') });
  }

  protected toggleLaneFilter(lane: string): void {
    const hidden = new Set(this.hiddenLanes());
    if (hidden.has(lane)) hidden.delete(lane);
    else hidden.add(lane);
    this.setQuery({ lanes: hidden.size === 0 ? null : [...hidden].join(',') });
  }

  protected clearFilters(): void {
    this.setQuery({ hide: null, lanes: null, q: null });
  }

  protected isOpen(key: string, fallback: boolean): boolean {
    return this.toggled().get(key) ?? fallback;
  }

  protected setOpen(key: string, open: boolean): void {
    this.toggled.update((map) => new Map(map).set(key, open));
  }

  protected laneCollapsed(lane: string): boolean {
    return this.collapsedLanes().has(lane);
  }

  protected toggleLane(lane: string): void {
    this.collapsedLanes.update((set) => {
      const next = new Set(set);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  }

  /** A row of This frame or Needs you: close the sheet and show the card detail. */
  protected openCard(card: FrameCard): void {
    this.barOpen.set(false);
    this.selected.set(card);
  }

  protected closeDetail(open: boolean): void {
    if (!open) this.selected.set(null);
  }

  protected setBarTab(tab: string | undefined): void {
    this.barTab.set(tab === 'needs' ? 'needs' : 'frame');
  }

  /** The split meter of a lane header: one segment per section that holds cards. */
  protected laneSegments(lane: LaneView): readonly MeterSegment[] {
    const waiting = lane.waiting.reduce((sum, group) => sum + group.cards.length, 0);
    return [
      { key: 'landed', count: lane.landed.length, tone: 'accent' as const },
      { key: 'inFlight', count: lane.inFlight.length, tone: 'primary' as const },
      { key: 'needsYou', count: lane.needsYou.length, tone: 'secondary' as const },
      { key: 'waiting', count: waiting, tone: 'neutral' as const },
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

  private setQuery(patch: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge', replaceUrl });
  }
}
