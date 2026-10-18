import { guidanceEntryOf } from '../../shared/ui/guidance/guidance-entry';
import type { ActorRef, Guidance, GuidanceReason, ItemStateInfo, Priority, SpecType, SpecWait, StageSource, Workflow, WorkflowStage, Worktree } from '../../../../../core/src/files';
import type { MilestoneState, PlanningHolder, PlanningModel } from '../../../../../core/src/planning';
import { allowedTransition, isWorkflowStage, reasonOf, storyStep, WAITING_STAGES, WORKFLOW_TYPES, workflowStagesOf } from '../../../../../core/src/stage';
import type { Stage } from '../../../../../core/src/stage';
import type { ActorMapping } from '../../../../../server/src/spec-routes.contract';
import { type FeatureGroup, featureOrder } from '../backlog/backlog-order';

/**
 * The workspace board's view model (spec 008, T120, ISC-129): pure functions from the planning tree, the dashboard rows
 * and the actor names to the columns, cards, swimlane bands and drop targets the board renders. Nothing here derives a
 * stage, a reason or a transition: the stage is the planning holder's (the dashboard row's), the reason and command are
 * the row's (core's `reasonOf` for a story), the counts are `stageCounts`, and a drop target is core's
 * `allowedTransition`. The board query (`?feature=…&milestone=…&type=…&assignee=…&group=…&col=…`) is parsed and
 * serialised here, so the router and the remembered `board-query` share one grammar.
 */

// ─── The query (ISC-129.1) ──────────────────────────────────────────────────────────────────────────────────────────

export const BOARD_GROUPS = ['none', 'feature', 'milestone'] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];

/** A card's type for the Type filter: a spec type, or `idea` for every story whatever its `type:`. */
export type BoardCardType = SpecType | 'idea';

/** The filter value for a card without a feature or a milestone, and for an unassigned card. */
export const NO_FEATURE = 'none';
export const NO_MILESTONE = 'none';
export const UNASSIGNED = 'unassigned';

/** The board's URL state: four filters (values OR'ed within a key, keys AND'ed), the swimlane group, `?col` and the folds. */
export interface BoardQueryState {
  /** Main feature ids (`F6`), or `none`. */
  readonly feature: readonly string[];
  /** Milestone names as written, or `none`. */
  readonly milestone: readonly string[];
  readonly type: readonly BoardCardType[];
  /** Actor ids (`u:…`, `a:…`), or `unassigned`. */
  readonly assignee: readonly string[];
  readonly group: BoardGroup;
  /** The visible column at compact; null for the default. */
  readonly col: WorkflowStage | null;
  /** Columns without a shown card the viewer opened (`?open=`); such a column is folded by default. */
  readonly open: readonly WorkflowStage[];
  /** Columns with cards the viewer folded (`?fold=`); such a column is open by default. */
  readonly fold: readonly WorkflowStage[];
  /** Free text over id, slug, title and feature (`?q=`, spec 024 toolbar search); absent when blank. */
  readonly q?: string;
}

export const EMPTY_BOARD_QUERY: BoardQueryState = { feature: [], milestone: [], type: [], assignee: [], group: 'none', col: null, open: [], fold: [] };

const LIST_KEYS = ['feature', 'milestone', 'type', 'assignee'] as const;
const CARD_TYPES: readonly BoardCardType[] = [...WORKFLOW_TYPES, 'idea'];
const isCardType = (value: string): value is BoardCardType => CARD_TYPES.some((t) => t === value);
const isGroup = (value: string): value is BoardGroup => BOARD_GROUPS.some((g) => g === value);

/** A query source: the router's query params (a value or a repeated key's array), a `URLSearchParams`, or its string. */
export type BoardQuerySource = Readonly<Record<string, unknown>> | URLSearchParams | string;

