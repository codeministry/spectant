import type { ActorRef, Priority, SpecType, StageSource, Workflow, WorkflowStage } from '../../../../../core/src/files';
import type { MilestoneState, PlanningHolder, PlanningModel } from '../../../../../core/src/planning';
import { allowedTransition, isWorkflowStage, reasonOf, storyStep, WAITING_STAGES, WORKFLOW_TYPES, workflowStagesOf } from '../../../../../core/src/stage';
import type { Stage } from '../../../../../core/src/stage';
import type { ActorMapping } from '../../../../../server/src/spec-routes.contract';

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
  return {
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
export const activeFilterCount = (query: BoardQueryState): number => LIST_KEYS.reduce((n, key) => n + query[key].length, 0);

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
}

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
}

/** A column's stub at medium and wide: empty (with the cards the filters hide), or its card and waiting counts. */
export type BoardStub =
  | { readonly kind: 'empty'; readonly hidden: number }
  | { readonly kind: 'cards'; readonly cards: number; readonly waitingOnYou: number };

/** One swimlane band of a column. `key` null is the band without a feature or milestone, always last. */
export interface BoardBand {
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

function passes(card: BoardCard, query: BoardQueryState): boolean {
  return LIST_KEYS.every((key) => query[key].length === 0 || (query[key] as readonly string[]).includes(cardFilterValue(card, key)));
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
      command,
      waiting: WAITING_STAGES.has(stage),
      waitsOnYou: WAITING_STAGES.has(stage) && !WAITS_ON_OTHERS.has(stage) && command !== null,
      hash: entry?.holder.hash ?? null,
      path: null,
      targets: dropTargetsOf(base, planning.workflow, stages),
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

  const bandsOf = (shown: readonly BoardCard[]): { bands: BoardBand[]; omitted: number } => {
    if (query.group === 'none') return { bands: [], omitted: 0 };
    const keys: Array<string | null> = query.group === 'feature' ? [...planning.features.map((f) => f.id), null] : [...milestoneOrder, null];
    const keyOf = (c: BoardCard): string | null => (query.group === 'feature' ? c.feature : c.milestone);
    const bands = keys.flatMap((key): BoardBand[] => {
      const members = shown.filter((c) => keyOf(c) === key);
      if (members.length === 0) return [];
      const milestone = key === null || query.group !== 'milestone' ? undefined : milestoneByName.get(key);
      const label = key === null ? null : query.group === 'feature' ? (featureNames.get(key) ?? key) : key;
      return [{ key, label, target: milestone?.target ?? null, state: milestone?.state ?? null, count: members.length, cards: members }];
    });
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

  return {
    stages,
    columns,
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
