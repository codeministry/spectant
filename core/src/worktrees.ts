// Which spec each worktree of a workspace belongs to (spec 027, ISC-174 and ISC-174.1). Spec work runs in worktrees,
// so a spec's live state sits in a worktree long before it reaches `main`; the app can only show it once it knows
// which worktree carries which spec. The server reads `git worktree list --porcelain` and hands its text here, and
// this module decides; it never runs git itself (FORMAT.md § Worktrees):
//
//   - The first record is the main checkout, the workspace root. It is no spec's worktree and is left out; every other
//     record becomes one `Worktree`, in the order git prints it, its `path` relative to the root and `/`-separated,
//     its `branch` without `refs/heads/` (null when detached). Both paths are normalised first (`.` dropped, inner `..`
//     resolved); a worktree outside the repository, a sibling `../repo-013` or a path whose `..` climbs out, carries
//     `path: null`, so its location never reaches the model or the browser (spec 041, ISC-216).
//   - A worktree under `.claude/worktrees/`, where the Agent tool puts one per sub-agent task, is a `builder`: counted
//     in `builders` and never assigned or read, so its `spec` is null whatever its branch.
//   - Every other worktree is of kind `spec`. It belongs to the spec its path `.worktrees/NNN-slug` names, else to the
//     one its branch `feature/`, `fix/`, `spike/` or `infra/` plus `NNN-slug` names. A name counts only when its `NNN`
//     is the number of one of the workspace's spec folders; a number no folder carries names nothing and raises
//     nothing. A worktree outside the repository has no `.worktrees/` path, so its branch alone decides.
//   - When path and branch name two different specs, the path wins (the folder is the newer convention; the branch may
//     be the base branch of another spec) and one `worktree-branch-mismatch` warning names the path's spec as its
//     `subject` and the record's `worktree` line as its `line`.
//   - `ahead` and `dirty` stay null: the server reads them in each spec worktree, with git, read-only (ISC-175).
//   - A spec-kind worktree git lists as `prunable` carries `prunable: true` (spec 041, ISC-212); every other worktree,
//     a builder included, carries no such key, so a listing without one builds what it built before.
//
// It also decides where a spec's files are read (ISC-181, ISC-181.1), `specSourceOf`. The server hands it the spec
// folder, the worktree assigned above (or null) and the paths `git ls-files -z -- specs/NNN-slug` printed in the main
// checkout; core never asks git and never looks at a file:
//
//   - The source is `worktree` only when the worktree is of kind `spec`, belongs to this spec, and git listed at least
//     one path under `specs/NNN-slug/`. Then the kinds in `WORKTREE_COPY_KINDS`, the whole spec folder, come from the
//     worktree's copy (spec 039, ISC-208).
//   - Everything else is `main`: no worktree, a builder, a worktree of another spec, an empty answer. A symbolic link
//     is listed as itself, `specs` or `specs/NNN-slug` without a slash after it, never as a path under the folder, so
//     an untracked or linked `specs/` keeps `main`, Spectant's own repository included.
//
// And it holds the one reading of the worktrees every caller shares (spec 041, ISC-212.1), so dashboard, spec tabs and
// their writes, library and timeline never disagree on a spec's worktree; the server builds the `WorktreeView` once
// from the listing and the git facts it read:
//
//   - `liveWorktrees` applies the rule "ended": a spec worktree of a spec has ended when its branch is merged into
//     `main`, its folder is gone, or git lists it as `prunable`. Builders and worktrees of no spec never end here.
//   - `copyDirFor` names the folder a spec is read from, `<root>/<worktree>/specs/NNN-slug`: only for the spec's first
//     live spec worktree in git's order (the one the dashboard chip shows), only inside the repository, and only when
//     `specSourceOf` names `worktree` for it. Otherwise null, and the spec reads from the main checkout.
//
// Pure and browser-safe like `planning.ts`: text in, model out, no file system, no git, no Node or Bun API. Malformed
// lines are skipped, never thrown on: a listing git did not print yields no worktrees rather than an empty page.
import type { Diagnostic } from './diagnostics.ts';
import type { FileKind, SpecSource, WarningKind, Worktree } from './files.ts';
import { SPEC_FOLDER, specIdOf } from './spec-ref.ts';

