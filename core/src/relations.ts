// The relation index of the planning tree (spec 026, T1, the core seam): every object of the cascade milestone ›
// feature › spec › claim, plus the stories of `specs/ideas/`, as one flat table keyed by `<type>:<id>`, each entry with
// its parents, children and blockers. It is the one source the detail sidebar, the tree, the matrix and the diagram
// read, so no view derives the relations a second time; the server ships it inside `PlanningModel.relations`, no new
// route. The sidebar reads only the address (`?sel=<type>:<id>`) and looks the entry up here, so a reload shows the
// same sidebar without a side channel.
//
// `buildRelations` (T10) fills the table from the planning tree alone: pure, no I/O, no parser of its own and type-only
// imports, so the browser bundle may import it and the barrel exports it whole. `buildPlanning` calls it on every read
// with every spec folder and the master's `(after: …)` edges; nothing of it is stored.

import type { IdeaRef } from './files.ts';
import type { PlanningFeature, PlanningHolder, PlanningMilestone, PlanningModel } from './planning.ts';
import type { Stage } from './stage.ts';

/** The five kinds of object the index addresses; the type chip of the sidebar header. */
export type RelationType = 'milestone' | 'feature' | 'spec' | 'claim' | 'idea';

/**
 * The address of one object, `<type>:<id>`, as it stands in `?sel=` and as the index keys it. The id per type is the
 * one the planning model already uses, so a ref is never translated on the way:
 *
 * - `milestone:<slug>`: `Milestone.slug` (`milestoneSlug` in `milestones.ts`), the id of the `#m-<slug>` anchors, e.g.
 *   `milestone:v1-0`. The group of features without a milestone is a grouping of the views, not an object, and has
 *   no ref.
 * - `feature:<F-id>`: `FeatureBlock.id`, e.g. `feature:F25`.
 * - `spec:<NNN>`: `PlanningHolder.id`, the folder's numeric prefix, e.g. `spec:025`; archived folders too.
 * - `claim:<ISC-id>`: the claim id as the master writes it, leaves included, e.g. `claim:ISC-171` or `claim:ISC-100.1`.
 * - `idea:<slug>`: `IdeaRef.slug`, the story file name without `.md`.
 */
export type RelationRef = `${RelationType}:${string}`;

/** One object of the index: what the sidebar header shows and the three relation sections it lists. */
export interface Relation {
  /** The key this entry sits under, `<type>:<id>`. */
  readonly ref: RelationRef;
  readonly type: RelationType;
  /** The part of `ref` after the first `:`, the mono id of the header (`F25`, `025`, `ISC-171`, the slug). */
  readonly id: string;
  /** Milestone and feature name, spec `title`, claim text, story title. */
  readonly title: string;
  /**
   * Progress as the planning tree counts it, dropped claims in neither number: a milestone and a feature their closed
   * and total claims, a spec the claims it holds, a claim 1 of 1 when ticked and 0 of 1 when open. A story has no
   * claims of its own and counts 0 of 0, as the tree counts stories apart.
   */
  readonly closed: number;
  readonly total: number;
  /**
   * The objects one level up: a feature its milestone, a spec its features (main feature first), a claim its holding
   * spec and its feature, a story the feature and milestone it names. Empty for a milestone and for an object whose
   * parent is unknown. Every entry is a key of the same index.
   */
  readonly parents: readonly RelationRef[];
  /** The objects one level down, the inverse of `parents`, in the order the planning tree lists them. */
  readonly children: readonly RelationRef[];
  /**
   * What still holds this object back, open entries only: a claim's `(after: …)` claims, a spec's spec edges
   * (`after: NNN`, spec 025). Empty when nothing does, and for the types that carry no edges.
   */
  readonly blockers: readonly RelationRef[];
  /** A spec or claim held only in `specs/archive/`; absent for every other entry. */
  readonly archived?: boolean;
  /** An active spec's board stage, the planning holder's `stage`; absent for every other type, null without state. */
  readonly stage?: Stage | null;
}

