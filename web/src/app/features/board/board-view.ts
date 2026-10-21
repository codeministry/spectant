import type { WorkflowStage } from '../../../../../core/src/files';
import { isWorkflowStage, WAITING_STAGES } from '../../../../../core/src/stage';
import { FIXED_GATES } from '../../../../../core/src/workflow';
import type { BandDivider, BandPlace, BoardCard, BoardModel } from '../../core/model/board-types';
import { type BoardQueryState, boardQueryParams } from '../../core/model/board-query';
import { writePathsOf } from '../../../../../server/src/contracts/writes.contract';
import { beforeFor, type Target } from '../../core/model/backlog-order';
import type { FeatureGroup } from '../../core/model/feature-order';
import type { IconName } from '../../shared/icons/icons';

/*
 * The pure parts of the workspace board (spec 061): the router params of a board query, the band shapes the template
 * renders and the small lookups it calls. No Angular DI here; `BoardStore`, `BoardPage` and the board's parts import them.
 */

/** Every key the board query owns: a navigation clears the ones the next query leaves out and keeps any other param. */
const QUERY_KEYS = ['feature', 'milestone', 'type', 'assignee', 'group', 'col', 'q', 'open', 'fold'] as const;

/**
 * The router `queryParams` that turn the URL's board query into `query`: its non-default keys, and null (removed) for
 * every board key it leaves at its default, so a merge keeps foreign params and drops stale board ones.
 */
export function boardNavigationParams(query: BoardQueryState): Record<string, string | string[] | null> {
  const params: Record<string, string | string[] | null> = Object.fromEntries(QUERY_KEYS.map((key) => [key, null]));
  return { ...params, ...boardQueryParams(query) };
}

/** One glyph per workflow stage for the column head and the stub (design 008 § board). */
export const STAGE_GLYPHS: Readonly<Record<WorkflowStage, IconName>> = {
  idea: 'lightbulb',
  plan: 'list',
  tasks: 'list-checks',
  review: 'eye',
  build: 'hammer',
  blocked: 'octagon-x',
  'close-pending': 'hourglass',
  'code-review': 'git-pull-request',
  close: 'check-check',
  done: 'circle-check',
};

/**
 * The gate text of the fixed gates the board marks (design 008: review "reviewed mark", done "every claim closed").
 * Core's `FIXED_GATES` also names `build`, which every row keeps but which no mark guards; it gets no `<dfn>`.
 */
const GATE_TEXT: Partial<Record<WorkflowStage, string>> = {
  review: 'board.workspace.column.gateReviewed',
  done: 'board.workspace.column.gateClosed',
};
export const gateOf = (stage: WorkflowStage): string | null => (FIXED_GATES.includes(stage) ? (GATE_TEXT[stage] ?? null) : null);

const WAITING: ReadonlySet<string> = WAITING_STAGES;
/** The waiting stages that wait on another spec, not on you (spec 020, T24): their heads keep the hourglass. */
const WAITS_ON_OTHERS: ReadonlySet<string> = new Set(['blocked', 'close-pending']);

/** A waiting stage: its head shows the hourglass unless it waits on you. */
export const waiting = (stage: WorkflowStage): boolean => WAITING.has(stage);
/** A waiting stage that waits on you, not on another spec (spec 020, T24): its head shows the ring of `open`. */
export const yours = (stage: WorkflowStage): boolean => WAITING.has(stage) && !WAITS_ON_OTHERS.has(stage);

/** Two stage sets hold the same stages: the measured set only changes (and re-renders) when a column crosses the edge. */
export const sameStages = (a: ReadonlySet<WorkflowStage>, b: ReadonlySet<WorkflowStage>): boolean => a.size === b.size && [...a].every((s) => b.has(s));

/** A swimlane's hint at medium (ISC-141.1): its text ("3 cards in Build and Done, right of view") and the first column to show. */
export interface LaneHint {
  readonly text: string;
  readonly stage: WorkflowStage;
}

export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What a band head shows, from a band across the board (medium, wide) or a band of the one column (compact). */
export type BandHead = Pick<BandRow, 'key' | 'label' | 'target' | 'count'>;

/**
 * A swimlane band across the whole board: its head and one cell per column, in column order. `row` is the grid row of
 * its head (its cells take the next one); `divider` is the milestone row above it, only between two move groups.
 */
export interface BandRow extends BandPlace {
  readonly key: string | null;
  readonly label: string | null;
  readonly target: string | null;
  readonly count: number;
  readonly row: number;
  readonly cells: ReadonlyArray<{ readonly stage: WorkflowStage; readonly stub: boolean; readonly cards: readonly BoardCard[] }>;
}

/** The divider a band shows: the model's, but never above the first band shown (spec 037, design § decision 6). */
export const dividerShown = (band: BandPlace, first: boolean): BandDivider | null => (first ? null : band.divider);

/**
 * The bands across the board in the model's lane order (spec 037, ISC-197: features by milestone, then rank; milestones
 * in target order), the one without last. Each head takes a grid row, its cells the next, and a divider one above it.
 */
export function bandsOf(b: BoardModel | null): readonly BandRow[] {
  if (b === null || b.query.group === 'none') return [];
  let row = 2;
  return b.lanes.flatMap((lane, i): BandRow[] => {
    const found = b.columns.flatMap((c) => c.bands.filter((band) => band.key === lane.key));
    const count = found.reduce((n, band) => n + band.count, 0);
    if (count === 0) return [];
    const divider = dividerShown(lane, i === 0);
    if (divider !== null) row += 1;
    const head = row;
    row += 2;
    return [
      {
        key: lane.key,
        moveGroup: lane.moveGroup,
        divider,
        row: head,
        label: found[0]?.label ?? null,
        target: found[0]?.target ?? null,
        count,
        cells: b.columns.map((c) => ({
          stage: c.stage,
          stub: c.folded,
          cards: c.bands.find((band) => band.key === lane.key)?.cards ?? [],
        })),
      },
    ];
  });
}