function valuesOf(source: BoardQuerySource, key: string): string[] {
  if (typeof source === 'string') return new URLSearchParams(source).getAll(key);
  if (source instanceof URLSearchParams) return source.getAll(key);
  const value = source[key];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Unique non-blank values in first-seen order. */
const distinct = (values: readonly string[]): string[] => [...new Set(values.filter((v) => v.trim() !== ''))];

/** The board query of a URL: unknown types, groups and columns and blank or repeated values are dropped. */
export function parseBoardQuery(source: BoardQuerySource): BoardQueryState {
  const group = valuesOf(source, 'group').find(isGroup) ?? 'none';
  const col = valuesOf(source, 'col').find(isWorkflowStage) ?? null;
  const q = valuesOf(source, 'q').map((v) => v.trim()).find((v) => v !== '');
  return {
    ...(q === undefined ? {} : { q }),
    feature: distinct(valuesOf(source, 'feature')),
    milestone: distinct(valuesOf(source, 'milestone')),
    type: distinct(valuesOf(source, 'type')).filter(isCardType),
    assignee: distinct(valuesOf(source, 'assignee')),
    group,
    col,
    open: distinct(valuesOf(source, 'open')).filter(isWorkflowStage),
    fold: distinct(valuesOf(source, 'fold')).filter(isWorkflowStage),
  };
}

/**
 * The query as router `queryParams`, defaults left out: a list key is an array, which the router writes as one repeated
 * key per value (so a value may hold any character, a comma included); `group: none` and `col: null` are absent.
 */
export function boardQueryParams(query: BoardQueryState): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {};
  for (const key of LIST_KEYS) {
    const values = distinct(query[key]);
    if (values.length > 0) params[key] = values;
  }
  if (query.group !== 'none') params['group'] = query.group;
  if (query.col !== null) params['col'] = query.col;
  if (query.q !== undefined && query.q.trim() !== '') params['q'] = query.q.trim();
  for (const key of ['open', 'fold'] as const) {
    const stages = distinct(query[key]);
    if (stages.length > 0) params[key] = stages;
  }
  return params;
}

/** The query as the string `board-query` stores (without `?`), keys in a fixed order; `''` for the defaults. */
export function boardQueryString(query: BoardQueryState): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(boardQueryParams(query))) {
    for (const v of typeof value === 'string' ? [value] : value) search.append(key, v);
  }
  return search.toString();
}

/** How many filter values are set; the group and the column are not filters. */
export const activeFilterCount = (query: BoardQueryState): number =>
  LIST_KEYS.reduce((n, key) => n + query[key].length, 0) + (query.q !== undefined && query.q.trim() !== '' ? 1 : 0);

// ─── The input ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The fields of a dashboard row (`DashboardSpecRow`, `core/src/dashboard.ts`) the board reads, re-declared structurally
 * for the reason `dashboard-view.ts` gives: a served row is assignable to it.
 */
export interface BoardRow {
  readonly id: string;
  /** The folder name `NNN-slug`, the key it shares with the planning holder. */
  readonly slug: string;
  readonly title: string;
  readonly type: SpecType | null;
  readonly priority: Priority;
  readonly stage: Stage;
  readonly stageSource: StageSource;
  readonly nextCommand: string | null;
  /** The one phrase of the row (`reasonOf` in core). */
  readonly nextReason: string;
  readonly assignee: ActorRef | null;
  /** The spec's worktree with its chip's facts (spec 027, ISC-175); null or absent without one, and then no chip. */
  readonly worktree?: Worktree | null;
  /** The row's warnings; only `worktree-branch-mismatch` is read here, for the chip's warning tone (ISC-174.1). */
  readonly warnings?: ReadonlyArray<{ readonly kind: string }>;
  /** What the spec waits on (spec 025, ISC-163); null or absent when no open spec edge holds its open work. */
  readonly waits?: SpecWait | null;
  /** The spec's item state (spec 040, ISC-224); absent when the server read it without a clock. */
  readonly state?: ItemStateInfo | null;
}

/** The row's worktree warning, which turns the card's worktree chip to the warning tone (spec 027, ISC-174.1). */
const WORKTREE_MISMATCH = 'worktree-branch-mismatch';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/**
 * The active rows of a served dashboard body (`DashboardModel.specs`, untyped in web, see `DashboardBody`) as
 * `BoardRow`s: a served row is assignable to it, so the rows are passed through as they are, never reshaped. Only a
 * row without its `id` and `slug` strings is left out; anything but a body with a `specs` array reads as no rows.
 */
export function boardRowsOf(body: unknown): readonly BoardRow[] {
  const specs = isRecord(body) ? body['specs'] : null;
  if (!Array.isArray(specs)) return [];
  return specs.filter((row): row is BoardRow => isRecord(row) && typeof row['id'] === 'string' && typeof row['slug'] === 'string');
}

