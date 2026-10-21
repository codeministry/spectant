import type { ActorRef, Priority, SpecWait, Workflow, WorkflowStage } from '../../../../../core/src/files';
import type { PlanningHolder } from '../../../../../core/src/planning';
import { allowedTransition, reasonOf, storyStep, WAITING_STAGES, workflowStagesOf } from '../../../../../core/src/stage';
import { allowedEntryMove } from '../../../../../core/src/transition';
import { guidanceEntryOf } from './guidance-entry';
import { type FeatureGroup, featureOrder } from './feature-order';
import {
  activeFilterCount,
  BOARD_FILTER_KEYS,
  type BoardCardType,
  type BoardFilterKey,
  type BoardQueryState,
  CARD_TYPES,
  EMPTY_BOARD_QUERY,
  NO_FEATURE,
  NO_MILESTONE,
  UNASSIGNED,
} from './board-query';
import type { BandPlace, BoardBand, BoardCard, BoardColumn, BoardInput, BoardLane, BoardModel } from './board-types';

/**
 * The workspace board's view model (spec 008, T120, ISC-129): pure functions from the planning tree, the dashboard rows
 * and the actor names to the columns, cards, swimlane bands and drop targets the board renders. Nothing here derives a
 * stage, a reason or a transition: the stage is the planning holder's (the dashboard row's), the reason and command are
 * the row's (core's `reasonOf` for a story), the counts are `stageCounts`, and a drop target is core's
 * `allowedTransition`. The board query (`?feature=…&milestone=…&type=…&assignee=…&group=…&col=…`) is parsed and
 * serialised here, so the router and the remembered `board-query` share one grammar.
 */

/** The row's worktree warning, which turns the card's worktree chip to the warning tone (spec 027, ISC-174.1). */
const WORKTREE_MISMATCH = 'worktree-branch-mismatch';

/** Waiting stages whose wait is on another spec or on a claim, never on the principal (design § card edge). */
const WAITS_ON_OTHERS: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>(['blocked', 'close-pending']);

/**
 * The columns a card may be dropped on, from core's transition table by the card's type: for a spec every column
 * `allowedTransition` admits from its stage, and from the allocation entry `plan` of a row without it every stage of the
 * row up to `review` (`allowedEntryMove`, spec 056); for an idea the first stage of its type's row (the allocation). An untyped
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
  return stages.filter(
    (stage) => stage !== card.stage && (allowedTransition(card.stage, stage, type, workflow) || allowedEntryMove(card.stage, stage, type, workflow)),
  );
}

const PRIORITY_RANK: Readonly<Record<Priority, number>> = { P1: 1, P2: 2, P3: 3, P4: 4 };

/** Board order within a column: priority first, specs before ideas, then number or slug. */
const byBoardOrder = (a: BoardCard, b: BoardCard): number =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  (a.kind === b.kind ? 0 : a.kind === 'spec' ? -1 : 1) ||
  (a.id ?? a.slug).localeCompare(b.id ?? b.slug);

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
  return BOARD_FILTER_KEYS.every((key) => query[key].length === 0 || (query[key] as readonly string[]).includes(cardFilterValue(card, key)));
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
      marked: input.guidance?.waits.some((e) => e.item === 'spec' && e.spec === (entry?.holder.id ?? row?.id)) ?? false,
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