/** The whole index, keyed by ref; every ref in a `parents`, `children` or `blockers` list is a key of it. */
export type RelationIndex = Readonly<Record<RelationRef, Relation>>;

/** A spec folder as the index lists it: the holder's id, title, archive flag and stage. */
export type RelationSpec = Pick<PlanningHolder, 'id' | 'title' | 'archived' | 'stage'>;

/** What the index is built from: the planning tree's three lists, plus what the tree itself does not carry. */
export interface RelationsInput {
  readonly features: readonly PlanningFeature[];
  readonly milestones: readonly PlanningMilestone[];
  readonly ideas: readonly IdeaRef[];
  /**
   * Every spec folder, active ones by folder name, then archived ones: also those that hold no claim of the master and
   * name no milestone, so the board and the specs list can open any spec. Absent, the index lists the specs the tree
   * names (feature holders, milestone specs) alone.
   */
  readonly specs?: readonly RelationSpec[];
  /** The master's `(after: …)` edges by claim id, as `Claim.after` holds them; absent, no claim has a blocker. */
  readonly after?: Readonly<Record<string, readonly string[]>>;
}

/** An entry while the index is built: the lists grow, the counts of a spec are summed at the end. */
interface Draft {
  ref: RelationRef;
  type: RelationType;
  id: string;
  title: string;
  closed: number;
  total: number;
  parents: RelationRef[];
  children: RelationRef[];
  blockers: RelationRef[];
  archived?: true;
  stage?: Stage | null;
}

const refOf = (type: RelationType, id: string): RelationRef => `${type}:${id}`;

/**
 * The relation index of one planning tree (spec 026, T10, ISC-171). The cascade it records, each link once, parents and
 * children always inverse:
 *
 * - milestone › feature: the blocks of `PlanningMilestone.features`, i.e. those whose `Milestone:` line names it where
 *   the master carries lines, otherwise the blocks its specs hold claims of (so a feature may sit under two milestones);
 * - feature › spec: the block's holders (`held` > 0); a spec's parents list its main feature first, then master order;
 * - spec › claim: the claims whose `holder` it is, dropped ones included; a claim's parents are its spec, then its block;
 * - feature › claim: every claim of the block, master order, after the specs;
 * - feature › idea and milestone › idea: the block a story's `feature:` names and the valid milestone its `milestone:`
 *   names, after the other children; an unknown name links nothing.
 *
 * Blockers: a claim's `(after: …)` claims that are entries of the index and still open (neither ticked nor dropped).
 * A claim outside every feature block is no entry, so it blocks nothing here. A spec has no blocker yet: its own edges
 * (`after: NNN`) come with spec 025 and join here as `spec:` refs, without a new field. Progress is the tree's:
 * milestone and feature as the tree counts them, a claim 1/1, 0/1 or 0/0 when dropped, a spec its live held claims, a
 * story 0/0. The order of the keys: milestones (target order), features (master order), specs (the `specs` order, then
 * any the tree names besides), claims (master order), stories (file-name order).
 */
