// The planning tree (spec 003, ISC-100 to ISC-102): the seam between `core/`, the `planning` workspace route and the
// Features and Milestones pages. The server returns it from `GET /api/workspaces/:ws/planning` (plan.md
// § Interfaces), the web app renders it, and each fixture's `planning` golden is one of these. Like the dashboard
// model it never carries an absolute path: a spec is its id and folder slug, a file a path relative to the root.
//
// The hierarchy it derives: master ISA → feature block (`F0`…) → spec folder (`NNN`) → claim (`ISC-…`). A claim is
// held by the spec folder whose spec.md lists its id, active or archived; a spec belongs to every feature whose
// claims it holds, and the first word of its `isa_feature` (`mainFeatureOf` in `status.ts`) names its main feature.
// Milestones come from the master's `## Milestones` block (`milestones.ts`) and group specs by their `milestone:`
// frontmatter, across features; a feature block's `Milestone:` line (spec 026) hangs the block under one, and once the
// master carries any such line a milestone's progress is the sum of its blocks. The stories of `specs/ideas/` (spec 008, T55) sit beside them: under the feature
// their `feature:` names and the milestone their `milestone:` names, counted apart so no fraction changes. Every count
// is derived from the files on each read; nothing is stored.
//
// `buildPlanning` is pure over text the caller read and parses nothing itself: it composes `assignee.ts`, `claims.ts`,
// `events.ts`, `frontmatter.ts`, `ideas.ts`, `milestones.ts` and `status.ts`, and hands the tree to `relations.ts` for its index. Malformed input becomes a FileDiagnostic, never a
// throw. Its runtime imports are browser-safe parsers the barrel already exports (never `gates.ts` or `dashboard.ts`
// at runtime), so the barrel exports it whole and the web bundle may import it. Its type graph is browser-clean too
// (T18): it types against `files.ts`, `claims.ts`, `frontmatter.ts`, `milestones.ts`, `stage.ts` and `status.ts` only, never
// `dashboard.ts` or `gates.ts`, so the route contract's `import type { PlanningModel }` typechecks in the web tsconfigs
// without Node types.
import { assigneeOf } from './assignee.ts';
import { BACKLOG_FILE, parseBacklog } from './backlog.ts';
import type { BacklogPriority } from './backlog.ts';
import { parseClaims } from './claims.ts';
import type { Claim, ClaimsDocument, FeatureBlock } from './claims.ts';
import { parseEvents } from './events.ts';
import { specFilePath } from './files.ts';
import type { ActorRef, ClaimLock, FileDiagnostic, IdeaFiles, IdeaRef, LockReading, Priority, SpecEdge, SpecFiles, SpecWait, StageSource, Workflow, WorkflowStage } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { readIdeas } from './ideas.ts';
import { milestoneSlug, parseMilestones } from './milestones.ts';
import type { Milestone } from './milestones.ts';
import { buildRelations } from './relations.ts';
import type { ClaimFacts, RelationIndex } from './relations.ts';
import type { Progress } from './frontmatter.ts';
import { specIdOf, specSlugOf } from './spec-ref.ts';
import { DEFAULT_WORKFLOW } from './stage.ts';
import type { Stage } from './stage.ts';
import { mainFeatureOf } from './status.ts';
import { boardStages } from './workflow.ts';

/**
 * A milestone's derived state (design 003 § Milestone states): `complete` when every counted claim is closed, `late`
 * when the target date lies before `now` with claims still open, `upcoming` otherwise. An archived spec's claims count
 * exactly like an active one's, so archiving alone never completes or reopens a milestone; there is no separate
 * archived state. There is no `done` mark in the master; the state is never read from a file.
 */
export type MilestoneState = 'upcoming' | 'late' | 'complete';

/** One claim of a feature block, as the master lists it, with the spec folder that holds it. */
export interface PlanningClaim {
  /** `ISC-100.1`, as written in the master. */
  readonly id: string;
  /** The master line's claim text (`Claim.text`); empty when the block names an id the master lists no line for. */
  readonly text: string;
  /** The master's checkbox is ticked. */
  readonly closed: boolean;
  /** A `[DROPPED …]` tombstone: resolved but not achieved, so it counts in neither closed nor total. */
  readonly dropped: boolean;
  /**
   * Spec id `NNN` of the folder whose spec.md lists this claim, active or archived; null when no folder holds it
   * (an unheld claim). When two folders list one id, the active one wins over the archived one, then the lower id
   * (folder-name order). Set on a dropped claim too; only the counts leave dropped claims out.
   */
  readonly holder: string | null;
}