/** The worktrees of one workspace, assigned to its specs. */
export interface WorktreeAssignment {
  /** Every worktree but the main checkout, in the order git lists them, builders included. */
  readonly worktrees: readonly Worktree[];
  /** How many of them are builders under `.claude/worktrees/`. */
  readonly builders: number;
  /** One `worktree-branch-mismatch` warning per worktree whose path and branch name two different specs. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The folder of the repository that holds one worktree per spec, `.worktrees/NNN-slug`. */
const SPEC_WORKTREES = '.worktrees';

/** Where the Agent tool puts its builder worktrees, relative to the repository root. */
const BUILDER_WORKTREES = '.claude/worktrees/';

/** A spec branch: one of the four work prefixes, a slash and a spec folder name, `feature/027-worktree-live-view`. */
const SPEC_BRANCH = /^(?:feature|fix|spike|infra)\/([^/]+)$/u;

const BRANCH_REF = 'refs/heads/';

const MISMATCH = 'worktree-branch-mismatch' satisfies WarningKind;

/**
 * One record of the listing as git printed it: the absolute path, the branch, the 1-based `worktree` line, and whether
 * git marked it `prunable`.
 */
interface PorcelainRecord {
  readonly path: string;
  readonly branch: string | null;
  readonly line: number;
  readonly prunable: boolean;
}

/**
 * The records of `git worktree list --porcelain`, the main checkout first. A record starts at its `worktree <path>`
 * line; `branch refs/heads/<name>` sets its branch, `prunable` (bare or followed by git's reason) marks it prunable,
 * and every other line (`HEAD`, `detached`, `locked`, `bare`) changes nothing here.
 */
function parseRecords(porcelain: string): PorcelainRecord[] {
  const records: Array<{ path: string; branch: string | null; line: number; prunable: boolean }> = [];
  porcelain.split('\n').forEach((raw, index) => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (text.startsWith('worktree ')) {
      records.push({ path: text.slice('worktree '.length), branch: null, line: index + 1, prunable: false });
      return;
    }
    const current = records.at(-1);
    if (current === undefined) return;
    if (text.startsWith('branch ')) {
      const ref = text.slice('branch '.length);
      current.branch = ref.startsWith(BRANCH_REF) ? ref.slice(BRANCH_REF.length) : ref;
    } else if (text === 'prunable' || text.startsWith('prunable ')) {
      current.prunable = true;
    }
  });
  return records;
}

/**
 * The segments of an absolute, `/`-separated path with `.` dropped and every `..` resolved as text against the segment
 * before it, as POSIX does: `/srv/repo/a/./b/../c` is `srv`, `repo`, `a`, `c`, and a `..` at the top stays at `/`.
 */
function segments(path: string): string[] {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out;
}

/**
 * `path` relative to `root`, both absolute and `/`-separated, each normalised first (`.` dropped, inner `..` resolved):
 * `.worktrees/012-harbor` for `/srv/repo/a/../.worktrees/012-harbor`, `.` for the root itself. Null for a path outside
 * the root, `/srv/repo-013` or `/srv/repo/a/../../b` alike (spec 041, ISC-216): a location outside the repository is
 * refused, never named.
 */
export function relativeTo(root: string, path: string): string | null {
  const from = segments(root);
  const to = segments(path);
  if (to.length < from.length || from.some((part, index) => to[index] !== part)) return null;
  return to.slice(from.length).join('/') || '.';
}

/** The `NNN` a spec folder name like `012-harbor` carries, when it is one of the workspace's spec numbers. */
function knownSpec(name: string, numbers: ReadonlySet<string>): string | null {
  const id = SPEC_FOLDER.exec(name)?.[1];
  return id !== undefined && numbers.has(id) ? id : null;
}

/** The spec a worktree's path names: `.worktrees/NNN-slug` directly inside the repository. */
function specOfPath(path: string, numbers: ReadonlySet<string>): string | null {
  const parts = path.split('/');
  return parts.length === 2 && parts[0] === SPEC_WORKTREES ? knownSpec(parts[1] ?? '', numbers) : null;
}

/** The spec a branch names: `feature/`, `fix/`, `spike/` or `infra/` plus `NNN-slug`. */
function specOfBranch(branch: string | null, numbers: ReadonlySet<string>): string | null {
  const name = branch === null ? undefined : SPEC_BRANCH.exec(branch)?.[1];
  return name === undefined ? null : knownSpec(name, numbers);
}