export interface BoardInput {
  readonly planning: PlanningModel;
  /** The dashboard rows of the same workspace: the type, reason and command a planning holder does not carry. */
  readonly rows: readonly BoardRow[];
  /** `DashboardModel.guidance` of the same workspace (spec 020); absent from a server without a clock. */
  readonly guidance?: Guidance;
  /** `GET /api/actors`: the display names of persons. */
  readonly actors?: ReadonlyArray<Pick<ActorMapping, 'id' | 'displayName'>>;
  readonly query?: BoardQueryState;
}

// ─── The model ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BoardCard {
  /** `spec:NNN-slug` or `idea:<slug>`, unique on the board. */
  readonly key: string;
  readonly kind: 'spec' | 'idea';
  /** `NNN` for a spec; null for an idea, which shows its chip in place of a number. */
  readonly id: string | null;
  /** The folder name for a spec, the story slug for an idea. */
  readonly slug: string;
  readonly type: SpecType | null;
  readonly title: string;
  readonly priority: Priority;
  readonly stage: WorkflowStage;
  /** The row's stage source; null for an idea. */
  readonly stageSource: StageSource | null;
  /** The main feature `F<n>`: the block whose holder entry is `main`, or the story's `feature:`. */
  readonly feature: string | null;
  /** That feature's name in the master; null when the master has no such block. */
  readonly featureName: string | null;
  /** The milestone whose spec list names the spec, or the story's `milestone:`. */
  readonly milestone: string | null;
  readonly assignee: ActorRef | null;
  /** A person's mapped display name; null for an agent, a legacy value or an unmapped id (the chip shows the raw id). */
  readonly assigneeName: string | null;
  /** The row's one phrase; for an idea the story row's; null when the caller passed no row for the spec. */
  readonly reason: string | null;
  /**
   * The spec's own guidance reason (spec 020, ISC-237.1): the card reads its catalogue sentence in place of `reason`;
   * null or absent for an idea, or when the guidance names no entry for the spec.
   */
  readonly guidance?: GuidanceReason | null;
  /** The row's command, e.g. `/spec-review 005`; null where the row names none. */
  readonly command: string | null;
  /** The stage is one core's `WAITING_STAGES` holds: the card shows its reason line. */
  readonly waiting: boolean;
  /** Waits on the principal: a waiting stage whose row has a command, other than the waits on a spec or a claim. */
  readonly waitsOnYou: boolean;
  /** The raw sha256 of spec.md the transition sends back; null for an idea and where the server hashed none. */
  readonly hash: string | null;
  /** The story file for an idea (`specs/ideas/<slug>.md`); null for a spec. */
  readonly path: string | null;
  /** The columns a drop may target (`dropTargetsOf`). */
  readonly targets: readonly WorkflowStage[];
  /** The row's worktree, shown as the compact chip in the assignee row (spec 027, ISC-175); null for an idea. */
  readonly worktree: Worktree | null;
  /** The row carries a `worktree-branch-mismatch` warning: the chip takes the warning tone (ISC-174.1). */
  readonly worktreeMismatch: boolean;
  /**
   * What the spec waits on (spec 025, T23, ISC-163): the holder's `waits`, else the row's; null for an idea and when no
   * open spec edge holds the spec's open work. The card shows `waits on NNN` in its own line under the title.
   */
  readonly waits: SpecWait | null;
  /** The titles of the blocker specs the board knows, by `NNN`, for the chip's accessible name. */
  readonly waitTitles: Readonly<Record<string, string>>;
  /**
   * The item's state as the API serves it (spec 040, T48, ISC-224): the dashboard row's `state` for a spec, the planning
   * story's for an idea; null where the server sent none (no clock), and the card then keeps the reason line.
   */
  readonly state: ItemStateInfo | null;
}

/** A column's stub at medium and wide: empty (with the cards the filters hide), or its card and waiting counts. */
export type BoardStub =
  | { readonly kind: 'empty'; readonly hidden: number }
  | { readonly kind: 'cards'; readonly cards: number; readonly waitingOnYou: number };

/**
 * The quiet row heading the run of feature bands of one move group (spec 037, ISC-197): "⚑ <name> · <target>". `key`
 * is the `FeatureGroup` key (`milestone:<slug>`, or `group` for the "No milestone" group, whose name and target are null).
 */
