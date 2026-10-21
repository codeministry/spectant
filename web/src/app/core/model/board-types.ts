import type { ActorRef, Guidance, GuidanceReason, ItemStateInfo, Priority, SpecType, SpecWait, StageSource, WorkflowStage, Worktree } from '../../../../../core/src/files';
import type { MilestoneState, PlanningModel } from '../../../../../core/src/planning';
import type { ActorMapping } from '../../../../../server/src/contracts/spec-routes.contract';
import type { BoardRow } from './board-rows';
import type { BoardCardType, BoardQueryState } from './board-query';

/** The input and the model of the workspace board (spec 008, T120, ISC-129); `buildBoard` in `board.ts` builds it. */

// ─── The input ──────────────────────────────────────────────────────────────────────────────────────────────────────

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
  /** The row's command, e.g. `/spec review 005`; null where the row names none. */
  readonly command: string | null;
  /** The stage is one core's `WAITING_STAGES` holds: the card shows its reason line. */
  readonly waiting: boolean;
  /** Waits on the principal: a waiting stage whose row has a command, other than the waits on a spec or a claim. */
  readonly waitsOnYou: boolean;
  /**
   * Spec 020 (T23, ISC-240): the spec's own entry stands in `guidance.waits`, so the card carries the "Waits on you"
   * marker; absent or false for an idea, a Next item and a server without a clock.
   */
  readonly marked?: boolean;
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