/** A spec folder that holds claims of a feature, or that carries a milestone. */
export interface PlanningHolder {
  /** Spec id, the folder's numeric prefix (`specIdOf`), `NNN` for every folder the loader lists; the whole folder name when it has none. */
  readonly id: string;
  /** The folder name `NNN-slug`, the key of the spec routes. */
  readonly slug: string;
  /** The spec's frontmatter `task:`, falling back to the folder slug without its number (`specSlugOf`, as `listArchive` does). */
  readonly title: string;
  /** The folder sits under `specs/archive/`: listed, counted, but never given a stage, next step or warning. */
  readonly archived: boolean;
  /**
   * The feature this entry sits under is the first word of the spec's `isa_feature` (`mainFeatureOf` in
   * `status.ts`). Always false on a milestone's spec list, which spans features.
   */
  readonly main: boolean;
  /**
   * How many claims of this feature the spec holds, dropped claims excluded: the claims whose `holder` is this spec,
   * so a claim two folders list counts once, for the winner, and the held counts plus `unheld` make up `total`. On a
   * milestone's list, how many claims of the master it holds.
   */
  readonly held: number;
  /**
   * The dashboard's stage for an active spec (`build`, `close`, …); null for an archived one, and for every spec the
   * caller passed no state for. The stage needs the reviewed and code-reviewed gate states, which `gates.ts` computes
   * with `node:crypto` and a worktree tree id, so the browser-safe tree cannot derive it: the caller passes the
   * dashboard rows in `PlanningInput.specStates` (spec 008, T64), and the tree carries their values unchanged.
   */
  readonly stage: Stage | null;
  /** Whether `stage` is the frontmatter `stage:` or the stage table's, as the dashboard row says; null with `stage`. */
  readonly stageSource: StageSource | null;
  /** The spec's frontmatter `priority:`, `P3` when absent or invalid, read here for active and archived specs alike. */
  readonly priority: Priority;
  /**
   * The raw sha256 hex of the spec's `spec.md` bytes, the hash a board write sends back to be compared (as the
   * server's `writes.ts` hashes a file); null for an archived spec and where the caller passed none. Computed by the
   * caller in `PlanningInput.specStates`, since hashing is `node:crypto` and this module stays browser-safe.
   */
  readonly hash: string | null;
  /**
   * Who the active spec is assigned to (spec 008, T65, ISC-131, `assigneeOf` in `assignee.ts`): the actor of the newest
   * lock of `PlanningInput.locks` on one of its claims, else the actor of its last event, else null; the dashboard
   * row's value over the same input. Null for an archived spec, which is never given a stage either.
   */
  readonly assignee: ActorRef | null;
  /**
   * What the spec waits on, the dashboard row's `waits` passed in `PlanningInput.specStates` (spec 025, ISC-163): the
   * board card's `waits on NNN`. Null for an archived spec, for a spec the caller passed no wait for, and once the
   * edge is met. `buildPlanning` always sets it; the type leaves it optional only so the web lane's hand-built holder
   * stubs stay valid, as with `PlanningModel.relations`.
   */
  readonly waits?: SpecWait | null;
}

/**
 * One active spec's state as the caller holds it (spec 008, T64): the dashboard row's stage and source, and the raw
 * sha256 of its spec.md. A `DashboardSpecRow` is one, `hash` aside, so the server passes its rows with the hash added.
 */
export interface PlanningSpecState {
  /** The folder name `NNN-slug`, as the dashboard row and the holder name it. */
  readonly slug: string;
  readonly stage: Stage;
  readonly stageSource: StageSource;
  /** Raw sha256 hex of spec.md; absent when the caller hashes nothing. */
  readonly hash?: string;
  /** The row's `waits` (spec 025, ISC-163); absent or null, the card waits on nothing. */
  readonly waits?: SpecWait | null;
}

/** One feature block of the master (an epic, in tracker words) with its progress across every spec that holds it. */
export interface PlanningFeature {
  /** `F2`. */
  readonly id: string;
  /** The heading after `F2 ·`. */
  readonly name: string;
  /** The block's `Why:` line without the prefix; null when it has none. */
  readonly why: string | null;
  /**
   * The block's 1-based global rank in `specs/backlog.md` (spec 036, `parseBacklog`): listed blocks in file order, then
   * the unlisted ones in master order. Without the file, the block's position in the master.
   */
  readonly rank: number;
  /** The block's priority in `specs/backlog.md`, `P3` when the file names none or does not list the block. */
  readonly priority: BacklogPriority;
  /** Closed claims of the block, dropped claims excluded. */
  readonly closed: number;
  /** Claims of the block, dropped claims excluded. */
  readonly total: number;
  /** Every claim of the block in master order, dropped ones included and marked. */
  readonly claims: readonly PlanningClaim[];
  /**
   * Specs holding at least one live claim of the block (`held` > 0): active ones by id, archived ones last (by id). A
   * spec holding claims of several blocks appears under each; `main` marks the block its `isa_feature` names. A spec
   * holding no live claim of any block, such as an allocated story, is listed under the block its `isa_feature` names
   * with `main` and `held` 0 (spec 033, ISC-186); it moves no count.
   */
  readonly holders: readonly PlanningHolder[];
  /** Ids of the block's claims no spec holds, dropped claims excluded, in master order. */
  readonly unheld: readonly string[];
  /**
   * The stories (`specs/ideas/`, spec 008) whose `feature:` names this block, in file-name order. Counted apart from
   * the claims: a story adds nothing to `closed` or `total`.
   */
  readonly ideas: readonly IdeaRef[];
}