export interface BandDivider {
  readonly key: string;
  readonly name: string | null;
  readonly target: string | null;
}

/** Where a band stands in the feature order (spec 037, ISC-197): the area it moves in and the divider above it. */
export interface BandPlace {
  /**
   * The `FeatureGroup` key of the area a feature band moves in (`milestone:<slug>`, or `group`); a drop or an Alt+↑/↓
   * keeps it inside that area (ISC-195.1). Null for the band without a feature and for every milestone band.
   */
  readonly moveGroup: string | null;
  /**
   * Set on the first band of each move group when the bands it is counted over (one column's, or the board's lanes)
   * span more than one move group; null otherwise, and always on the band without a feature and on milestone bands.
   */
  readonly divider: BandDivider | null;
}

/** One swimlane band of a column. `key` null is the band without a feature or milestone, always last. */
export interface BoardBand extends BandPlace {
  readonly key: string | null;
  /** The feature's name or the milestone's name; null for the band without one. */
  readonly label: string | null;
  /** A milestone band's target date and state; null otherwise and for a name the master does not list. */
  readonly target: string | null;
  readonly state: MilestoneState | null;
  readonly count: number;
  readonly cards: readonly BoardCard[];
}

export interface BoardColumn {
  readonly stage: WorkflowStage;
  /** `stageCounts[stage]`, the unfiltered count. */
  readonly count: number;
  /** The cards the filters let through, in board order. */
  readonly cards: readonly BoardCard[];
  /** Cards of this stage the filters hide. */
  readonly hidden: number;
  readonly waitingOnYou: number;
  /** Shown cards whose item state is `running` (spec 040, T48): a folded column's stub says "1 running" so no run hides. */
  readonly running: number;
  readonly stub: BoardStub;
  /**
   * Drawn as a narrow stub at medium and wide: a column without a shown card unless the viewer opened it, a column with
   * cards only when the viewer folded it.
   */
  readonly folded: boolean;
  /** The bands holding a card of this column, empty without a group. */
  readonly bands: readonly BoardBand[];
  /** Features (or milestones) of the master with no card in this column: "4 features have no card in Build". */
  readonly bandsOmitted: number;
}

export interface BoardFilterOptions {
  /** Every feature block, in master order. */
  readonly features: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** The master's milestones in target order, then names only cards carry. */
  readonly milestones: readonly string[];
  /** The types the cards carry, in workflow table order, `idea` last. */
  readonly types: readonly BoardCardType[];
  /** The assignees the cards carry, by id. */
  readonly assignees: ReadonlyArray<{ readonly ref: ActorRef; readonly name: string | null }>;
}

export interface BoardModel {
  readonly stages: readonly WorkflowStage[];
  readonly columns: readonly BoardColumn[];
  /**
   * The swimlanes across the board in band order: every band key a column holds, with its move group and its divider
   * counted over all of them (spec 037, ISC-197). Empty without a group.
   */
  readonly lanes: readonly BoardLane[];
  /** Every card on the board, unfiltered, in column then card order. */
  readonly cards: readonly BoardCard[];
  /** The visible column at compact: `?col`, else `build` with cards, else the first column with cards, else the first. */
  readonly current: WorkflowStage | null;
  readonly query: BoardQueryState;
  readonly activeFilters: number;
  /** Cards on the board, specs and ideas counted apart, and how many the filters let through. */
  readonly total: number;
  readonly specs: number;
  readonly ideas: number;
  readonly shown: number;
  /** Shown cards that wait on the principal. */
  readonly waitingOnYou: number;
  readonly options: BoardFilterOptions;
}

/** A swimlane across the whole board: its band key and its place in the feature order. */
export interface BoardLane extends BandPlace {
  readonly key: string | null;
}

/** Waiting stages whose wait is on another spec or on a claim, never on the principal (design § card edge). */
const WAITS_ON_OTHERS: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>(['blocked', 'close-pending']);

/**
 * The columns a card may be dropped on, from core's transition table by the card's type: for a spec every column
 * `allowedTransition` admits from its stage; for an idea the first stage of its type's row (the allocation). An untyped
 * card has no row and no target. Core still decides every drop; these are hints and the set the board offers.
 */
