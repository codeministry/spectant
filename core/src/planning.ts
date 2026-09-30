// The planning tree (spec 003, ISC-100 to ISC-102): the seam between `core/`, the `planning` workspace route and the
// Features and Milestones pages. The server returns it from `GET /api/workspaces/:ws/planning` (plan.md
// § Interfaces), the web app renders it, and each fixture's `planning` golden is one of these. Like the dashboard
// model it never carries an absolute path: a spec is its id and folder slug, a file a path relative to the root.
//
// The hierarchy it derives: master ISA → feature block (`F0`…) → spec folder (`NNN`) → claim (`ISC-…`). A claim is
// held by the spec folder whose spec.md lists its id, active or archived; a spec belongs to every feature whose
// claims it holds, and the first word of its `isa_feature` (`mainFeatureOf` in `status.ts`) names its main feature.
// Milestones come from the master's `## Milestones` block (`milestones.ts`) and group specs by their `milestone:`
// frontmatter, across features. Every count is derived from the files on each read; nothing is stored.
//
// `buildPlanning` is pure over text the caller read and parses nothing itself: it composes `claims.ts`,
// `frontmatter.ts`, `milestones.ts` and `status.ts`. Malformed input becomes a FileDiagnostic, never a throw. Its
// runtime imports are browser-safe parsers the barrel already exports (never `gates.ts` or `dashboard.ts` at runtime),
// so the barrel exports it whole and the web bundle may import it. Its type graph is browser-clean too (T18): it types
// against `files.ts`, `claims.ts`, `frontmatter.ts`, `milestones.ts`, `stage.ts` and `status.ts` only, never
// `dashboard.ts` or `gates.ts`, so the route contract's `import type { PlanningModel }` typechecks in the web tsconfigs
// without Node types.
import { parseClaims } from './claims.ts';
import type { Claim, FeatureBlock } from './claims.ts';
import { specFilePath } from './files.ts';
import type { FileDiagnostic, SpecFiles } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { milestoneSlug, parseMilestones } from './milestones.ts';
import type { Milestone } from './milestones.ts';
import type { Progress } from './frontmatter.ts';
import { specIdOf, specSlugOf } from './spec-ref.ts';
import type { Stage } from './stage.ts';
import { mainFeatureOf } from './status.ts';

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
   * The dashboard's stage for an active spec (`build`, `close`, …); null for an archived one. As of T8 null for every
   * spec: the stage needs the reviewed and code-reviewed gate states, which `gates.ts` computes with `node:crypto` and
   * a worktree tree id, so the browser-safe tree cannot derive it; whoever holds the dashboard rows fills it in.
   */
  readonly stage: Stage | null;
}

/** One feature block of the master (an epic, in tracker words) with its progress across every spec that holds it. */
export interface PlanningFeature {
  /** `F2`. */
  readonly id: string;
  /** The heading after `F2 ·`. */
  readonly name: string;
  /** The block's `Why:` line without the prefix; null when it has none. */
  readonly why: string | null;
  /** Closed claims of the block, dropped claims excluded. */
  readonly closed: number;
  /** Claims of the block, dropped claims excluded. */
  readonly total: number;
  /** Every claim of the block in master order, dropped ones included and marked. */
  readonly claims: readonly PlanningClaim[];
  /**
   * Specs holding at least one live claim of the block (`held` > 0): active ones by id, archived ones last (by id). A
   * spec holding claims of several blocks appears under each; `main` marks the block its `isa_feature` names.
   */
  readonly holders: readonly PlanningHolder[];
  /** Ids of the block's claims no spec holds, dropped claims excluded, in master order. */
  readonly unheld: readonly string[];
}

/** A feature's share of one milestone: the claims of that block held by the milestone's specs. */
export interface PlanningMilestoneFeature {
  /** `F2`. */
  readonly id: string;
  /** The heading after `F2 ·`. */
  readonly name: string;
  /** Closed claims of this block held by the milestone's specs, dropped claims excluded. */
  readonly closed: number;
  /** Claims of this block held by the milestone's specs, dropped claims excluded. */
  readonly total: number;
}

/** One entry of the master's `## Milestones` block, with the progress of every spec that names it. */
export interface PlanningMilestone {
  /** As written before the first ` · `; specs name it in `milestone:`. */
  readonly name: string;
  /** Kebab-cased name, see `milestoneSlug`: the key of the milestone's anchor on the Milestones page. */
  readonly slug: string;
  /** ISO date `YYYY-MM-DD`; null for an undated entry, which sorts last. */
  readonly target: string | null;
  /** The text after the date; null when the line has none. */
  readonly description: string | null;
  /** Closed claims held by the milestone's specs across all features, dropped claims excluded. */
  readonly closed: number;
  /** Claims held by the milestone's specs across all features, dropped claims excluded. */
  readonly total: number;
  /** Derived from `closed`, `total`, `target` and the input's `now`; see `MilestoneState`. */
  readonly state: MilestoneState;
  /** The features the milestone's specs hold claims of, in master order. */
  readonly features: readonly PlanningMilestoneFeature[];
  /** Specs whose `milestone:` names this entry, archived ones included (last), `main` always false. */
  readonly specs: readonly PlanningHolder[];
}