/**
 * A feature's share of one milestone. Where the master carries `Milestone:` lines (spec 026, ISC-166.2): a block whose
 * line names the milestone, with every live claim of the block. Otherwise: the claims of that block held by the
 * milestone's specs.
 */
export interface PlanningMilestoneFeature {
  /** `F2`. */
  readonly id: string;
  /** The heading after `F2 ·`. */
  readonly name: string;
  /** Closed claims of this share, dropped claims excluded. */
  readonly closed: number;
  /** Claims of this share, dropped claims excluded. */
  readonly total: number;
}

/** One entry of the master's `## Milestones` block, with its progress over its features' lines or over the specs naming it. */
export interface PlanningMilestone {
  /** As written before the first ` · `; specs name it in `milestone:`. */
  readonly name: string;
  /** Kebab-cased name, see `milestoneSlug`: the key of the milestone's anchor on the Milestones page. */
  readonly slug: string;
  /** ISO date `YYYY-MM-DD`; null for an undated entry, which sorts last. */
  readonly target: string | null;
  /** The text after the date; null when the line has none. */
  readonly description: string | null;
  /** Closed claims summed over `features`, dropped claims excluded. */
  readonly closed: number;
  /** Claims summed over `features`, dropped claims excluded. */
  readonly total: number;
  /** Derived from `closed`, `total`, `target` and the input's `now`; see `MilestoneState`. */
  readonly state: MilestoneState;
  /**
   * The feature blocks whose `Milestone:` line names this entry (spec 026, ISC-166), in rank order (spec 036): the explicit
   * assignment, each block under at most one milestone. Empty when no line names it, as in every master without
   * `Milestone:` lines. Where the master carries any line, these blocks are `features` and their sum the progress.
   * `buildPlanning` always sets it; the type leaves it optional only so the web lane's hand-built planning stubs stay
   * valid until spec 026's tree lens reads it (then it becomes required, as `FeatureBlock.milestone` did in T3).
   */
  readonly featureIds?: readonly string[];
  /**
   * The milestone's shares per feature block, in rank order: the blocks of `featureIds` where the master carries any
   * `Milestone:` line, otherwise the blocks the milestone's specs hold claims of.
   */
  readonly features: readonly PlanningMilestoneFeature[];
  /** Specs whose `milestone:` names this entry, archived ones included (last), `main` always false. */
  readonly specs: readonly PlanningHolder[];
  /** The stories whose `milestone:` names this entry, in file-name order, counted apart from the claims. */
  readonly ideas: readonly IdeaRef[];
}

export interface PlanningModel {
  /**
   * The ISO day `YYYY-MM-DD` the milestone states were derived with (`PlanningInput.now`, else today's UTC date), the
   * cut-off day of the Gantt lens (spec 038, `planningGantt`): its axis starts here, so the lens and `late` agree on
   * one day, and fixture goldens carry their pinned date instead of the clock's.
   */
  readonly asOf: string;
  /** The workspace's workflow (`specs/workflow.md`, spec 008), the default table when the caller passed none. */
  readonly workflow: Workflow;
  /** The board's columns, `boardStages(workflow)` (T44): `idea` first, the detours right after `build`. */
  readonly stages: readonly WorkflowStage[];
  /**
   * The count per board column, keyed in `stages` order (T64, ISC-129): `idea` counts the stories, every other
   * stage the active specs the caller's `specStates` put there, each spec once however many features it holds. The
   * source of the board's column counts; a spec whose stage is not a column of the board is counted nowhere.
   */
  readonly stageCounts: Readonly<Partial<Record<WorkflowStage, number>>>;
  /**
   * Every feature block of the master in rank order (`PlanningFeature.rank`, spec 036), which is master order without
   * `specs/backlog.md`; never re-sorted by progress or by priority.
   */
  readonly features: readonly PlanningFeature[];
  /** Target date ascending, undated last; empty when the master has no `## Milestones` block. */
  readonly milestones: readonly PlanningMilestone[];
  /**
   * The no-milestone group (spec 026, ISC-166), shown after every milestone: the ids of the feature blocks no
   * milestone's `featureIds` lists, in rank order (spec 036). A block lands here without a `Milestone:` line, or when its line
   * names no valid entry of the `## Milestones` block (an unknown name, or one on a line `parseMilestones` skipped).
   * Every block of `features` is in exactly one milestone's `featureIds` or here; empty without a master. Always set
   * by `buildPlanning`, optional in the type for the same reason as `PlanningMilestone.featureIds`.
   */
  readonly unassignedFeatures?: readonly string[];
  /**
   * Every story of `specs/ideas/` (spec 008, T55), in file-name order: also those the tree lists under no feature or
   * milestone (none named, or an `unknown-feature` or `unknown-milestone` one). Empty without stories.
   */
  readonly ideas: readonly IdeaRef[];
  /**
   * The master's own count of closed and total claims, dropped ones excluded: the sum over `features` must equal it
   * (ISC-100.2). Null without a master.
   */
  readonly recount: Progress | null;
  /**
   * Parse findings met on the way (a malformed milestone line, a `milestone:` or `Milestone:` line naming no entry
   * (`spec-milestone-unknown`, `feature-milestone-unknown`), a spec's `milestone:` other than its main feature's line
   * (`milestone-mismatch`), the story reader's
   * `ideas-…` findings, a story's `unknown-feature` or `unknown-milestone`), per file.
   */
  readonly diagnostics: readonly FileDiagnostic[];
  /**
   * The relation index (spec 026, `relations.ts`): every milestone, feature, spec, claim and story by `<type>:<id>`,
   * with parents, children and blockers, as `buildRelations` derives it from this tree, every spec folder and the
   * master's `(after: …)` edges. `buildPlanning` always sets it (T10); the type leaves it optional only so the web
   * lane's hand-built planning stubs stay valid until the detail sidebar reads it, as with `featureIds`.
   */
  readonly relations?: RelationIndex;
  /**
   * The spec edges of the active specs (spec 025, ISC-170.1), `PlanningInput.specEdges` as the caller resolved them
   * (`resolveEdges`, open or met), for the Diagram lens's `spec-edge` arrows (`planningGraph`). Absent when the caller
   * passed none or an empty list, so a workspace without spec edges serves the body it served before.
   */
  readonly specEdges?: readonly SpecEdge[];
  /**
   * `PlanningInput.backlogHash` as the caller passed it (spec 036): the sha256 of `specs/backlog.md` a backlog write
   * (`POST /api/workspaces/:ws/backlog`) sends back in `X-Spectant-Backlog-Hash`. Absent when the caller passed none, so
   * a tree built without it, as every fixture golden is, serves the body it served before.
   */
  readonly backlogHash?: string;
}

