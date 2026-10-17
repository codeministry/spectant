// Where the app reads one repository file (spec 039, ISC-209, ISC-209.1): `ISA.md`, `specs/constitution.md`,
// `specs/tldr.md`, `specs/workflow.md`, `specs/tech.md` and each story under `specs/ideas/`. Spec work runs in spec
// worktrees, so with a tracked `specs/` the newest version of such a file often sits in one of them before the merge.
// The server reads the facts, per candidate: the main checkout and each live spec worktree inside the repository,
// whether the file is there, whether that checkout's branch tracks it, whether its bytes differ from the main
// checkout's, their digest, and when it last changed (FORMAT.md § Worktrees). This module decides; it never runs git
// and never looks at a file:
//
//   - A file the main checkout holds but does not track stays the main checkout's: an untracked or linked `specs/`,
//     Spectant's own repository included, never changes its read source (ISC-181.1, ISC-210).
//   - A worktree competes only with a version that is present, tracked by its branch, differs from the main checkout's
//     and has a time. The newest of them is read when it is newer than the main checkout's own time; on a tie, or when
//     none competes, the main checkout's.
//   - When the competing versions are not all the same bytes, two worktrees changed the file differently: one warning
//     `worktree-file-conflict` names every competing worktree, and the newest version is still read (ISC-209.1).
//
// Pure and browser-safe: facts in, decision out, no file system, no git, no Node or Bun API.
import type { Diagnostic } from './diagnostics.ts';
import type { RepoFileSource } from './files.ts';

/**
 * The code of the warning two or more spec worktrees with different versions of one repository file raise (ISC-209.1):
 * a workspace diagnostic of the file, never a spec row's warning, since the file belongs to no spec.
 */
export const WORKTREE_FILE_CONFLICT = 'worktree-file-conflict';

/** The main checkout as a source. */
export const MAIN_SOURCE: RepoFileSource = { kind: 'main' };

/** One place a repository file can be read from, with the facts the server read there. */
export interface RepoFileCandidate {
  /** The main checkout, or a spec worktree by its path relative to the root. */
  readonly origin: RepoFileSource;
  /** Whether the file exists there. */
  readonly present: boolean;
  /** Whether that checkout's branch tracks the file (`git ls-files`). */
  readonly tracked: boolean;
  /** Whether its bytes differ from the main checkout's (a file the main checkout lacks differs); false for main. */
  readonly differs: boolean;
  /** A digest of its bytes, so two worktrees' versions compare; null when absent. */
  readonly digest: string | null;
  /**
   * When it last changed, ISO 8601: its mtime when `git status` there lists it as changed, else the last commit there
   * that touched it; null when neither is known.
   */
  readonly at: string | null;
}

/** The decision for one repository file: where it is read, and the warnings it raises. */
export interface RepoFileDecision {
  readonly source: RepoFileSource;
  /** At most one `worktree-file-conflict` warning (ISC-209.1). */
  readonly diagnostics: readonly Diagnostic[];
}

/** Where the repository file at `path` (relative to the root) is read, from the candidates the server read. */
export function repoFileSourceOf(path: string, candidates: readonly RepoFileCandidate[]): RepoFileDecision {
  const main = candidates.find((c) => c.origin.kind === 'main');
  // Held by the main checkout without being tracked: an untracked or linked `specs/` keeps its source (ISC-181.1).
  if (main?.present === true && !main.tracked) return { source: MAIN_SOURCE, diagnostics: [] };
  const contenders = candidates.filter((c) => c.origin.kind === 'worktree' && c.present && c.tracked && c.differs && timeOf(c) !== null);
  // The newest; on equal times the first in the caller's order (git's order of the worktrees).
  const newest = contenders.reduce<RepoFileCandidate | null>((best, c) => (best === null || (timeOf(c) ?? 0) > (timeOf(best) ?? 0) ? c : best), null);
  const mainTime = main === undefined ? null : timeOf(main);
  const source = newest === null || (mainTime !== null && mainTime >= (timeOf(newest) ?? 0)) ? MAIN_SOURCE : newest.origin;
  return { source, diagnostics: conflictOf(path, contenders) };
}

/** One `worktree-file-conflict` when the competing versions are not all the same bytes; none otherwise (ISC-209.1). */
function conflictOf(path: string, contenders: readonly RepoFileCandidate[]): Diagnostic[] {
  if (new Set(contenders.map((c) => c.digest)).size < 2) return [];
  const names = contenders.map((c) => (c.origin.kind === 'worktree' ? c.origin.worktree : 'main')).join(', ');
  return [
    {
      severity: 'warning',
      code: WORKTREE_FILE_CONFLICT,
      subject: path,
      message: `${path} differs between the spec worktrees ${names}; the newest version is read.`,
    },
  ];
}

/** A candidate's time in ms, or null without a parsable one. */
function timeOf(candidate: RepoFileCandidate): number | null {
  const ms = candidate.at === null ? Number.NaN : Date.parse(candidate.at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The repository files whose read source `repoFileSourceOf` decides, relative to the root, as git pathspecs:
 * `specs/ideas/` stands for every story directly in it (spec 039, ISC-209).
 */
export const REPO_SOURCE_PATHS: readonly string[] = ['ISA.md', 'specs/constitution.md', 'specs/tldr.md', 'specs/workflow.md', 'specs/tech.md', 'specs/ideas/'];