export function buildRelations(input: RelationsInput): RelationIndex {
  const index = new Map<RelationRef, Draft>();
  const add = (type: RelationType, id: string, title: string, closed: number, total: number, extra: Pick<Draft, 'archived' | 'stage'> = {}): void => {
    const ref = refOf(type, id);
    if (!index.has(ref)) index.set(ref, { ref, type, id, title, closed, total, parents: [], children: [], blockers: [], ...extra });
  };
  const link = (parent: RelationRef, child: RelationRef): void => {
    const p = index.get(parent);
    const c = index.get(child);
    if (p === undefined || c === undefined || parent === child) return;
    if (!p.children.includes(child)) p.children.push(child);
    if (!c.parents.includes(parent)) c.parents.push(parent);
  };

  for (const m of input.milestones) add('milestone', m.slug, m.name, m.closed, m.total);
  for (const f of input.features) add('feature', f.id, f.name, f.closed, f.total);
  const specs = [...(input.specs ?? []), ...input.features.flatMap((f) => f.holders), ...input.milestones.flatMap((m) => m.specs)];
  for (const s of specs) add('spec', s.id, s.title, 0, 0, s.archived ? { archived: true } : { stage: s.stage });
  for (const f of input.features) {
    for (const c of f.claims) {
      const archived = c.holder !== null && index.get(refOf('spec', c.holder))?.archived === true;
      add('claim', c.id, c.text, !c.dropped && c.closed ? 1 : 0, c.dropped ? 0 : 1, archived ? { archived: true } : {});
    }
  }
  for (const idea of input.ideas) add('idea', idea.slug, idea.title, 0, 0);

  // Spec › claim before feature › claim, so a claim's parents read spec first.
  for (const f of input.features) for (const c of f.claims) if (c.holder !== null) link(refOf('spec', c.holder), refOf('claim', c.id));
  const mains = new Map<RelationRef, RelationRef>();
  for (const f of input.features) {
    const feature = refOf('feature', f.id);
    for (const h of f.holders) {
      const spec = refOf('spec', h.id);
      link(feature, spec);
      if (h.main && !mains.has(spec)) mains.set(spec, feature);
    }
    for (const c of f.claims) link(feature, refOf('claim', c.id));
  }
  for (const m of input.milestones) for (const share of m.features) link(refOf('milestone', m.slug), refOf('feature', share.id));
  const slugByName = new Map(input.milestones.map((m) => [m.name, m.slug]));
  for (const idea of input.ideas) {
    const ref = refOf('idea', idea.slug);
    if (idea.feature !== null) link(refOf('feature', idea.feature), ref);
    const slug = idea.milestone === null ? undefined : slugByName.get(idea.milestone);
    if (slug !== undefined) link(refOf('milestone', slug), ref);
  }

  for (const [spec, main] of mains) {
    const draft = index.get(spec);
    if (draft !== undefined) draft.parents = [main, ...draft.parents.filter((p) => p !== main)];
  }
  const after = input.after ?? {};
  for (const draft of index.values()) {
    if (draft.type === 'spec') {
      const held = draft.children.map((ref) => index.get(ref)).filter((c): c is Draft => c !== undefined && c.total > 0);
      draft.closed = held.filter((c) => c.closed === 1).length;
      draft.total = held.length;
      // Seam for spec 025: a spec's own edges (`after: NNN`) join `draft.blockers` here as open `spec:` refs.
    }
    if (draft.type === 'claim') {
      for (const id of after[draft.id] ?? []) {
        const ref = refOf('claim', id);
        const blocker = index.get(ref);
        if (blocker !== undefined && ref !== draft.ref && blocker.total > 0 && blocker.closed === 0 && !draft.blockers.includes(ref)) draft.blockers.push(ref);
      }
    }
  }
  return Object.fromEntries(index);
}

// ---------------------------------------------------------------------------------------------------------------------
// The matrix and the graph (spec 026, T18, T20, T22; ISC-169, ISC-169.1, ISC-170): two derivations of the index that
// the Matrix and the Diagram lens render as they are. Pure functions over a `PlanningModel` (its features, milestones,
// `unassignedFeatures` and `relations`), so the web lane calls them on the planning body the route serves, and the
// probe derives them from `<tree>.planning.golden.json` and from the live tree alike: no golden family of their own.

/**
 * One card of the matrix: one spec, as its index entry counts it. Its column is its main feature, the first feature of
 * the entry's `parents` (the `isa_feature`'s first word where the spec holds claims of it, else the first held feature
 * in master order); the spec's other features ride along as chips (ISC-169.1).
 */