/**
 * Everything the tree is built from, read by the caller: the dashboard's master and spec folders, plus a clock. The
 * fields repeat `DashboardInput`'s own rather than picking them, so this module never types against `dashboard.ts`;
 * a `DashboardInput` stays assignable to it (core/tests/planning.test.ts holds that at the type level).
 */
export interface PlanningInput {
  /** `ISA.md` at the repository root; null when absent. */
  readonly master: string | null;
  /** Folders directly under `specs/`. */
  readonly specs: readonly SpecFiles[];
  /** Folders under `specs/archive/`. */
  readonly archived: readonly SpecFiles[];
  /**
   * ISO date `YYYY-MM-DD` the late/upcoming derivation compares targets with. The server passes today; tests and
   * fixture goldens pass a fixed date so the snapshot does not move with the clock.
   */
  readonly now?: string;
  /**
   * The story folder `specs/ideas/` as `readIdeas` takes it (file name to text); absent or empty without stories.
   * Optional so a `DashboardInput` stays assignable; the server passes it from T79 on.
   */
  readonly ideas?: IdeaFiles;
  /** The workspace's workflow as `parseWorkflow` read it; the default table when absent (spec 008, T64). */
  readonly workflow?: Workflow;
  /**
   * The state of each active spec, from the dashboard rows plus the hash of spec.md (`PlanningSpecState`); absent,
   * every holder has a null stage, source and hash, and no spec is counted on the board.
   */
  readonly specStates?: readonly PlanningSpecState[];
  /**
   * The repository's lock reading (`readLockSources`), the one the dashboard takes as `DashboardInput.locks`, for each
   * holder's `assignee` (T65); absent, the assignee comes from the events alone.
   */
  readonly locks?: LockReading;
  /**
   * The repository's open claim locks for each claim's `ClaimFacts.lockHolder` alone (spec 067, ISC-530); absent, those
   * of `locks`. Unlike `locks`, they never move a holder's `assignee`, so a caller can name a claim's lock holder
   * without changing what the board shows.
   */
  readonly claimLocks?: readonly ClaimLock[];
  /**
   * The workspace's spec edges as `resolveEdges(…).edges` resolved them against the server's merge state (spec 025,
   * ISC-170.1); `resolveEdges` needs the merge state, which only the caller reads from git, so the tree takes its
   * result rather than resolving. Carried unchanged as `PlanningModel.specEdges`; absent, the diagram draws no
   * `spec-edge` arrow.
   */
  readonly specEdges?: readonly SpecEdge[];
  /**
   * The text of `specs/backlog.md` (spec 036), which ranks the feature blocks and gives each a priority; absent or
   * null without the file, and every block then stands at its master position with `P3`.
   */
  readonly backlog?: string | null;
  /**
   * The raw sha256 hex of the `specs/backlog.md` bytes the caller read, the hash of the empty text without the file
   * (spec 036): the hash a backlog write sends back to be compared, as `PlanningSpecState.hash` is for spec.md. Hashing
   * is `node:crypto`, so the caller computes it; carried unchanged as `PlanningModel.backlogHash`.
   */
  readonly backlogHash?: string;
}

/** The file every master diagnostic names, as the dashboard names it. */
const MASTER_FILE = 'ISA.md';

