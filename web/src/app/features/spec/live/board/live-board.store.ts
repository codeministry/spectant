import { computed, DestroyRef, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { CardState, FrameCard } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { LockSourceService } from '../../../../core/lock-source.service';
import { type Density, isDensity, SettingsService } from '../../../../core/settings.service';
import { RefreshService } from '../../../../layout/shell/refresh.service';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { relativeParts } from '../../../../shared/ui/relative-time/relative-time';
import type { SegmentedOption } from '../../../../shared/ui/segmented/segmented';
import { type CheckEvent, type CheckState, checkBlock, IDLE, nextCheckState } from '../../data/tasks/checkbox';
import { LiveSource } from '../live-source';
import { LiveStore } from '../live.store';
import type { TaskRow } from '../this-frame/your-steps';
import {
  blockerTitles,
  buildLanes,
  heldWait,
  type KnownSpec,
  LANE_COLORS,
  laneOrder,
  laneSpecWait,
  matchesQuery,
  OPERATOR_LANE,
  parseList,
  resolveFrameIndex,
  runCounts,
  stateCounts,
} from './board-model';

/**
 * The live board's state (spec 061, ISC-436), provided by the Board tab beside its `LiveStore`: every control is a
 * query param (`?view`, `?frame`, `?q`, `?hide`, `?lanes`, `?density`), so reload and back land on the same board; the
 * lanes in constitution order after the filters, the lane waits, the legend, the round in flight; the viewer's toggles
 * (disclosures, collapsed lanes, the compact lane pick); and the operator steps' tasks.md read and their guarded
 * checkbox writes (T80's `checkbox.ts` state machine, the Tasks tab's). The density defaults to the stored setting
 * (spec 021, ISC-254); `?density` overrides it for this view only, and the switch writes only that param.
 */
@Injectable()
export class LiveBoardStore {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly refresher = inject(RefreshService);
  private readonly settings = inject(SettingsService);
  private readonly locks = inject(LockSourceService);
  private readonly live = inject(LiveStore);

  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  /** The prototype lane-quiet hint names the next command for this spec (spec 024: `next /spec implement 002`, the plugin's form since spec 031). */
  readonly nextCommand = computed(() => {
    const id = this.state.specId();
    return id === null ? null : `/spec implement ${id}`;
  });
  readonly wide = computed(() => this.state.tier() === 'wide');

  /** The clock the Live label reads, every 10 s like the header's "Updated 12 s ago". */
  private readonly now = signal(Date.now());
  /** "Live · updated 12 s ago" (prototype `.flabel`): whole units since the refresh service's last refresh. */
  readonly ago = computed(() => relativeParts(this.refresher.lastRefresh(), Math.max(this.now(), this.refresher.lastRefresh())));

  readonly view = computed(() => (this.query().get('view') === 'flow' ? 'flow' : 'lanes'));
  /** `?density` for this view, else the stored setting (ISC-254); an unknown value falls back to the setting. */
  readonly density = computed<Density>(() => {
    const param = this.query().get('density');
    return isDensity(param) ? param : this.settings.settings().density;
  });
  readonly search = computed(() => this.query().get('q') ?? '');
  readonly hiddenStates = computed(() => new Set(parseList(this.query().get('hide'))));
  readonly hiddenLanes = computed(() => new Set(parseList(this.query().get('lanes'))));

  /** Constitution lane order as the spec model carries it (`SpecPageModel.lanes`). */
  private readonly constitution = computed<readonly string[]>(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body.lanes.map((lane) => lane.name) : [];
  });
  readonly allCards = computed<readonly FrameCard[]>(() => this.live.frame()?.cards ?? []);
  readonly order = computed(() => laneOrder(this.constitution(), this.allCards()));
  readonly shownCards = computed(() => {
    const states = this.hiddenStates();
    const lanes = this.hiddenLanes();
    const q = this.search();
    return this.allCards().filter((c) => !states.has(c.state) && !lanes.has(c.lane) && matchesQuery(c, q));
  });
  readonly filtered = computed(() => this.shownCards().length !== this.allCards().length);
  /** The Lanes view groups the round in flight (spec 027) as "In round n"; Flow keeps each card in its state's column. */
  readonly lanes = computed(() => buildLanes(this.order(), this.shownCards(), true));
  readonly flowLanes = computed(() => buildLanes(this.order(), this.shownCards()));
  /** The lanes in the grid: at wide the operator lane is "Your steps", its own checklist lane (`stepCards`). */
  readonly gridLanes = computed(() => (this.wide() ? this.lanes().filter((l) => l.name !== OPERATOR_LANE) : this.lanes()));
  readonly operatorLane = computed(() => (this.wide() ? (this.lanes().find((l) => l.name === OPERATOR_LANE) ?? null) : null));

  /** Every spec the shell knows, active and archived: the blocker titles and links, unknown numbers drawn unlinked. */
  private readonly knownSpecs = computed<readonly KnownSpec[]>(() => [...this.data.specRows(), ...this.data.archiveRows()]);
  readonly wsSlug = computed(() => this.state.ws() ?? '');
  specTitle(id: string): string | null {
    return this.knownSpecs().find((row) => row.id === id)?.title ?? null;
  }
  /** A lane whose whole open work waits on spec edges carries the `waits on NNN` chip in its head; never a lane stub. */
  readonly laneWaits = computed(() => {
    const spec = this.state.specId() ?? '';
    const known = this.knownSpecs();
    return new Map(this.lanes().flatMap((lane) => {
      const blockers = laneSpecWait(lane);
      return blockers === null ? [] : [[lane.name, { wait: heldWait(spec, blockers, known), titles: blockerTitles(blockers, known) }] as const];
    }));
  });

  readonly legend = computed(() => stateCounts(this.allCards()).map((s) => ({ ...s, pressed: !this.hiddenStates().has(s.state) })));
  /** spec 027: the live frame's round in flight; history frames reconstruct none (design.md, live board). */
  private readonly round = computed(() => {
    const f = this.live.frame();
    return f !== null && 'inRound' in f ? (f.inRound ?? null) : null;
  });
  readonly roundNumber = computed(() => this.round()?.round ?? null);
  /** The toolbar's counters: core's round counts above 0, in run order, before the card states. */
  readonly runCounters = computed(() => runCounts(this.round()?.total));

  readonly viewOptions = computed<readonly SegmentedOption[]>(() => {
    this.live.lang();
    return [
      { key: 'lanes', label: this.transloco.translate('board.view.lanes'), icon: 'rows-3' },
      { key: 'flow', label: this.transloco.translate('board.view.flow'), icon: 'workflow' },
    ];
  });

  /** Your steps at wide (T88): the operator lane's cards of the frame, board order. */
  readonly operatorCards = computed(() => this.allCards().filter((c) => c.lane === OPERATOR_LANE));
  /** spec 024 (design.md § Live · Operator lane): the operator lane drawn at wide as the checklist lane of the grid (Lanes) or the
   * row across all columns (Flow), after the board's filters; null when none is shown. */
  readonly stepCards = computed<readonly FrameCard[] | null>(() => {
    const lane = this.operatorLane();
    return lane === null ? null : this.shownCards().filter((c) => c.lane === OPERATOR_LANE);
  });

  /** Compact (design.md § Across viewports, correction 2): one lane at a time, picked with the lane switch. */
  private readonly pickedLane = signal<string | null>(null);
  readonly currentLane = computed(() => {
    const lanes = this.gridLanes();
    const picked = this.pickedLane();
    if (picked !== null && lanes.some((l) => l.name === picked)) return picked;
    return (lanes.find((l) => l.needsYou.length > 0) ?? lanes.find((l) => l.inFlight.length > 0) ?? lanes.at(0))?.name ?? null;
  });
  /** A waiting lane's segment leads with `clock` and is named "web, waits on 006" (spec 025, T25). */
  readonly laneOptions = computed<readonly SegmentedOption[]>(() => {
    const waits = this.laneWaits();
    const lang = this.live.lang();
    return this.gridLanes().map((l) => {
      const held = waits.get(l.name);
      if (held === undefined) return { key: l.name, label: l.name };
      const ariaLabel: string = this.transloco.translate('board.lane.waitsName', { lane: l.name, ids: held.wait.blockers.join(', ') }, lang);
      return { key: l.name, label: l.name, icon: 'clock', ariaLabel };
    });
  });
  /** Lanes hidden with the lane filter: a stub "core · hidden · show" in their place (prototype `.lane-stub`). */
  readonly hiddenLaneNames = computed(() => this.order().filter((lane) => this.hiddenLanes().has(lane)));
  /** Landed sections the viewer opened past the first five cards. */
  readonly landedAll = signal<ReadonlySet<string>>(new Set());
  readonly playing = signal(false);
  readonly filterOpen = signal(false);
  readonly searchOpen = signal(false);
  /** Disclosures the viewer toggled, by key; untouched ones take their tier default. */
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());
  private readonly collapsedLanes = signal<ReadonlySet<string>>(new Set());

  /** The operator steps' tasks.md read (core's parse), only while Your steps is drawn. */
  private readonly tasks = inject(LiveSource).tasks(() => this.stepCards() !== null);
  readonly stepRows = computed<ReadonlyMap<string, TaskRow>>(() => {
    const result = this.tasks.value();
    return new Map(result?.kind === 'ok' && result.body ? result.body.tasks.map((row) => [row.id, row]) : []);
  });
  /** The hash the next tick sends: the read's, then each accepted write's (as the Tasks tab). */
  readonly stepHash = linkedSignal(() => {
    const result = this.tasks.value();
    return result?.kind === 'ok' ? result.hash : null;
  });
  /** The write state per task id; a new read drops them all. */
  readonly stepChecks = linkedSignal<unknown, ReadonlyMap<string, CheckState>>({
    source: () => this.tasks.value(),
    computation: () => new Map(),
  });

  constructor() {
    this.live.useIndex(() => resolveFrameIndex(this.query().get('frame'), this.live.lastIndex()));
    // The Live label's clock; `LiveSource` re-reads the live frame on every refresh (ETag: a 304 costs no body), so
    // "updated n s ago" names when this board was last read.
    const clock = setInterval(() => this.now.set(Date.now()), 10_000);
    inject(DestroyRef).onDestroy(() => clearInterval(clock));
  }

  setFrame(index: number): void {
    const last = this.live.lastIndex();
    const clamped = Math.min(last, Math.max(0, index));
    this.setQuery({ frame: clamped >= last ? null : String(clamped) });
  }

  setView(view: string | undefined): void {
    this.setQuery({ view: view === 'flow' ? 'flow' : 'lanes' });
  }

  /**
   * Flips this view's density through `?density` alone (ISC-254); the setting is never written here. Landing back on
   * the stored value drops the param, so the view follows the setting again.
   */
  toggleDensity(): void {
    const next: Density = this.density() === 'compact' ? 'comfortable' : 'compact';
    this.setQuery({ density: next === this.settings.settings().density ? null : next });
  }

  pickLane(lane: string | undefined): void {
    this.pickedLane.set(lane ?? null);
  }

  showAllLanded(lane: string): void {
    this.landedAll.update((set) => new Set(set).add(lane));
  }

  setSearch(value: string): void {
    this.setQuery({ q: value === '' ? null : value }, true);
  }

  toggleState(state: CardState): void {
    this.setQuery({ hide: toggledList(this.hiddenStates(), state) });
  }

  toggleLaneFilter(lane: string): void {
    this.setQuery({ lanes: toggledList(this.hiddenLanes(), lane) });
  }

  clearFilters(): void {
    this.setQuery({ hide: null, lanes: null, q: null });
  }

  isOpen(key: string, fallback: boolean): boolean {
    return this.toggled().get(key) ?? fallback;
  }

  setOpen(key: string, open: boolean): void {
    this.toggled.update((map) => new Map(map).set(key, open));
  }

  /** The lane dot: the prototype's lane colours in constitution order (cyan, violet, yellow, green, orange). */
  laneColor(lane: string): string {
    if (lane === OPERATOR_LANE) return 'var(--muted-ink)';
    const i = Math.max(0, this.order().indexOf(lane));
    return LANE_COLORS[i % LANE_COLORS.length] ?? 'var(--color-primary)';
  }

  laneCollapsed(lane: string): boolean {
    return this.collapsedLanes().has(lane);
  }

  toggleLane(lane: string): void {
    this.collapsedLanes.update((set) => {
      const next = new Set(set);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  }

  /** A step's box: post the state wanted with the hash of this read, then apply the answer (ISC-25, ISC-26, ISC-86). */
  async tick(task: string, checked: boolean): Promise<void> {
    const ws = this.state.ws();
    const id = this.state.specId();
    const row = this.stepRows().get(task) ?? null;
    const hash = this.stepHash();
    if (ws === null || id === null || row === null || hash === null) return;
    if (checkBlock(row, this.checkOf(task), this.locks.lock(), hash) !== null) return;
    this.transition(task, { type: 'tick', checked });
    const result = await this.api.taskCheck(ws, id, task, hash, checked);
    if (!this.transition(task, { type: 'answer', result }) || result.kind !== 'ok') return;
    this.stepHash.set(result.body.hash);
  }

  private checkOf(task: string): CheckState {
    return this.stepChecks().get(task) ?? IDLE;
  }

  private transition(task: string, event: CheckEvent): boolean {
    const current = this.checkOf(task);
    const next = nextCheckState(current, event);
    if (next === current) return false;
    this.stepChecks.update((checks) => new Map(checks).set(task, next));
    return true;
  }

  private setQuery(patch: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: patch, queryParamsHandling: 'merge', replaceUrl });
  }
}

/** A list param with `item` flipped: null when nothing stays hidden. */
function toggledList(hidden: ReadonlySet<string>, item: string): string | null {
  const next = new Set(hidden);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next.size === 0 ? null : [...next].join(',');
}