export function dropTargetsOf(
  card: Pick<BoardCard, 'kind' | 'type' | 'stage'>,
  workflow: Workflow,
  stages: readonly WorkflowStage[],
): readonly WorkflowStage[] {
  const type = card.type;
  if (type === null) return [];
  if (card.kind === 'idea') {
    const first = workflowStagesOf(type, workflow)[0];
    return stages.filter((stage) => stage === first);
  }
  return stages.filter((stage) => stage !== card.stage && allowedTransition(card.stage, stage, type, workflow));
}

const PRIORITY_RANK: Readonly<Record<Priority, number>> = { P1: 1, P2: 2, P3: 3, P4: 4 };

/** Board order within a column: priority first, specs before ideas, then number or slug. */
const byBoardOrder = (a: BoardCard, b: BoardCard): number =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  (a.kind === b.kind ? 0 : a.kind === 'spec' ? -1 : 1) ||
  (a.id ?? a.slug).localeCompare(b.id ?? b.slug);

/** The four filter keys of the board query, in toolbar order. */
export type BoardFilterKey = (typeof LIST_KEYS)[number];
export const BOARD_FILTER_KEYS: readonly BoardFilterKey[] = LIST_KEYS;

/** A card's value for one filter key, as the filter compares it: `none` / `unassigned` where the card has none. */
export function cardFilterValue(card: Pick<BoardCard, 'kind' | 'type' | 'feature' | 'milestone' | 'assignee'>, key: BoardFilterKey): string {
  switch (key) {
    case 'feature':
      return card.feature ?? NO_FEATURE;
    case 'milestone':
      return card.milestone ?? NO_MILESTONE;
    case 'type':
      return card.kind === 'idea' ? 'idea' : (card.type ?? '');
    case 'assignee':
      return card.assignee?.id ?? UNASSIGNED;
  }
}

/** The search's match: every word of `q` in the card's id, slug, title, feature or feature name, case-insensitive. */
function found(card: BoardCard, q: string | undefined): boolean {
  const words = (q ?? '').toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const text = [card.id ?? '', card.slug, card.title, card.feature ?? '', card.featureName ?? ''].join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
}

function passes(card: BoardCard, query: BoardQueryState): boolean {
  if (!found(card, query.q)) return false;
  return LIST_KEYS.every((key) => query[key].length === 0 || (query[key] as readonly string[]).includes(cardFilterValue(card, key)));
}

/** A card's wait and the titles of those blockers the board knows (spec 025, T23); a non-waiting card carries null. */
function waitsOf(waits: SpecWait | null, titleOf: ReadonlyMap<string, string>): Pick<BoardCard, 'waits' | 'waitTitles'> {
  const live = waits !== null && waits.blockers.length > 0 ? waits : null;
  const titles = (live?.blockers ?? []).flatMap((id) => {
    const title = titleOf.get(id);
    return title === undefined ? [] : [[id, title] as const];
  });
  return { waits: live, waitTitles: Object.fromEntries(titles) };
}