/** A spec folder with a spec.md, read once: what a holder entry shows and the claim ids its spec.md lists. */
interface Folder {
  readonly holder: Omit<PlanningHolder, 'main' | 'held'>;
  /** The first word of `isa_feature` (`mainFeatureOf` in `status.ts`); null when the spec names none. */
  readonly feature: string | null;
  readonly ids: ReadonlySet<string>;
  /** The spec's `milestone:` frontmatter value, trimmed; null when absent or blank. */
  readonly milestone: string | null;
  /** The folder's spec.md path relative to the root, as a diagnostic names it. */
  readonly file: string;
  /** What the spec.md says of its claims' probes and verifications (spec 067), from the one parse of `ids`. */
  readonly evidence: ClaimEvidence;
}

/** Per claim id the probe of its first Test Strategy row (`tool`, else `check`) and the text of its first Verification line. */
interface ClaimEvidence {
  readonly probes: ReadonlyMap<string, string>;
  readonly verifications: ReadonlyMap<string, string>;
}

/** The evidence of one parsed file; the first row and the first line of an id win, as on the Claims tab (`claim-view.ts`). */
function evidenceOf(doc: Pick<ClaimsDocument, 'testStrategy' | 'verification'>): ClaimEvidence {
  const probes = new Map<string, string>();
  for (const r of doc.testStrategy) if (!probes.has(r.isc)) probes.set(r.isc, r.tool.trim() === '' ? r.check : r.tool);
  const verifications = new Map<string, string>();
  for (const v of doc.verification) if (!verifications.has(v.id)) verifications.set(v.id, v.text);
  return { probes, verifications };
}

/**
 * The facts of one claim of a block (spec 067, ISC-530): the master's kind and state; the probe and, when closed, the
 * Verification line of the holding spec, else of the master; the session of the last lock on an open claim.
 */
function claimFactsOf(claim: ResolvedClaim, kind: Claim['kind'] | undefined, master: ClaimEvidence, locks: ReadonlyMap<string, ClaimLock>): ClaimFacts {
  const state = claim.dropped ? 'dropped' : claim.closed ? 'closed' : 'open';
  const own = claim.folder?.evidence;
  const probe = own?.probes.get(claim.id) ?? master.probes.get(claim.id);
  const verification = state === 'closed' ? (own?.verifications.get(claim.id) ?? master.verifications.get(claim.id)) : undefined;
  const lock = state === 'open' ? locks.get(claim.id) : undefined;
  return {
    kind: kind ?? 'normal',
    state,
    ...(probe === undefined || probe.trim() === '' ? {} : { probe }),
    ...(verification === undefined || verification.trim() === '' ? {} : { verification }),
    ...(lock === undefined ? {} : { lockHolder: lock.session }),
  };
}

const byFolderName = (a: SpecFiles, b: SpecFiles): number => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0);

/**
 * Active folders in folder-name order, then archived ones in folder-name order: the order a claim's holder is picked
 * in, and the order of every holder list. A folder without spec.md is not a spec and holds nothing.
 */
function readFolders(
  active: readonly SpecFiles[],
  archived: readonly SpecFiles[],
  states: ReadonlyMap<string, PlanningSpecState>,
  locks: readonly ClaimLock[],
): Folder[] {
  const read = (files: readonly SpecFiles[], isArchived: boolean): Folder[] =>
    [...files].sort(byFolderName).flatMap((f): Folder[] => {
      const spec = f.texts.spec;
      if (spec === undefined) return [];
      const { data } = parseFrontmatter(spec);
      const milestone = data.milestone?.trim();
      const doc = parseClaims(spec);
      const ids = new Set(doc.claims.map((c) => c.id));
      // An archived spec is never given a stage (`PlanningHolder.archived`), whatever the caller's states say.
      const state = isArchived ? undefined : states.get(f.folder);
      const events = f.texts.events === undefined ? [] : parseEvents(f.texts.events).events;
      const holder = {
        id: specIdOf(f.folder) ?? f.folder,
        slug: f.folder,
        title: data.task ?? specSlugOf(f.folder),
        archived: isArchived,
        stage: state?.stage ?? null,
        stageSource: state?.stageSource ?? null,
        priority: data.priority,
        hash: state?.hash ?? null,
        assignee: isArchived ? null : assigneeOf({ claims: ids, locks, events }),
        waits: state?.waits ?? null,
      };
      return [
        {
          holder,
          feature: mainFeatureOf(data.isaFeature),
          ids,
          evidence: evidenceOf(doc),
          milestone: milestone === undefined || milestone === '' ? null : milestone,
          file: specFilePath(`specs/${isArchived ? 'archive/' : ''}${f.folder}`, 'spec'),
        },
      ];
    });
  return [...read(active, false), ...read(archived, true)];
}

/** A claim of a feature block with the folder that holds it (the first in `readFolders` order that lists it). */
interface ResolvedClaim {
  readonly id: string;
  readonly text: string;
  readonly closed: boolean;
  readonly dropped: boolean;
  readonly folder: Folder | undefined;
}

/**
 * A feature block with every claim resolved once, shared by the feature entry and the milestone rows, and its place in
 * the backlog (spec 036).
 */
interface ResolvedBlock {
  readonly block: FeatureBlock;
  readonly claims: readonly ResolvedClaim[];
  readonly rank: number;
  readonly priority: BacklogPriority;
}