function mismatch(record: PorcelainRecord, path: string, pathSpec: string, branchSpec: string): Diagnostic {
  return {
    severity: 'warning',
    code: MISMATCH,
    line: record.line,
    subject: pathSpec,
    message:
      `Worktree ${path} is on branch ${record.branch ?? ''}, which names spec ${branchSpec}; ` +
      `its path names spec ${pathSpec}, and the path wins.`,
  };
}

/**
 * The worktrees of a workspace from the text of `git worktree list --porcelain`, each assigned to one of `specs`, the
 * workspace's spec folder names (`NNN-slug`, matched on `NNN`), or to none.
 */
export function assignWorktrees(porcelain: string, specs: readonly string[]): WorktreeAssignment {
  const numbers = new Set(specs.map(specIdOf).filter((id) => id !== null));
  const [main, ...others] = parseRecords(porcelain);
  if (main === undefined) return { worktrees: [], builders: 0, diagnostics: [] };

  const worktrees: Worktree[] = [];
  const diagnostics: Diagnostic[] = [];
  let builders = 0;
  for (const record of others) {
    // Null outside the repository: such a worktree is no builder (those sit under `.claude/worktrees/`), has no
    // `.worktrees/` path, and is assigned by its branch alone.
    const path = relativeTo(main.path, record.path);
    if (path?.startsWith(BUILDER_WORKTREES) === true) {
      builders += 1;
      worktrees.push({ path, branch: record.branch, spec: null, ahead: null, dirty: null, kind: 'builder' });
      continue;
    }
    const pathSpec = path === null ? null : specOfPath(path, numbers);
    const branchSpec = specOfBranch(record.branch, numbers);
    if (path !== null && pathSpec !== null && branchSpec !== null && pathSpec !== branchSpec) {
      diagnostics.push(mismatch(record, path, pathSpec, branchSpec));
    }
    const spec = pathSpec ?? branchSpec;
    const base = { path, branch: record.branch, spec, ahead: null, dirty: null, kind: 'spec' } as const;
    // The key only when git printed `prunable`, so a listing without one builds exactly what it built before.
    worktrees.push(record.prunable ? { ...base, prunable: true } : base);
  }
  return { worktrees, builders, diagnostics };
}

/**
 * The branch checked out in the main checkout, the listing's first record, without `refs/heads/`: null on a detached
 * HEAD or an empty listing. The server tells by it whether a spec branch without a worktree is still worked on in the
 * main checkout (spec 027, T25, ISC-175.1).
 */
export function mainBranchOf(porcelain: string): string | null {
  return parseRecords(porcelain)[0]?.branch ?? null;
}

// ─── The read source (ISC-181, ISC-181.1) ────────────────────────────────────────────────────────────────────────

/** The folder of the repository that holds the spec folders, `specs/NNN-slug`. */
const SPECS = 'specs';

/**
 * The file kinds read from the worktree's copy `<worktree>/specs/NNN-slug/` when the source is `worktree`: every kind of
 * the spec folder. The eight ISC-181 names, `spec.md`, `plan.md`, `tasks.md`, `context.md`, `design.md`,
 * `events.jsonl`, `rounds.jsonl` and `.gates/` (both marks), and since spec 039 (ISC-208) `artifacts/` and `.evidence/`;
 * the library reads `.design/`, which is no file kind, from the copy too. Only the repository kinds stay on the main
 * checkout.
 */
export const WORKTREE_COPY_KINDS: readonly FileKind[] = [
  'spec',
  'plan',
  'tasks',
  'context',
  'design',
  'events',
  'rounds',
  'gateReviewed',
  'gateCodeReviewed',
  'artifacts',
  'evidence',
];

/** What `specSourceOf` decides on: one spec, its worktree and git's answer about its folder. */
export interface SpecSourceInput {
  /** The spec folder name, `NNN-slug`. */
  readonly folder: string;
  /** The worktree `assignWorktrees` gave the spec; null when it has none. */
  readonly worktree: Worktree | null;
  /**
   * The paths `git ls-files -z -- specs/NNN-slug` printed in the main checkout, split on NUL: relative to the
   * repository root, `/`-separated, unquoted. Empty when the folder is untracked.
   */
  readonly lsFiles: readonly string[];
}

/**
 * Where the app reads the spec's files: `worktree` only when the spec has a spec worktree of its own and git tracks a
 * path under `specs/NNN-slug/`; `main` otherwise, an untracked or symlinked `specs/` included (ISC-181.1).
 */