export interface PlanningModel {
  /** Every feature block of the master, in master order, never re-sorted by progress. */
  readonly features: readonly PlanningFeature[];
  /** Target date ascending, undated last; empty when the master has no `## Milestones` block. */
  readonly milestones: readonly PlanningMilestone[];
  /**
   * The master's own count of closed and total claims, dropped ones excluded: the sum over `features` must equal it
   * (ISC-100.2). Null without a master.
   */
  readonly recount: Progress | null;
  /** Parse findings met on the way (a malformed milestone line, a `milestone:` naming no entry), per file. */
  readonly diagnostics: readonly FileDiagnostic[];
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
}

const byFolderName = (a: SpecFiles, b: SpecFiles): number => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0);

/**
 * Active folders in folder-name order, then archived ones in folder-name order: the order a claim's holder is picked
 * in, and the order of every holder list. A folder without spec.md is not a spec and holds nothing.
 */
function readFolders(active: readonly SpecFiles[], archived: readonly SpecFiles[]): Folder[] {
  const read = (files: readonly SpecFiles[], isArchived: boolean): Folder[] =>
    [...files].sort(byFolderName).flatMap((f): Folder[] => {
      const spec = f.texts.spec;
      if (spec === undefined) return [];
      const { data } = parseFrontmatter(spec);
      const milestone = data.milestone?.trim();
      const holder = { id: specIdOf(f.folder) ?? f.folder, slug: f.folder, title: data.task ?? specSlugOf(f.folder), archived: isArchived, stage: null };
      return [
        {
          holder,
          feature: mainFeatureOf(data.isaFeature),
          ids: new Set(parseClaims(spec).claims.map((c) => c.id)),
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
  readonly closed: boolean;
  readonly dropped: boolean;
  readonly folder: Folder | undefined;
}

/** A feature block with every claim resolved once, shared by the feature entry and the milestone rows. */
interface ResolvedBlock {
  readonly block: FeatureBlock;
  readonly claims: readonly ResolvedClaim[];
}

function resolveBlock(block: FeatureBlock, claimById: ReadonlyMap<string, Claim>, folders: readonly Folder[]): ResolvedBlock {
  return {
    block,
    claims: block.claims.map((id) => {
      const claim = claimById.get(id);
      return { id, closed: claim?.checked ?? false, dropped: claim?.dropped ?? false, folder: folders.find((f) => f.ids.has(id)) };
    }),
  };
}

/** One feature block with each claim resolved to its holding folder, the block's holders and its progress. */
function planningFeature({ block, claims: resolved }: ResolvedBlock, folders: readonly Folder[]): PlanningFeature {
  const live = resolved.filter((c) => !c.dropped);
  return {
    id: block.id,
    name: block.name,
    why: block.why,
    closed: live.filter((c) => c.closed).length,
    total: live.length,
    claims: resolved.map(({ id, closed, dropped, folder }): PlanningClaim => ({ id, closed, dropped, holder: folder?.holder.id ?? null })),
    holders: folders.flatMap((f): PlanningHolder[] => {
      const held = live.filter((c) => c.folder === f).length;
      return held === 0 ? [] : [{ ...f.holder, main: f.feature === block.id, held }];
    }),
    unheld: live.filter((c) => c.folder === undefined).map((c) => c.id),
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

/**
 * One entry of the `## Milestones` block with the folders naming it (active then archived, `readFolders` order) and the
 * live claims they hold, per feature block in master order. A claim counts for the folder that wins it (the feature
 * rule), so a claim a milestone's spec lists but another folder holds counts for neither the spec nor the milestone.
 */
function planningMilestone(entry: Milestone, blocks: readonly ResolvedBlock[], folders: readonly Folder[], now: string): PlanningMilestone {
  const members = new Set(folders.filter((f) => f.milestone === entry.name));
  const features = blocks.flatMap(({ block, claims }): PlanningMilestoneFeature[] => {
    const held = claims.filter((c) => !c.dropped && c.folder !== undefined && members.has(c.folder));
    return held.length === 0 ? [] : [{ id: block.id, name: block.name, closed: held.filter((c) => c.closed).length, total: held.length }];
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
    features,
    specs: [...members].map((f): PlanningHolder => ({
      ...f.holder,
      main: false,
      held: blocks.reduce((n, { claims }) => n + claims.filter((c) => !c.dropped && c.folder === f).length, 0),
    })),
  };
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
  if (input.master === null) return { features: [], milestones: [], recount: null, diagnostics: [] };
  const master = parseClaims(input.master);
  const claimById = new Map<string, Claim>();
  for (const claim of master.claims) if (!claimById.has(claim.id)) claimById.set(claim.id, claim);
  const folders = readFolders(input.specs, input.archived);
  const blocks = master.features.map((block) => resolveBlock(block, claimById, folders));
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
  const now = input.now ?? new Date().toISOString().slice(0, 10);
  const byTarget = [...parsed.milestones].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  return {
    features: blocks.map((block) => planningFeature(block, folders)),
    milestones: byTarget.map((entry) => planningMilestone(entry, blocks, folders, now)),
    recount: master.counted,
    diagnostics: [
      ...master.diagnostics.map((diagnostic) => ({ file: MASTER_FILE, diagnostic })),
      ...parsed.diagnostics.map((diagnostic) => ({ file: MASTER_FILE, diagnostic })),
      ...unknownMilestones,
    ],
  };
}
