import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, resource, signal, type TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { CardState, Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { type RailBadge, RailContent } from '../../../../layout/shell/rail-content';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec, stateKey } from '../../../../shared/ui/glyph/states';
import { type MeterSegment, UiMeter } from '../../../../shared/ui/meter/meter';
import { UiDialog } from '../../../../shared/ui/overlay/dialog';
import { UiDisclosure } from '../../../../shared/ui/overlay/disclosure';
import { UiSheet } from '../../../../shared/ui/overlay/sheet';
import { UiScrubber } from '../../../../shared/ui/scrubber/scrubber';
import { type SegmentedOption, UiSegmented } from '../../../../shared/ui/segmented/segmented';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { toneMark } from '../../../../shared/ui/tone';
import { FlowView } from '../flow/flow-view';
import { agentOfCard, type CardAgent } from '../live-frame';
import { AgentChip } from '../this-frame/agent-chip';
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
 * the operator lane is "Your steps", rendered with "This frame" and "Needs you" under the lanes until the rail task
 * gives them their home in the rail; at compact a sticky bottom bar steps frames and opens both lists in a sheet.
 */
@Component({
  selector: 'app-board-tab',
  imports: [
    AgentChip,
    BoardCard,
    FlowView,
    FrameBar,
    NeedsYou,
    NgTemplateOutlet,
    ThisFrame,
    TranslocoPipe,
    YourSteps,
    UiChip,
    UiDialog,
    UiDisclosure,
    UiGlyph,
    UiIcon,
    UiMeter,
    UiScrubber,
    UiSegmented,
    UiSheet,
    UiStateChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'board', '[attr.data-tier]': 'tier()' },
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

  private readonly params = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });
  readonly framesResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.frames(params.ws, params.id) });
  readonly liveResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.live(params.ws, params.id) });

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
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
  /** The lanes in the grid: at wide the operator lane is "Your steps" under the lanes (the rail's, later). */
  protected readonly gridLanes = computed(() => (this.wide() ? this.lanes().filter((l) => l.name !== OPERATOR_LANE) : this.lanes()));
  protected readonly operatorLane = computed(() => (this.wide() ? (this.lanes().find((l) => l.name === OPERATOR_LANE) ?? null) : null));

  protected readonly legend = computed(() => stateCounts(this.allCards()).map((s) => ({ ...s, pressed: !this.hiddenStates().has(s.state) })));
  protected readonly stops = computed(() => scrubberStops(this.frames(), this.compact()));
  protected readonly markers = computed(() => {
    this.lang();
    return recutMarkers(this.frames(), this.transloco.translate('board.frame.recut'));
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
      { key: 'lanes', label: this.transloco.translate('board.view.lanes') },
      { key: 'flow', label: this.transloco.translate('board.view.flow') },
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

  protected readonly playing = signal(false);
  protected readonly filterOpen = signal(false);
  protected readonly searchOpen = signal(false);
  protected readonly barOpen = signal(false);
  protected readonly barTab = signal<BarTab>('frame');
  protected readonly detailOpen = signal(false);
  protected readonly selected = signal<FrameCard | null>(null);
  /** Disclosures the viewer toggled, by key; untouched ones take their tier default. */
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());
  private readonly collapsedLanes = signal<ReadonlySet<string>>(new Set());

  constructor() {
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

  /** The agent holding a card in flight (T85, ISC-90): session, since, stale. */
  protected agentOf(card: FrameCard): CardAgent | null {
    return agentOfCard(card);
  }

  protected setFrame(index: number): void {
    const clamped = Math.min(this.lastIndex(), Math.max(0, index));
    this.setQuery({ frame: clamped >= this.lastIndex() ? null : String(clamped) });
  }

  protected setView(view: string | undefined): void {
    this.setQuery({ view: view === 'flow' ? 'flow' : 'lanes' });
  }

  protected setDensity(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.setQuery({ density: value === 'compact' ? 'compact' : null });
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

  protected openCard(card: FrameCard): void {
    this.selected.set(card);
    this.barOpen.set(false);
    this.detailOpen.set(true);
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

  protected liveStale(card: FrameCard): boolean {
    return 'stale' in card && card.stale === true;
  }

  private setQuery(patch: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge', replaceUrl });
  }
}