function resolveBlock(block: FeatureBlock, claimById: ReadonlyMap<string, Claim>, folders: readonly Folder[], place: { rank: number; priority: BacklogPriority }): ResolvedBlock {
  return {
    block,
    ...place,
    claims: block.claims.map((id) => {
      const claim = claimById.get(id);
      return {
        id,
        text: claim?.text ?? '',
        closed: claim?.checked ?? false,
        dropped: claim?.dropped ?? false,
        folder: folders.find((f) => f.ids.has(id)),
      };
    }),
  };
}

/**
 * One feature block with each claim resolved to its holding folder, the block's holders and its progress. A folder in
 * `claimless` (no live claim in any block) holds the block its `isa_feature` names with `held` 0 (spec 033, ISC-186).
 */
function planningFeature({ block, claims: resolved, rank, priority }: ResolvedBlock, folders: readonly Folder[], claimless: ReadonlySet<Folder>, ideas: readonly IdeaRef[]): PlanningFeature {
  const live = resolved.filter((c) => !c.dropped);
  return {
    id: block.id,
    name: block.name,
    why: block.why,
    rank,
    priority,
    closed: live.filter((c) => c.closed).length,
    total: live.length,
    claims: resolved.map(({ id, text, closed, dropped, folder }): PlanningClaim => ({ id, text, closed, dropped, holder: folder?.holder.id ?? null })),
    holders: folders.flatMap((f): PlanningHolder[] => {
      const held = live.filter((c) => c.folder === f).length;
      if (held > 0) return [{ ...f.holder, main: f.feature === block.id, held }];
      return claimless.has(f) && f.feature === block.id ? [{ ...f.holder, main: true, held: 0 }] : [];
    }),
    unheld: live.filter((c) => c.folder === undefined).map((c) => c.id),
    ideas: ideas.filter((idea) => idea.feature === block.id),
  };
}

/**
 * The derived state of a milestone (design 003 § Milestone states). `complete` needs at least one counted claim: a row
 * no spec names, or whose specs hold no live claim, counts 0/0 and shows as `late` or `upcoming` by its date, since
 * "every claim closed" over nothing would mark an empty release done. `late` means the target lies strictly before
 * `now`: on the target date itself the milestone is still `upcoming`. Both are ISO `YYYY-MM-DD`, so a string compare
 * orders them.
 */
function milestoneState(closed: number, total: number, target: string, now: string): MilestoneState {
  if (total > 0 && closed === total) return 'complete';
  return target < now ? 'late' : 'upcoming';
}

/** The live claims of `claims` as a milestone's share of one block, closed over total. */
const shareOf = (block: FeatureBlock, claims: readonly ResolvedClaim[]): PlanningMilestoneFeature => ({
  id: block.id,
  name: block.name,
  closed: claims.filter((c) => c.closed).length,
  total: claims.length,
});

/**
 * One entry of the `## Milestones` block with the folders naming it (active then archived, `readFolders` order) and its
 * progress per feature block in master order, summed. Two ways to count (spec 026, ISC-166.2), chosen once per master:
 *
 * - `byLines` (the master carries at least one `Milestone:` line): the features whose line names this entry, each with
 *   every live claim of its block, whoever holds it. The specs naming the entry are still listed, but move no count.
 * - otherwise (ISC-102): the live claims the entry's folders hold, per block they touch. A claim counts for the folder
 *   that wins it (the feature rule), so a claim a milestone's spec lists but another folder holds counts for neither.
 *
 * Either way `closed` and `total` are the sum over `features`, and the state is derived from them.
 */
function planningMilestone(entry: Milestone, blocks: readonly ResolvedBlock[], folders: readonly Folder[], ideas: readonly IdeaRef[], now: string, byLines: boolean): PlanningMilestone {
  const members = new Set(folders.filter((f) => f.milestone === entry.name));
  const features = byLines
    ? blocks.filter(({ block }) => block.milestone === entry.name).map(({ block, claims }) => shareOf(block, claims.filter((c) => !c.dropped)))
    : blocks.flatMap(({ block, claims }): PlanningMilestoneFeature[] => {
        const held = claims.filter((c) => !c.dropped && c.folder !== undefined && members.has(c.folder));
        return held.length === 0 ? [] : [shareOf(block, held)];
      });
  const closed = features.reduce((n, f) => n + f.closed, 0);
  const total = features.reduce((n, f) => n + f.total, 0);
  return {
    name: entry.name,
    slug: milestoneSlug(entry.name),
    target: entry.target,
    description: entry.description,
    closed,
    total,
    state: milestoneState(closed, total, entry.target, now),
    featureIds: blocks.filter(({ block }) => block.milestone === entry.name).map(({ block }) => block.id),
    features,
    specs: [...members].map((f): PlanningHolder => ({
      ...f.holder,
      main: false,
      held: blocks.reduce((n, { claims }) => n + claims.filter((c) => !c.dropped && c.folder === f).length, 0),
    })),
    ideas: ideas.filter((idea) => idea.milestone === entry.name),
  };
}