export interface LensCard {
  /** `spec:<NNN>`, the sidebar's `?sel=`. */
  readonly ref: RelationRef;
  /** `025`, the card's mono id. */
  readonly id: string;
  readonly title: string;
  /** The board stage of an active spec; null for an archived one or one the caller passed no state for. */
  readonly stage: Stage | null;
  /** The live claims the spec holds, closed over total (the entry's progress). */
  readonly closed: number;
  readonly total: number;
  /** Held only in `specs/archive/`: the card is drawn dashed with the `archive` chip, after the active cards. */
  readonly archived: boolean;
  /** The spec's other features, master order: the `+F8` chips. Empty for a spec of one feature. */
  readonly otherFeatures: readonly RelationRef[];
  /** The entry's `blockers` (spec edges, `after: NNN`, join with spec 025); empty until then. */
  readonly blockers: readonly RelationRef[];
}

/** One column of the matrix: a feature that holds at least one card in at least one lane, in master order. */
export interface LensColumn {
  /** `feature:<F-id>`. */
  readonly ref: RelationRef;
  /** `F24`. */
  readonly id: string;
  readonly name: string;
  /** The feature's claims, closed over total, dropped ones in neither number. */
  readonly closed: number;
  readonly total: number;
  /**
   * Finished: every live claim closed (`total` > 0) and every card of the column, across the lanes, archived or at
   * stage `done`. The view folds such a column to a 44 px stripe until it is opened.
   */
  readonly done: boolean;
}

/** One swimlane: a milestone of the master, or the no-milestone lane (`ref` null), always last. */
export interface LensLane {
  /** `milestone:<slug>`; null for the no-milestone lane, which is a grouping, not an object of the index. */
  readonly ref: RelationRef | null;
  /** The milestone's name; null for the no-milestone lane, whose label is the view's. */
  readonly name: string | null;
  /** ISO date `YYYY-MM-DD`; null for an undated milestone and for the no-milestone lane. */
  readonly target: string | null;
  /**
   * Progress, closed over total: a milestone's own (`PlanningMilestone`). The no-milestone lane sums its features where
   * the master carries `Milestone:` lines or no milestone at all, otherwise the claims its specs hold, as a milestone
   * without lines counts (ISC-102).
   */
  readonly closed: number;
  readonly total: number;
  /** Active cards in this lane, archived ones not counted: the lane head's „8 Specs". */
  readonly specCount: number;
  /** One cell per column, index-aligned with `MatrixLens.columns`: the cards, active ones first, then archived. */
  readonly cells: ReadonlyArray<readonly LensCard[]>;
  /** The lane's features without a card in this lane, master order: the folded „Features ohne Spec" line. */
  readonly bare: readonly RelationRef[];
}

/** The Matrix lens: lanes by target date (undated after, the no-milestone lane last), columns in master order. */
export interface MatrixLens {
  readonly lanes: readonly LensLane[];
  readonly columns: readonly LensColumn[];
  /** Specs of the index that hold no claim of any feature, so no column can carry them (spec order); usually empty. */
  readonly unplaced: readonly RelationRef[];
}

/** The planning body both derivations read: the tree's lists and its index. A `PlanningModel` is one. */
export type LensInput = Pick<PlanningModel, 'features' | 'milestones' | 'unassignedFeatures' | 'relations'>;

/** One lane while it is laid out: its features (master order) and its cards by column feature. */
interface LaneDraft {
  readonly ref: RelationRef | null;
  readonly milestone: PlanningMilestone | null;
  features: RelationRef[];
  readonly cards: Map<RelationRef, LensCard[]>;
}

/**
 * The lanes, each with its features and cards, shared by matrix and graph. A spec's lane: where the master carries
 * `Milestone:` lines (some milestone's `featureIds` is not empty), the milestone whose line its main feature carries;
 * otherwise the milestone whose `specs` list it (the spec's own `milestone:`); else the no-milestone lane. A lane's
 * features: a milestone's `features`; the no-milestone lane's `unassignedFeatures` with lines, otherwise the features
 * no milestone lists; then every feature that holds a card there. Cards in the index's spec order, active ones first.
 */