export function specSourceOf({ folder, worktree, lsFiles }: SpecSourceInput): SpecSource {
  const own = worktree !== null && worktree.kind === 'spec' && worktree.spec !== null && worktree.spec === specIdOf(folder);
  const under = `${SPECS}/${folder}/`;
  return own && lsFiles.some((path) => path.startsWith(under)) ? 'worktree' : 'main';
}

// ─── The worktree view (spec 041, ISC-212.1) ─────────────────────────────────────────────────────────────────────

/**
 * The git facts `liveWorktrees` decides on, read by the server in each spec worktree; core never asks git. Each list
 * holds worktree paths as `assignWorktrees` gives them (relative to the root), or branch names without `refs/heads/`.
 */
export interface WorktreeFacts {
  /** The spec branches merged into `main` (`mergedSpecBranches`, ISC-162.1). */
  readonly merged: readonly string[];
  /** The worktree paths whose folder still holds its `.git`. */
  readonly present: readonly string[];
  /**
   * The worktree paths where `git status --porcelain` printed anything. A spec worktree listed here does not end by
   * its merged branch: the uncommitted change is work the merge did not take (ISC-212.2).
   */
  readonly dirty: readonly string[];
}

/** Why a spec worktree has ended: its branch merged into `main`, its folder gone, or git lists it as `prunable`. */
export type WorktreeEnd = 'merged' | 'removed' | 'prunable';

/** A spec worktree that is no longer the spec's, with the reason. */
export interface EndedWorktree {
  readonly worktree: Worktree;
  readonly reason: WorktreeEnd;
}

/** The spec worktrees of an assignment split by the rule "ended" (`liveWorktrees`). */
export interface LiveWorktrees {
  /** Every worktree that has not ended, in git's order: builders, worktrees of no spec and live spec worktrees. */
  readonly live: readonly Worktree[];
  /** The spec worktrees of a spec that have ended, in git's order. */
  readonly ended: readonly EndedWorktree[];
}

/**
 * The one reading of a workspace's worktrees every caller shares (spec 041, ISC-212.1): dashboard, spec tabs and their
 * three writes, library and timeline. Built by the server from one `git worktree list`, `liveWorktrees` and the git
 * facts it read; `live` carries `ahead` and `dirty` of each live spec worktree.
 */
export interface WorktreeView {
  /** The listing as `assignWorktrees` assigned it, ended worktrees included. */
  readonly assignment: WorktreeAssignment;
  /** The worktrees that have not ended (`liveWorktrees`), with `ahead` and `dirty` read for the spec ones. */
  readonly live: readonly Worktree[];
  /** The spec worktrees that have ended, with the reason. */
  readonly ended: readonly EndedWorktree[];
  /** The main checkout's branch (`mainBranchOf`); null on a detached HEAD or an empty listing. */
  readonly mainBranch: string | null;
  /**
   * Per spec folder with a live spec worktree, the paths `git ls-files -z -- specs/NNN-slug` printed in the main
   * checkout (`SpecSourceInput.lsFiles`); a folder without an entry reads as untracked.
   */
  readonly tracked: Readonly<Record<string, readonly string[]>>;
}

/**
 * Splits an assignment by the rule "ended" (FORMAT.md § Worktrees): a spec worktree of a spec has ended when its
 * branch is merged into `main`, its folder is gone, or git lists it as `prunable`. When several apply, the reason is
 * the first of `merged`, `prunable`, `removed`: a merge is the strongest fact, and `prunable` is git's own word for a
 * folder or gitdir that is gone. A merge does not end a worktree whose path is in `facts.dirty`: its uncommitted change
 * is work the merge did not take, so it stays live until the change is committed or dropped, while `prunable` and
 * `removed` still end it (ISC-212.2). Builders and worktrees of no spec never end here; they are not read either way.
 */
export function liveWorktrees(assignment: WorktreeAssignment, facts: WorktreeFacts): LiveWorktrees {
  const merged = new Set(facts.merged);
  const present = new Set(facts.present);
  const dirty = new Set(facts.dirty);
  const live: Worktree[] = [];
  const ended: EndedWorktree[] = [];
  for (const worktree of assignment.worktrees) {
    const reason = worktree.kind !== 'spec' || worktree.spec === null ? null : endOf(worktree, merged, present, dirty);
    if (reason === null) live.push(worktree);
    else ended.push({ worktree, reason });
  }
  return { live, ended };
}