/**
 * A story's `feature:` naming no block of the master, or its `milestone:` naming no entry of the `## Milestones` block
 * (spec 008, T55): one warning each, keyed to the story file, the name as subject. A name the master lists on a line
 * `parseMilestones` skipped is known (`entries` holds it), as for a spec; the master's own warning names the cause.
 */
function unknownIdeaNames(ideas: readonly IdeaRef[], blocks: ReadonlySet<string>, entries: ReadonlySet<string>): FileDiagnostic[] {
  const warn = (idea: IdeaRef, code: string, message: string, subject: string): FileDiagnostic => ({
    file: idea.path,
    diagnostic: { severity: 'warning', code, message, subject },
  });
  return ideas.flatMap((idea): FileDiagnostic[] => [
    ...(idea.feature === null || blocks.has(idea.feature)
      ? []
      : [warn(idea, 'unknown-feature', `feature "${idea.feature}" is not a feature block of the master`, idea.feature)]),
    ...(idea.milestone === null || entries.has(idea.milestone)
      ? []
      : [warn(idea, 'unknown-milestone', `milestone "${idea.milestone}" is not in the master's ## Milestones block`, idea.milestone)]),
  ]);
}

/** The default table as a workflow, for a caller that passes none. */
const DEFAULT_PLANNING_WORKFLOW: Workflow = { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };

/**
 * The count per board column (T64): the stories in `idea`, each active folder once in the stage its state names. A
 * folder without a state, and an archived one, has no stage and is counted nowhere.
 */
function stageCounts(stages: readonly WorkflowStage[], folders: readonly Folder[], stories: number): Partial<Record<WorkflowStage, number>> {
  const counts: Partial<Record<WorkflowStage, number>> = {};
  for (const stage of stages) {
    counts[stage] = stage === 'idea' ? stories : folders.filter((f) => f.holder.stage === stage).length;
  }
  return counts;
}

/**
 * The planning tree of one workspace, derived from the files alone.
 *
 * T8 (ISC-100) fills the features, the recount and the master's claim diagnostics; T16 (ISC-102) the milestones.
 * Claims outside every feature block count in `recount` but under no feature and no milestone.
 *
 * Milestones are sorted by target date ascending, ties in block order (`Array.prototype.sort` is stable). The type
 * allows an undated entry, sorting last, but `parseMilestones` skips a line without a valid date, so every row
 * carries one today. Without `input.now` the state compares with today's UTC date; the server should always pass
 * the local date, and fixtures pass a fixed one.
 */