function layLanes(model: LensInput): { lanes: LaneDraft[]; unplaced: RelationRef[]; byLines: boolean } {
  const byLines = model.milestones.some((m) => (m.featureIds ?? []).length > 0);
  const lanes: LaneDraft[] = model.milestones.map((m) => ({ ref: refOf('milestone', m.slug), milestone: m, features: m.features.map((f) => refOf('feature', f.id)), cards: new Map() }));
  const listed = new Set(model.milestones.flatMap((m) => m.features.map((f) => f.id)));
  const loose = byLines ? (model.unassignedFeatures ?? []) : model.features.map((f) => f.id).filter((id) => !listed.has(id));
  const none: LaneDraft = { ref: null, milestone: null, features: loose.map((id) => refOf('feature', id)), cards: new Map() };
  const laneOfFeature = new Map(model.milestones.flatMap((m, i) => (m.featureIds ?? []).map((id) => [refOf('feature', id), lanes[i]] as const)));
  const laneOfSpec = new Map(model.milestones.flatMap((m, i) => m.specs.map((s) => [refOf('spec', s.id), lanes[i]] as const)));
  const unplaced: RelationRef[] = [];
  const specs = Object.values(model.relations ?? {}).filter((r) => r.type === 'spec');
  for (const spec of [...specs.filter((s) => s.archived !== true), ...specs.filter((s) => s.archived === true)]) {
    const [main, ...others] = spec.parents.filter((p) => p.startsWith('feature:'));
    if (main === undefined) {
      unplaced.push(spec.ref);
      continue;
    }
    const lane = (byLines ? laneOfFeature.get(main) : laneOfSpec.get(spec.ref)) ?? none;
    const card: LensCard = { ref: spec.ref, id: spec.id, title: spec.title, stage: spec.stage ?? null, closed: spec.closed, total: spec.total, archived: spec.archived === true, otherFeatures: others, blockers: spec.blockers };
    lane.cards.set(main, [...(lane.cards.get(main) ?? []), card]);
  }
  // The no-milestone lane stands when it holds a feature, and always in a master without milestones.
  if (lanes.length === 0 || none.features.length > 0 || none.cards.size > 0) lanes.push(none);
  const order = model.features.map((f) => refOf('feature', f.id));
  for (const lane of lanes) lane.features = order.filter((ref) => lane.features.includes(ref) || lane.cards.has(ref));
  return { lanes, unplaced, byLines };
}

const finished = (closed: number, total: number): boolean => total > 0 && closed === total;
const settled = (card: LensCard): boolean => card.archived || card.stage === 'done';
const sumOf = (items: ReadonlyArray<{ readonly closed: number; readonly total: number } | undefined>): { closed: number; total: number } =>
  items.reduce<{ closed: number; total: number }>((n, x) => ({ closed: n.closed + (x?.closed ?? 0), total: n.total + (x?.total ?? 0) }), { closed: 0, total: 0 });

/**
 * The Matrix lens of a planning model (spec 026, T18 and T20; ISC-169, ISC-169.1): one lane per milestone in target
 * order plus the no-milestone lane last, one column per feature holding a card, master order, and per spec exactly one
 * card, in its lane and its main feature's column, its other features as chips. The lane rule is `layLanes`'.
 */
