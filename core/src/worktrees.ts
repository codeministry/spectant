// Which spec each worktree of a workspace belongs to (spec 027, ISC-174 and ISC-174.1). Spec work runs in worktrees,
// so a spec's live state sits in a worktree long before it reaches `main`; the app can only show it once it knows
// which worktree carries which spec. The server reads `git worktree list --porcelain` and hands its text here, and
// this module decides; it never runs git itself (FORMAT.md § Worktrees):
//
//   - The first record is the main checkout, the workspace root. It is no spec's worktree and is left out; every other
//     record becomes one `Worktree`, in the order git prints it, its `path` relative to the root and `/`-separated
//     (`../repo-013` for one outside it), its `branch` without `refs/heads/` (null when detached).
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
//
// Pure and browser-safe like `planning.ts`: text in, model out, no file system, no git, no Node or Bun API. Malformed
// lines are skipped, never thrown on: a listing git did not print yields no worktrees rather than an empty page.
import type { Diagnostic } from './diagnostics.ts';
import type { WarningKind, Worktree } from './files.ts';
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

/** One record of the listing as git printed it: the absolute path, the branch, and the 1-based `worktree` line. */
interface PorcelainRecord {
  readonly path: string;
  readonly branch: string | null;
  readonly line: number;
}

/**
 * The records of `git worktree list --porcelain`, the main checkout first. A record starts at its `worktree <path>`
 * line; `branch refs/heads/<name>` sets its branch, and every other line (`HEAD`, `detached`, `locked`, `prunable`,
 * `bare`) changes nothing here.
 */
function parseRecords(porcelain: string): PorcelainRecord[] {
  const records: Array<{ path: string; branch: string | null; line: number }> = [];
  porcelain.split('\n').forEach((raw, index) => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (text.startsWith('worktree ')) {
      records.push({ path: text.slice('worktree '.length), branch: null, line: index + 1 });
      return;
    }
    const current = records.at(-1);
    if (current !== undefined && text.startsWith('branch ')) {
      const ref = text.slice('branch '.length);
      current.branch = ref.startsWith(BRANCH_REF) ? ref.slice(BRANCH_REF.length) : ref;
    }
  });
  return records;
}

const segments = (path: string): string[] => path.split('/').filter((part) => part !== '' && part !== '.');

/** `path` relative to `root`, both absolute and `/`-separated: `.worktrees/012-harbor`, `../repo-013`. */
function relativeTo(root: string, path: string): string {
  const from = segments(root);
  const to = segments(path);
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  const up = from.slice(common).map(() => '..');
  return [...up, ...to.slice(common)].join('/') || '.';
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
    const path = relativeTo(main.path, record.path);
    if (path.startsWith(BUILDER_WORKTREES)) {
      builders += 1;
      worktrees.push({ path, branch: record.branch, spec: null, ahead: null, dirty: null, kind: 'builder' });
      continue;
    }
    const pathSpec = specOfPath(path, numbers);
    const branchSpec = specOfBranch(record.branch, numbers);
    if (pathSpec !== null && branchSpec !== null && pathSpec !== branchSpec) {
      diagnostics.push(mismatch(record, path, pathSpec, branchSpec));
    }
    worktrees.push({ path, branch: record.branch, spec: pathSpec ?? branchSpec, ahead: null, dirty: null, kind: 'spec' });
  }
  return { worktrees, builders, diagnostics };
}