export function buildPlanning(input: PlanningInput): PlanningModel {
  const stories = readIdeas(input.ideas ?? {});
  const ideas = stories.ideas;
  const workflow = input.workflow ?? DEFAULT_PLANNING_WORKFLOW;
  const stages = boardStages(workflow);
  const folders = readFolders(input.specs, input.archived, new Map((input.specStates ?? []).map((s) => [s.slug, s])), input.locks?.locks ?? []);
  const now = input.now ?? new Date().toISOString().slice(0, 10);
  const board = { asOf: now, workflow, stages, stageCounts: stageCounts(stages, folders, ideas.length) };
  const specs = folders.map((f) => f.holder);
  if (input.master === null) {
    const relations = buildRelations({ features: [], milestones: [], ideas, specs });
    return { ...board, features: [], milestones: [], unassignedFeatures: [], ideas, recount: null, diagnostics: stories.diagnostics, relations, ...specEdgesOf(input), ...backlogHashOf(input) };
  }
  const master = parseClaims(input.master);
  const claimById = new Map<string, Claim>();
  for (const claim of master.claims) if (!claimById.has(claim.id)) claimById.set(claim.id, claim);
  // Spec 036: the backlog ranks the blocks, and every list of blocks below (features, a milestone's shares and
  // `featureIds`, the no-milestone group) follows that order. Without the file the rank is the master position, so
  // the order is the master's. A block id the master repeats takes the rank of its first block.
  const backlog = parseBacklog(input.backlog ?? null, master.features.map((f) => f.id));
  const placeOf = new Map(backlog.entries.map((e) => [e.feature, { rank: e.rank, priority: e.priority }]));
  const blocks = master.features
    .map((block, i) => resolveBlock(block, claimById, folders, placeOf.get(block.id) ?? { rank: i + 1, priority: 'P3' }))
    .sort((a, b) => a.rank - b.rank);
  const parsed = parseMilestones(input.master);
  // A name the master lists on a line `parseMilestones` skipped is known but unusable: the master's own warning names the
  // cause, so the spec gets no second warning, and it joins no milestone (`planningMilestone` matches valid entries only).
  const entries = new Set([...parsed.milestones.map((m) => m.name), ...parsed.skipped]);
  // An archived spec is never given a warning (`PlanningHolder.archived`): one naming a removed milestone stays silent.
  const unknownMilestones = folders.flatMap((f): FileDiagnostic[] =>
    f.holder.archived || f.milestone === null || entries.has(f.milestone)
      ? []
      : [
          {
            file: f.file,
            diagnostic: {
              severity: 'warning',
              code: 'spec-milestone-unknown',
              message: `milestone "${f.milestone}" is not in the master's ## Milestones block`,
              subject: f.milestone,
            },
          },
        ],
  );
  const byTarget = [...parsed.milestones].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  // A feature's `Milestone:` line matches an entry as a spec's `milestone:` does: the exact name of a valid entry. A
  // name on a skipped line, or no entry at all, leaves the feature in the no-milestone group.
  const valid = new Set(parsed.milestones.map((m) => m.name));
  // ISC-166.1: a line naming no entry is one warning on the master at the block's heading, the name as subject. A name
  // on a skipped line is known (`entries`), as for a spec: the master's own warning names the cause.
  // ISC-166.2: one `Milestone:` line anywhere switches every milestone to the sum of its features; without a single
  // line the master counts over the specs' `milestone:` as before (ISC-102), so an existing master reads unchanged.
  const byLines = master.features.some((f) => f.milestone !== null);
  // A spec whose known `milestone:` differs from the known line of its main feature is one warning on the spec; nothing
  // is reassigned. An unknown name on either side already has its own warning, an absent one is never a warning, and an
  // archived spec is never warned (`PlanningHolder.archived`). Without any line no block names a milestone: no warning.
  const blockById = new Map(master.features.map((f) => [f.id, f]));
  const mismatches = folders.flatMap((f): FileDiagnostic[] => {
    const line = f.feature === null ? null : (blockById.get(f.feature)?.milestone ?? null);
    return f.holder.archived || f.milestone === null || line === null || !entries.has(f.milestone) || !entries.has(line) || line === f.milestone
      ? []
      : [
          {
            file: f.file,
            diagnostic: {
              severity: 'warning',
              code: 'milestone-mismatch',
              message: `milestone "${f.milestone}" differs from "${line}", the milestone line of the spec's main feature ${f.feature ?? ''}`,
              subject: f.milestone,
            },
          },
        ];
  });
  const unknownFeatureMilestones = master.features.flatMap((f): FileDiagnostic[] =>
    f.milestone === null || entries.has(f.milestone)
      ? []
      : [
          {
            file: MASTER_FILE,
            diagnostic: {
              severity: 'warning',
              code: 'feature-milestone-unknown',
              message: `feature ${f.id} names milestone "${f.milestone}", which is not in the master's ## Milestones block`,
              line: f.line,
              subject: f.milestone,
            },
          },
        ],
  );
  const holding = new Set(blocks.flatMap(({ claims }) => claims.flatMap((c) => (c.dropped || c.folder === undefined ? [] : [c.folder]))));
  const claimless = new Set(folders.filter((f) => !holding.has(f)));
  const features = blocks.map((block) => planningFeature(block, folders, claimless, ideas));
  const milestones = byTarget.map((entry) => planningMilestone(entry, blocks, folders, ideas, now, byLines));
  const after = Object.fromEntries([...claimById].flatMap(([id, claim]) => (claim.after.length === 0 ? [] : [[id, claim.after]])));
  // Spec 067: each claim's facts; the later lock of a claim wins, as in `partitionClaims`.
  const masterEvidence = evidenceOf(master);
  const lockOf = new Map((input.claimLocks ?? input.locks?.locks ?? []).map((l) => [l.claim, l]));
  const claimFacts: Record<string, ClaimFacts> = {};
  for (const { claims } of blocks) for (const c of claims) claimFacts[c.id] ??= claimFactsOf(c, claimById.get(c.id)?.kind, masterEvidence, lockOf);
  return {
    ...board,
    features,
    milestones,
    unassignedFeatures: blocks.map(({ block }) => block).filter((f) => f.milestone === null || !valid.has(f.milestone)).map((f) => f.id),
    ideas,
    recount: master.counted,
    diagnostics: [
      ...master.diagnostics.map((diagnostic) => ({ file: MASTER_FILE, diagnostic })),
      ...parsed.diagnostics.map((diagnostic) => ({ file: MASTER_FILE, diagnostic })),
      ...unknownFeatureMilestones,
      ...unknownMilestones,
      ...mismatches,
      ...stories.diagnostics,
      ...unknownIdeaNames(ideas, new Set(master.features.map((f) => f.id)), entries),
      ...backlog.diagnostics.map((diagnostic) => ({ file: BACKLOG_FILE, diagnostic })),
    ],
    relations: buildRelations({ features, milestones, ideas, specs, after, claimFacts }),
    ...specEdgesOf(input),
    ...backlogHashOf(input),
  };
}

/** `PlanningModel.backlogHash`: the caller's hash of `specs/backlog.md`, absent when it passed none (spec 036). */
function backlogHashOf(input: PlanningInput): { backlogHash?: string } {
  return input.backlogHash === undefined ? {} : { backlogHash: input.backlogHash };
}

/** `PlanningModel.specEdges`: the caller's resolved spec edges, absent when there are none (spec 025, ISC-170.1). */
function specEdgesOf(input: PlanningInput): { specEdges?: readonly SpecEdge[] } {
  return input.specEdges === undefined || input.specEdges.length === 0 ? {} : { specEdges: input.specEdges };
}