export function planningMatrix(model: LensInput): MatrixLens {
  const { lanes, unplaced, byLines } = layLanes(model);
  const columns = model.features.flatMap((f): LensColumn[] => {
    const ref = refOf('feature', f.id);
    const cards = lanes.flatMap((l) => l.cards.get(ref) ?? []);
    return cards.length === 0 ? [] : [{ ref, id: f.id, name: f.name, closed: f.closed, total: f.total, done: finished(f.closed, f.total) && cards.every(settled) }];
  });
  const counts = new Map(model.features.map((f) => [refOf('feature', f.id), f]));
  return {
    lanes: lanes.map((lane): LensLane => {
      const cells = columns.map((c) => lane.cards.get(c.ref) ?? []);
      const cards = cells.flat();
      const sum = lane.milestone ?? sumOf(byLines || model.milestones.length === 0 ? lane.features.map((ref) => counts.get(ref)) : cards);
      return {
        ref: lane.ref,
        name: lane.milestone?.name ?? null,
        target: lane.milestone?.target ?? null,
        closed: sum.closed,
        total: sum.total,
        specCount: cards.filter((c) => !c.archived).length,
        cells,
        bare: lane.features.filter((ref) => !lane.cards.has(ref)),
      };
    }),
    columns,
    unplaced,
  };
}

/** The four node kinds of the graph; a bundle folds several features of one lane into one dashed node. */
export type LensNodeKind = 'milestone' | 'feature' | 'spec' | 'bundle';

/**
 * One node of the Diagram lens. `id` is unique and mermaid-safe (letters, digits, `_`): `m_<lane>` (the no-milestone
 * lane `m__none`), `f_<lane>_<F-id>` (a feature may stand in two lanes of a master without lines), `s_<NNN>`,
 * `b_done_<lane>` and `b_nospec_<lane>`, where `<lane>` is the milestone slug with `-` as `_`, or `_none`.
 */
export interface LensNode {
  readonly id: string;
  readonly kind: LensNodeKind;
  /** The object a click selects (`?sel=`); null for the no-milestone lane and for a bundle. */
  readonly ref: RelationRef | null;
  /** The lane the node stands in: the milestone's ref, null for the no-milestone lane. */
  readonly lane: RelationRef | null;
  /** Milestone and feature name, spec title; null for the no-milestone lane and a bundle (the view labels them). */
  readonly title: string | null;
  /** Progress: a milestone's own, a feature's, a spec's held claims, a bundle's members summed; the lane node of the no-milestone lane 0/0. */
  readonly closed: number;
  readonly total: number;
  /** A spec node's stage, null when archived or unknown; absent on the other kinds. */
  readonly stage?: Stage | null;
  /** A spec node held only in `specs/archive/`; absent otherwise. */
  readonly archived?: true;
  /** A bundle's kind: `done` (every live claim closed, no open spec in the lane), `no-spec` (no spec in the lane). */
  readonly bundle?: 'done' | 'no-spec';
  /** A bundle's features, master order; a tap expands them (`GraphLensOptions.expand`). */
  readonly members?: readonly RelationRef[];
}

/**
 * One edge, `from` the parent `to` the child: `contains` for lane › feature, lane › bundle and feature › spec. The
 * `spec-edge` kind is spec 025's (`after: NNN`, ISC-170.1); no edge of that kind is derived yet.
 */
export interface LensEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: 'contains' | 'spec-edge';
}

/** The Diagram lens: nodes in drawing order (per lane the lane node, its features each with its specs, then its bundles). */
export interface GraphLens {
  readonly nodes: readonly LensNode[];
  readonly edges: readonly LensEdge[];
}

/** What the view shows; every field absent is the counted state of ISC-170. */
export interface GraphLensOptions {
  /** `'all'` (default, `Alle`: every lane), one lane's milestone ref (`?m=`), or null for the no-milestone lane. */
  readonly milestone?: 'all' | RelationRef | null;
  /** Archived specs drawn (default true); false drops their nodes before the bundles form, as the filter chip does. */
  readonly archived?: boolean;
  /** Bundle node ids drawn expanded: their features with their specs in place of the bundle (default none). */
  readonly expand?: readonly string[];
}

const safe = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, '_');