/** The board of one workspace. */
export function buildBoard(input: BoardInput): BoardModel {
  const { planning } = input;
  const query = input.query ?? EMPTY_BOARD_QUERY;
  const stages = planning.stages;
  const names = new Map((input.actors ?? []).map((a) => [a.id, a.displayName]));
  const featureNames = new Map(planning.features.map((f) => [f.id, f.name]));
  const rows = new Map(input.rows.map((r) => [r.slug, r]));
  const nameOf = (actor: ActorRef | null): string | null => (actor?.kind === 'person' ? (names.get(actor.id) ?? null) : null);

  // One holder per active spec: its main feature's entry wins, then the first feature listing it, then a milestone's.
  const holders = new Map<string, { holder: PlanningHolder; feature: string | null }>();
  for (const feature of planning.features) {
    for (const holder of feature.holders) {
      if (holder.archived) continue;
      const known = holders.get(holder.slug);
      if (known === undefined || (holder.main && known.feature === null)) holders.set(holder.slug, { holder, feature: holder.main ? feature.id : null });
    }
  }
  for (const milestone of planning.milestones) {
    for (const holder of milestone.specs) if (!holder.archived && !holders.has(holder.slug)) holders.set(holder.slug, { holder, feature: null });
  }
  const milestoneOf = new Map<string, string>();
  for (const milestone of planning.milestones) for (const spec of milestone.specs) if (!milestoneOf.has(spec.slug)) milestoneOf.set(spec.slug, milestone.name);
  // The blocker titles a waiting card names (spec 025, T23): every spec the board knows, holder or row, by `NNN`.
  const titleOf = new Map<string, string>([...input.rows.map((r) => [r.id, r.title] as const), ...[...holders.values()].map(({ holder }) => [holder.id, holder.title] as const)]);

  const onBoard = new Set(stages);
  const specCards: BoardCard[] = [];
  for (const slug of new Set([...holders.keys(), ...rows.keys()])) {
    const entry = holders.get(slug);
    const row = rows.get(slug);
    const stage = entry?.holder.stage ?? row?.stage ?? null;
    if (stage === null || !onBoard.has(stage)) continue; // counted nowhere, as `stageCounts` counts it
    const assignee = entry?.holder.assignee ?? row?.assignee ?? null;
    const feature = entry?.feature ?? null;
    const command = row?.nextCommand ?? null;
    const base = { kind: 'spec' as const, type: row?.type ?? null, stage };
    specCards.push({
      key: `spec:${slug}`,
      ...base,
      id: entry?.holder.id ?? row?.id ?? slug,
      slug,
      title: entry?.holder.title ?? row?.title ?? slug,
      priority: entry?.holder.priority ?? row?.priority ?? 'P3',
      stageSource: entry?.holder.stageSource ?? row?.stageSource ?? null,
      feature,
      featureName: feature === null ? null : (featureNames.get(feature) ?? null),
      milestone: milestoneOf.get(slug) ?? null,
      assignee,
      assigneeName: nameOf(assignee),
      reason: row?.nextReason ?? null,
      guidance: guidanceEntryOf(input.guidance, entry?.holder.id ?? row?.id)?.reason ?? null,
      command,
      waiting: WAITING_STAGES.has(stage),
      waitsOnYou: WAITING_STAGES.has(stage) && !WAITS_ON_OTHERS.has(stage) && command !== null,
      hash: entry?.holder.hash ?? null,
      path: null,
      targets: dropTargetsOf(base, planning.workflow, stages),
      worktree: row?.worktree ?? null,
      worktreeMismatch: row?.warnings?.some((w) => w.kind === WORKTREE_MISMATCH) ?? false,
      ...waitsOf(entry?.holder.waits ?? row?.waits ?? null, titleOf),
      state: row?.state ?? null,
    });
  }
  const ideaCards: BoardCard[] = onBoard.has('idea')
    ? planning.ideas.map((idea): BoardCard => {
        const step = storyStep(idea.slug);
        const base = { kind: 'idea' as const, type: idea.type, stage: 'idea' as const };
        return {
          key: `idea:${idea.slug}`,
          ...base,
          id: null,
          slug: idea.slug,
          title: idea.title,
          priority: idea.priority,
          stageSource: null,
          feature: idea.feature,
          featureName: idea.feature === null ? null : (featureNames.get(idea.feature) ?? null),
          milestone: idea.milestone,
          assignee: null,
          assigneeName: null,
          reason: reasonOf(step),
          command: step.command,
          waiting: false,
          waitsOnYou: false,
          hash: null,
          path: idea.path,
          targets: dropTargetsOf(base, planning.workflow, stages),
          worktree: null,
          worktreeMismatch: false,
          waits: null,
          waitTitles: {},
          state: idea.state ?? null,
        };
      })
    : [];

  const all = [...specCards, ...ideaCards];
  const inStage = (stage: WorkflowStage): BoardCard[] => all.filter((c) => c.stage === stage).sort(byBoardOrder);
  const cards = stages.flatMap(inStage);

  // Milestone band order: the master's (target ascending), then names only cards carry, in first-seen order.
  const milestoneOrder = [...planning.milestones.map((m) => m.name)];
  for (const c of cards) if (c.milestone !== null && !milestoneOrder.includes(c.milestone)) milestoneOrder.push(c.milestone);
  const milestoneByName = new Map(planning.milestones.map((m) => [m.name, m]));

  // Feature band order (spec 037, T12, ISC-197): the milestones of `featureOrder`, each one's features in rank (a feature
  // two milestones list stands under the first only), then the "No milestone" group; the band without a feature last.
  const moveGroupOf = new Map<string, FeatureGroup>();
  for (const group of featureOrder(planning)) for (const id of group.ids) if (featureNames.has(id) && !moveGroupOf.has(id)) moveGroupOf.set(id, group);
  const bandOrder: Array<string | null> = query.group === 'feature' ? [...moveGroupOf.keys(), null] : [...milestoneOrder, null];
  const groupOfBand = (key: string | null): FeatureGroup | undefined => (query.group === 'feature' && key !== null ? moveGroupOf.get(key) : undefined);
  // Each band's move group, and a divider over the first band of each move group when the bands span more than one.
  const placed = <T extends { readonly key: string | null }>(slots: readonly T[]): Array<T & BandPlace> => {
    const spanned = new Set(slots.map((slot) => groupOfBand(slot.key)?.key).filter((key) => key !== undefined));
    return slots.map((slot, i) => {
      const group = groupOfBand(slot.key);
      const opens = group !== undefined && spanned.size > 1 && (i === 0 || groupOfBand(slots[i - 1]?.key ?? null) !== group);
      return { ...slot, moveGroup: group?.key ?? null, divider: opens ? { key: group.key, name: group.name, target: group.target } : null };
    });
  };

  const bandsOf = (shown: readonly BoardCard[]): { bands: BoardBand[]; omitted: number } => {
    if (query.group === 'none') return { bands: [], omitted: 0 };
    const keyOf = (c: BoardCard): string | null => (query.group === 'feature' ? c.feature : c.milestone);
    const bands = placed(
      bandOrder.flatMap((key): Array<Omit<BoardBand, keyof BandPlace>> => {
        const members = shown.filter((c) => keyOf(c) === key);
        if (members.length === 0) return [];
        const milestone = key === null || query.group !== 'milestone' ? undefined : milestoneByName.get(key);
        const label = key === null ? null : query.group === 'feature' ? (featureNames.get(key) ?? key) : key;
        return [{ key, label, target: milestone?.target ?? null, state: milestone?.state ?? null, count: members.length, cards: members }];
      }),
    );
    const listed = query.group === 'feature' ? planning.features.length : planning.milestones.length;
    const shownListed = bands.filter((b) => b.key !== null && (query.group === 'feature' ? featureNames.has(b.key) : milestoneByName.has(b.key))).length;
    return { bands, omitted: listed - shownListed };
  };

  const columns = stages.map((stage): BoardColumn => {
    const every = cards.filter((c) => c.stage === stage);
    const shown = every.filter((c) => passes(c, query));
    const waitingOnYou = shown.filter((c) => c.waitsOnYou).length;
    const hidden = every.length - shown.length;
    const { bands, omitted } = bandsOf(shown);
    return {
      stage,
      count: planning.stageCounts[stage] ?? 0,
      cards: shown,
      hidden,
      waitingOnYou,
      running: shown.filter((c) => c.state?.state === 'running').length,
      stub: shown.length === 0 ? { kind: 'empty', hidden } : { kind: 'cards', cards: shown.length, waitingOnYou },
      folded: shown.length === 0 ? !query.open.includes(stage) : query.fold.includes(stage),
      bands,
      bandsOmitted: omitted,
    };
  });

  const nonEmpty = (stage: WorkflowStage): boolean => (columns.find((c) => c.stage === stage)?.cards.length ?? 0) > 0;
  const current =
    query.col !== null && onBoard.has(query.col)
      ? query.col
      : onBoard.has('build') && nonEmpty('build')
        ? 'build'
        : (stages.find(nonEmpty) ?? stages.at(0) ?? null);

  const assignees = new Map<string, ActorRef>();
  for (const c of cards) if (c.assignee !== null && !assignees.has(c.assignee.id)) assignees.set(c.assignee.id, c.assignee);
  const types = new Set(cards.map((c): BoardCardType | null => (c.kind === 'idea' ? 'idea' : c.type)));

  const lanes: BoardLane[] = placed(bandOrder.filter((key) => columns.some((c) => c.bands.some((band) => band.key === key))).map((key) => ({ key })));

  return {
    stages,
    columns,
    lanes,
    cards,
    current,
    query,
    activeFilters: activeFilterCount(query),
    total: cards.length,
    specs: cards.filter((c) => c.kind === 'spec').length,
    ideas: cards.filter((c) => c.kind === 'idea').length,
    shown: columns.reduce((n, c) => n + c.cards.length, 0),
    waitingOnYou: columns.reduce((n, c) => n + c.waitingOnYou, 0),
    options: {
      features: planning.features.map((f) => ({ id: f.id, name: f.name })),
      milestones: milestoneOrder,
      types: CARD_TYPES.filter((t) => types.has(t)),
      assignees: [...assignees.values()].sort((a, b) => a.id.localeCompare(b.id)).map((ref) => ({ ref, name: nameOf(ref) })),
    },
  };
}

