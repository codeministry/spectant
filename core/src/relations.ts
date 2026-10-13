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
import type { PlanningFeature, PlanningHolder, PlanningMilestone } from './planning.ts';
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
