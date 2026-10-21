import { computed, inject, Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../../core/src/files';
import { guidanceEntryOf } from '../../../core/model/guidance-entry';
import { overlapLines, overlapsIn } from '../../../core/model/overlap';
import { type AreaId, areaById, areaPath } from '../../../layout/shell/areas';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { MeterSegment } from '../../../shared/ui/meter/meter';
import { activeLang, claimsRatio, specBrief, specModel, specTabLink, specView, stageTrack } from '../spec-view';
import { GATE_NAMES, GATE_TONE } from './dashboard-model';

/** The five area tiles in menu order, each with its provisional `g` key (the sequences themselves arrive with T102). */
const TILE_AREAS: ReadonlyArray<{ readonly id: Exclude<AreaId, 'dashboard'>; readonly key: string }> = [
  { id: 'status', key: 's' },
  { id: 'live', key: 'l' },
  { id: 'data', key: 'd' },
  { id: 'library', key: 'o' },
  { id: 'notes', key: 'n' },
];

export interface AreaTile {
  readonly id: Exclude<AreaId, 'dashboard'>;
  readonly link: string[];
  readonly hint: string;
  /** Two translated meta lines, their numbers read from `SpecPageModel.areas`. */
  readonly lines: readonly string[];
  /** A mono chip on the first line (the Live tile's session name), full text in `title`. */
  readonly mono?: string;
}

type TileLine = readonly [string, Readonly<Record<string, unknown>>];
const DOC_KEYS = ['plan', 'design', 'constitution'] as const;

/** The meta lines of each area tile as i18n keys: numbers straight from `model.areas`, never recounted (ISC-72). */
function tileLines(model: SpecPageModel, id: AreaTile['id'], t: (key: string) => string): readonly TileLine[] {
  const { areas } = model;
  switch (id) {
    case 'status':
      return [
        [areas.status.timelineEntries === 1 ? 'specDashboard.tiles.status.entries.one' : 'specDashboard.tiles.status.entries.other', { count: areas.status.timelineEntries }],
        [areas.status.warnings === 1 ? 'specDashboard.tiles.status.warnings.one' : 'specDashboard.tiles.status.warnings.other', { count: areas.status.warnings }],
      ];
    case 'live':
      return [
        areas.live.agentsWorking > 0
          ? [areas.live.agentsWorking === 1 ? 'specDashboard.tiles.live.working.one' : 'specDashboard.tiles.live.working.other', { count: areas.live.agentsWorking }]
          : ['specDashboard.tiles.live.idle', {}],
        ['specDashboard.tiles.live.source', { source: areas.live.lockSource }],
      ];
    case 'data':
      return [
        ['specDashboard.tiles.data.claims', areas.data.claims],
        areas.data.tasks === null ? ['specDashboard.tiles.data.noTasks', {}] : ['specDashboard.tiles.data.tasks', areas.data.tasks],
      ];
    case 'library':
      return [
        DOC_KEYS.some((doc) => areas.docs[doc])
          ? ['specDashboard.tiles.library.present', { names: DOC_KEYS.filter((doc) => areas.docs[doc]).map((doc) => t(`specDashboard.docNames.${doc}`)).join(' · ') }]
          : ['specDashboard.tiles.library.none', {}],
        [areas.docs.decisions === 1 ? 'specDashboard.tiles.library.decisions.one' : 'specDashboard.tiles.library.decisions.other', { count: areas.docs.decisions }],
      ];
    case 'notes':
      return [
        areas.notes.count === null ? ['specDashboard.tiles.notes.later', {}] : [areas.notes.count === 1 ? 'specDashboard.tiles.notes.count.one' : 'specDashboard.tiles.notes.count.other', { count: areas.notes.count }],
        [areas.board.rounds === 1 ? 'specDashboard.tiles.notes.board.one' : 'specDashboard.tiles.notes.board.other', { count: areas.board.rounds }],
      ];
  }
}

/**
 * The state of the spec dashboard (`SpecDashboard`, T53, ISC-78, spec 061): every block's derivation from the spec
 * payload the shell already loads (`ShellData.spec`), read as it is (ISC-72). The page keeps the rail registration and
 * the template; this store holds what it shows.
 */
@Injectable()
export class DashboardStore {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly transloco = inject(TranslocoService);

  private readonly lang = activeLang(this.transloco);

  /** From 1120 px the Spec context lives in the shell's rail; below it closes the main column. */
  readonly wide = computed(() => this.state.tier() === 'wide');

  readonly model = specModel(this.data);
  /** `loading` only before the first answer; a reload keeps the page on screen. */
  readonly view = specView(this.data);

  /**
   * Spec 025 (T29, ISC-164.1): the overlaps of this spec, both sides of each pair (core puts the warning on the
   * waiting spec's dashboard row only). Beside the head from 1120 px they show as a short form with an anchor on the
   * head's line; below, the full line repeats here. The spec model's own overlap warning is left to this block.
   */
  readonly overlaps = computed(() => {
    const dashboard = this.data.dashboard.value();
    const id = this.model()?.head.id ?? this.state.specId() ?? '';
    return overlapLines(overlapsIn(dashboard?.kind === 'ok' ? dashboard.body : null), id);
  });
  readonly ws = computed(() => this.state.ws() ?? '');
  readonly contextWarnings = computed(() => (this.model()?.warnings ?? []).filter((warning) => warning.kind !== 'spec-overlap'));

  /** `/w/:ws/s/:id/<tab>` as a router link array, or its path string for `ui-kpi-tile`'s `href`. */
  link(tab = ''): string[] {
    return specTabLink(this.state, tab);
  }
  href(tab: string): string {
    return this.link(tab).join('/');
  }

  readonly claimsRatio = claimsRatio(this.model);

  /** One meter segment per gate, coloured by its state as the model reports it. */
  readonly gateSegments = computed<readonly MeterSegment[]>(() => {
    const gates = this.model()?.gates;
    return gates ? GATE_NAMES.map((name) => ({ key: name, count: 1, tone: GATE_TONE[gates[name].state] })) : [];
  });

  /** At most three reasons (design.md § Next step); shown only where the guidance names no entry for the spec. */
  readonly reasons = computed(() => this.model()?.next.reasons.slice(0, 3) ?? []);

  /**
   * Spec 020 (T19, ISC-239, ISC-237.1): the spec's own guidance entry, whose catalogue sentence stands in the next-step
   * card as it does on every other surface; null without guidance or without an open item (the reasons stay then).
   */
  readonly entry = computed(() => {
    const m = this.model();
    return guidanceEntryOf(m?.guidance, m?.head.id);
  });
  /** The spec's entries in "Waits on you", in core's order (ISC-237). */
  readonly waits = computed(() => this.model()?.guidance?.waits ?? []);
  /** Whether the spec itself waits on the principal: the marker beside the guide's eyebrow. */
  readonly selfWaits = computed(() => {
    const own = this.entry();
    return own !== null && this.waits().includes(own);
  });
  /** The spec's other waiting entries (claims, tasks, questions): the guide lists them under its own step. */
  readonly alsoWaiting = computed(() => {
    const own = this.entry();
    return this.waits().filter((entry) => entry !== own);
  });

  private readonly track = stageTrack(this.transloco, this.lang, this.model);
  readonly stageLabels = this.track.labels;
  readonly stageCurrent = this.track.current;
  readonly stageAria = this.track.aria;

  readonly tiles = computed<readonly AreaTile[]>(() => {
    const model = this.model();
    if (model === null) return [];
    this.lang();
    const t = (key: string, params?: Readonly<Record<string, unknown>>): string => this.transloco.translate(key, params);
    return TILE_AREAS.map(({ id, key }) => {
      const area = areaById(id);
      const lock = id === 'live' ? model.areas.live.lock : null;
      return {
        id,
        link: this.link(areaPath(area)),
        hint: `g ${key}`,
        lines: tileLines(model, id, t).map(([line, params]) => t(line, params)),
        ...(lock ? { mono: lock.session } : {}),
      };
    });
  });

  /** The spec's slice of `specs/tldr.md` in the Brief's shape; null when no TL;DR item names this spec. */
  readonly brief = specBrief(this.model);

  reload(): void {
    this.data.spec.reload();
  }
}