// ─── The summary (T116) ─────────────────────────────────────────────────────────────────────────────────────────────

/** The workspace area menu's Board line, "n stages · m cards · k wait on you" (`shell.pages.summary.board`). */
export interface BoardSummary {
  readonly stages: number;
  readonly cards: number;
  readonly waiting: number;
}

/**
 * The summary of a board as `buildBoard` built it, so the menu line and the page count the same cards: its columns,
 * every card on it and every card waiting on the principal, whatever the model's filters let through.
 */
export const boardSummaryOf = (model: BoardModel): BoardSummary => ({
  stages: model.stages.length,
  cards: model.total,
  waiting: model.cards.filter((card) => card.waitsOnYou).length,
});

// ─── Hidden columns at medium (spec 019, T29, ISC-141.1) ────────────────────────────────────────────────────────────

/**
 * What the overflow reads of a column: its stage, its shown cards (only their number) and its swimlane bands. A
 * `BoardColumn` is assignable to it.
 */
export interface OverflowColumn {
  readonly stage: WorkflowStage;
  readonly cards: ArrayLike<unknown>;
  readonly bands: ReadonlyArray<Pick<BoardBand, 'key' | 'count'>>;
}

/** A column out of view and the cards it holds: the whole column's shown cards, or one lane's. */
export interface HiddenColumn {
  readonly stage: WorkflowStage;
  readonly count: number;
}

