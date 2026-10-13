// The relation index of the planning tree (spec 026, T1, the core seam): every object of the cascade milestone ›
// feature › spec › claim, plus the stories of `specs/ideas/`, as one flat table keyed by `<type>:<id>`, each entry with
// its parents, children and blockers. It is the one source the detail sidebar, the tree, the matrix and the diagram
// read, so no view derives the relations a second time; the server ships it inside `PlanningModel.relations`, no new
// route. The sidebar reads only the address (`?sel=<type>:<id>`) and looks the entry up here, so a reload shows the
// same sidebar without a side channel.
//
// Types only, no runtime code: the browser bundle imports it. The builder that fills the table lives with the
// planning tree and composes it from the parsed files on every read; nothing of it is stored.

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