/** A swimlane's done cards, the mini meter's value (spec 024, design § Workspace board Desktop "mini bar"). */
export function bandDone(band: BandHead): number | null {
  if (!('cells' in band)) return null;
  const cells = (band as BandRow).cells;
  return cells.find((c) => c.stage === 'done')?.cards.length ?? 0;
}

/** The track of each column: a stub's fixed width, or the 232 px column. */
export const tracksOf = (b: BoardModel | null): string =>
  (b?.columns ?? []).map((c) => (c.folded ? 'var(--board-stub)' : 'minmax(var(--board-col), 1fr)')).join(' ');

/** A card's page: the idea page for a story, the spec page otherwise (the same target as the card title). */
export const cardLinkOf = (ws: string, card: BoardCard): string[] =>
  card.kind === 'idea' ? ['/w', ws, 'ideas', card.slug] : ['/w', ws, 's', card.id ?? card.slug];

/**
 * The stage Shift+← (`-1`) or Shift+→ (`1`) moves a card to (T127): the nearest of its targets (`card.targets`, core's
 * transition table) before or after its stage in the board's column order; null when there is none that way.
 */
export function stepTarget(card: Pick<BoardCard, 'stage' | 'targets'>, stages: readonly WorkflowStage[], dir: -1 | 1): WorkflowStage | null {
  const at = stages.indexOf(card.stage);
  if (at < 0) return null;
  const ahead = dir === 1 ? stages.slice(at + 1) : stages.slice(0, at).reverse();
  return ahead.find((stage) => card.targets.includes(stage)) ?? null;
}

/** A card the menu or the keyboard moved, and where to: the board follows it and focuses its grip. */
export interface MovedCard {
  readonly key: string;
  readonly to: WorkflowStage;
}

/**
 * The number part of the folder before it is written: core picks the next free number only when it allocates
 * (`allocationOf`), and the API offers no preview. The same placeholder the write contract's `WRITE_PATHS` uses.
 */
const NUMBER = 'NNN';

/** What the allocation of `card` touches, from `WRITE_PATHS.allocate` with the number left open (T128). */
export function allocPathsOf(card: BoardCard | null): { folder: string; files: string[]; story: string } {
  const slug = card?.slug ?? '';
  const paths = writePathsOf('allocate', `${NUMBER}-${slug}`, slug);
  const folder = paths.creates ?? '';
  return {
    folder,
    files: paths.writes.map((path) => (path.startsWith(folder) ? path.slice(folder.length) : path)),
    story: card?.path ?? paths.removes.join(', '),
  };
}

/**
 * The move a band drop at `y` would send over the band heads `all` and the head the drop line sits on (`data-band`,
 * '' for "No feature"), or null when the point lies over another move group or in a gap next to the band itself.
 */
export function bandTargetAt(all: readonly HTMLElement[], order: readonly FeatureGroup[], group: string, feature: string, y: number): { before: Target; line: string } | null {
  // The lifted band's placeholder (a clone of its head) holds its place, so the gaps count as `beforeFor` counts them.
  const under = all.filter((head) => head.getBoundingClientRect().top <= y).at(-1) ?? all.at(0);
  if (under?.dataset['moveGroup'] !== group) return null;
  const own = all.filter((head) => head.dataset['moveGroup'] === group);
  const gap = own.filter((head) => {
    const rect = head.getBoundingClientRect();
    return rect.top + rect.height / 2 < y;
  }).length;
  const before = beforeFor(order, group, feature, gap);
  if (before === 'none') return null;
  const lineHead = own.at(gap) ?? all.at(all.indexOf(own.at(-1) ?? under) + 1);
  return { before, line: lineHead?.dataset['band'] ?? '' };
}

/** The column sections of the scroller `el`, in column order. */
const sectionsOf = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>(':scope > .grid > section[data-col]')];

/**
 * The stages whose column lies right of the scroller box (ISC-141.1), a column head's left edge at or past the box's
 * right edge, and the first column in view.
 */
export function measureColumns(el: HTMLElement): { hidden: Set<WorkflowStage>; first: string | undefined } {
  const hidden = new Set<WorkflowStage>();
  let first: string | undefined;
  const box = el.getBoundingClientRect();
  const right = box.right - 1;
  for (const section of sectionsOf(el)) {
    const stage = section.dataset['col'];
    const head = section.querySelector<HTMLElement>(':scope > header') ?? section;
    const rect = head.getBoundingClientRect();
    if (stage !== undefined && isWorkflowStage(stage) && rect.left >= right) hidden.add(stage);
    if (first === undefined && stage !== undefined && rect.right > box.left + 24) first = stage;
  }
  return { hidden, first };
}

/** The column one back or on from the first column in view, measured against the scroller's start edge. */
export function stepColumnOf(el: HTMLElement, dir: 1 | -1): WorkflowStage | null {
  const start = el.getBoundingClientRect().left + 24;
  const sections = sectionsOf(el);
  const at = Math.max(0, sections.findIndex((s) => s.getBoundingClientRect().right > start));
  const stage = sections[Math.min(sections.length - 1, Math.max(0, at + dir))]?.dataset['col'];
  return stage !== undefined && isWorkflowStage(stage) ? stage : null;
}