/** A swimlane whose cards all lie out of view: its band key, its card count and the hidden columns holding them. */
export interface HiddenLane {
  /** The band key (`F<n>`, a milestone name), or null for the band without one. */
  readonly key: string | null;
  /** The lane's shown cards, all of them in `columns`. */
  readonly count: number;
  /** The hidden columns that hold a card of the lane, in column order, each with the lane's cards there. */
  readonly columns: readonly HiddenColumn[];
}

/**
 * The overflow line's entries ("Right out of view: Build 2 · Done 1"): every column in `hidden` that holds a shown card,
 * in column order, with its shown card count. A column without a shown card (an empty column or an empty stub) hides
 * nothing and is left out; a folded column with cards counts. `hidden` holds the stages the page measured right of
 * the scroller box (a column head's left edge at or past the box's right edge).
 */
export function hiddenColumnsOf(columns: readonly OverflowColumn[], hidden: ReadonlySet<WorkflowStage>): readonly HiddenColumn[] {
  return columns.filter((c) => hidden.has(c.stage) && c.cards.length > 0).map((c) => ({ stage: c.stage, count: c.cards.length }));
}

/**
 * The swimlane hints ("2 cards in Build, Close-pending, right out of view"), keyed by band key: every lane that holds a
 * shown card and has all of them in `hidden` columns. A lane with one card in view is absent, and so is every lane on a
 * board without swimlanes (its columns carry no bands).
 */
export function hiddenLanesOf(columns: readonly OverflowColumn[], hidden: ReadonlySet<WorkflowStage>): ReadonlyMap<string | null, HiddenLane> {
  const lanes = new Map<string | null, { inView: boolean; columns: HiddenColumn[] }>();
  for (const column of columns) {
    for (const band of column.bands) {
      if (band.count === 0) continue;
      const lane = lanes.get(band.key) ?? { inView: false, columns: [] };
      if (hidden.has(column.stage)) lane.columns.push({ stage: column.stage, count: band.count });
      else lane.inView = true;
      lanes.set(band.key, lane);
    }
  }
  const found = new Map<string | null, HiddenLane>();
  for (const [key, lane] of lanes) {
    if (lane.inView || lane.columns.length === 0) continue;
    found.set(key, { key, count: lane.columns.reduce((n, c) => n + c.count, 0), columns: lane.columns });
  }
  return found;
}