function endOf(
  worktree: Worktree,
  merged: ReadonlySet<string>,
  present: ReadonlySet<string>,
  dirty: ReadonlySet<string>,
): WorktreeEnd | null {
  if (worktree.branch !== null && merged.has(worktree.branch) && (worktree.path === null || !dirty.has(worktree.path))) return 'merged';
  if (worktree.prunable === true) return 'prunable';
  // A worktree outside the repository (`path` null) is never looked at; only git's `prunable` says it is gone.
  if (worktree.path !== null && !present.has(worktree.path)) return 'removed';
  return null;
}

/** The parts of a spec reference `copyDirFor` reads: its number and its folder name. */
export interface SpecFolderRef {
  /** `NNN`. */
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
}

/**
 * The absolute folder of the worktree copy a spec is read from, `<root>/<worktree>/specs/NNN-slug`, when `specSourceOf`
 * names `worktree` for the spec's first live spec worktree inside the repository; null when the spec reads from the
 * main checkout. `root` is the absolute, `/`-separated workspace root; the path is joined as text, nothing is looked at.
 */
export function copyDirFor(root: string, ref: SpecFolderRef, view: WorktreeView): string | null {
  const worktree = view.live.find((w) => w.kind === 'spec' && w.spec === ref.id) ?? null;
  if (worktree?.path == null || worktree.path === '..' || worktree.path.startsWith('../')) return null;
  const source = specSourceOf({ folder: ref.slug, worktree, lsFiles: view.tracked[ref.slug] ?? [] });
  return source === 'worktree' ? [root.replace(/\/+$/u, ''), worktree.path, SPECS, ref.slug].join('/') : null;
}

// ─── Specs only a worktree carries (spec 039, ISC-208.1) ───────────────────────────────────────────────────────────

/** A spec folder that only a live spec worktree carries: its number, its folder name and the worktree's path. */
export interface WorktreeOnlySpec {
  /** `NNN`. */
  readonly id: string;
  /** `NNN-slug`, the folder below the worktree's `specs/`. */
  readonly slug: string;
  /** The worktree's path relative to the root, `.worktrees/NNN-slug`. */
  readonly worktree: string;
}

/** The spec folder name a worktree's path `.worktrees/NNN-slug` names, else its spec branch; null for neither. */
function folderNameOf(worktree: Worktree): string | null {
  const parts = worktree.path?.split('/') ?? [];
  const byPath = parts.length === 2 && parts[0] === SPEC_WORKTREES ? (parts[1] ?? '') : '';
  if (SPEC_FOLDER.test(byPath)) return byPath;
  const byBranch = worktree.branch === null ? undefined : SPEC_BRANCH.exec(worktree.branch)?.[1];
  return byBranch !== undefined && SPEC_FOLDER.test(byBranch) ? byBranch : null;
}

/**
 * The spec folders only a spec worktree carries (FORMAT.md § Worktrees). `worktrees` is the listing as `assignWorktrees`
 * assigned it against `mainFolders`, the main checkout's spec folder names (active and archived); `tracked` holds, per
 * worktree path, what `git ls-files -z -- specs/` printed inside that worktree, split on NUL. A worktree of kind `spec`
 * that belongs to no spec, inside the repository, carries the folder its path `.worktrees/NNN-slug` (else its branch)
 * names when its own branch tracks a path below `specs/NNN-slug/`; a linked `specs/` lists itself and carries nothing
 * (ISC-181.1). A number the main checkout has stays the main checkout's, and of two worktrees naming one number the
 * first in git's order wins. In number order.
 */
export function worktreeOnlySpecs(
  worktrees: readonly Worktree[],
  mainFolders: readonly string[],
  tracked: Readonly<Record<string, readonly string[]>>,
): WorktreeOnlySpec[] {
  const taken = new Set(mainFolders.map(specIdOf).filter((id) => id !== null));
  const found = new Map<string, WorktreeOnlySpec>();
  for (const worktree of worktrees) {
    const path = worktree.path;
    if (worktree.kind !== 'spec' || worktree.spec !== null || path === null || path === '..' || path.startsWith('../')) continue;
    const slug = folderNameOf(worktree);
    const id = slug === null ? null : specIdOf(slug);
    if (slug === null || id === null || taken.has(id) || found.has(id)) continue;
    const under = `${SPECS}/${slug}/`;
    if ((tracked[path] ?? []).some((p) => p.startsWith(under))) found.set(id, { id, slug, worktree: path });
  }
  return [...found.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