/**
 * The Diagram lens of a planning model (spec 026, T22, ISC-170): milestone → feature → spec over the lanes and cards
 * of the matrix. Per lane a milestone node (the no-milestone lane gets one only when the master has milestones; without
 * any, features and bundles are the roots: two ranks), then per lane feature in master order: a finished feature
 * (every live claim closed) with no open spec in the lane joins the lane's `done` bundle; a feature without a spec in
 * the lane joins its `no-spec` bundle; any other is drawn with its specs of the lane. A bundle without members is no
 * node. The counted state of ISC-170 is the default options: `Alle`, archived specs drawn, every bundle collapsed; the
 * view's own default (next milestone, archived hidden) is a filter of the same derivation, never the count.
 */
export function planningGraph(model: LensInput, options: GraphLensOptions = {}): GraphLens {
  const { lanes } = layLanes(model);
  const pick = options.milestone === undefined ? 'all' : options.milestone;
  const archived = options.archived ?? true;
  const expand = new Set(options.expand ?? []);
  const features = new Map(model.features.map((f) => [refOf('feature', f.id), f]));
  const rooted = model.milestones.length > 0;
  const nodes: LensNode[] = [];
  const edges: LensEdge[] = [];
  for (const lane of lanes) {
    if (pick !== 'all' && pick !== lane.ref) continue;
    const key = lane.milestone === null ? '_none' : safe(lane.milestone.slug);
    const root = `m_${key}`;
    if (rooted) nodes.push({ id: root, kind: 'milestone', ref: lane.ref, lane: lane.ref, title: lane.milestone?.name ?? null, closed: lane.milestone?.closed ?? 0, total: lane.milestone?.total ?? 0 });
    const hang = (id: string): void => {
      if (rooted) edges.push({ from: root, to: id, kind: 'contains' });
    };
    const cardsOf = (ref: RelationRef): LensCard[] => (lane.cards.get(ref) ?? []).filter((c) => archived || !c.archived);
    const draw = (ref: RelationRef): void => {
      const f = features.get(ref);
      const id = `f_${key}_${safe(ref.slice('feature:'.length))}`;
      nodes.push({ id, kind: 'feature', ref, lane: lane.ref, title: f?.name ?? null, closed: f?.closed ?? 0, total: f?.total ?? 0 });
      hang(id);
      for (const c of cardsOf(ref)) {
        const sid = `s_${safe(c.id)}`;
        nodes.push({ id: sid, kind: 'spec', ref: c.ref, lane: lane.ref, title: c.title, closed: c.closed, total: c.total, stage: c.stage, ...(c.archived ? { archived: true as const } : {}) });
        edges.push({ from: id, to: sid, kind: 'contains' });
      }
    };
    const done: RelationRef[] = [];
    const bare: RelationRef[] = [];
    for (const ref of lane.features) {
      const f = features.get(ref);
      const cards = cardsOf(ref);
      if (f !== undefined && finished(f.closed, f.total) && cards.every(settled)) done.push(ref);
      else if (cards.length === 0) bare.push(ref);
      else draw(ref);
    }
    for (const [kind, members] of [['done', done], ['no-spec', bare]] as const) {
      if (members.length === 0) continue;
      const id = `b_${kind === 'done' ? 'done' : 'nospec'}_${key}`;
      if (expand.has(id)) {
        for (const ref of members) draw(ref);
        continue;
      }
      nodes.push({ id, kind: 'bundle', ref: null, lane: lane.ref, title: null, ...sumOf(members.map((ref) => features.get(ref))), bundle: kind, members });
      hang(id);
    }
  }
  // Seam for spec 025 (ISC-170.1): a drawn spec's own edges (`after: NNN`, its card's `blockers`) join `edges` here as
  // `{ from: 's_<NNN>', to: 's_<blocker>', kind: 'spec-edge' }`; a blocker outside the drawn lanes as a ghost node.
  return { nodes, edges };
}
