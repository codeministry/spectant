/**
 * One registered repository read into the dashboard model (T47, ISC-16; plan 001 § Interfaces "HTTP").
 *
 * `readWorkspaceInput` reads the texts `core/` builds from: `ISA.md`, `specs/constitution.md`, `specs/tldr.md`,
 * `specs/workflow.md` (parsed by `core/`'s `parseWorkflow`, carried beside the input, T78), the story folder
 * `specs/ideas/` (every `*.md` directly in it, `README.md` the index, as `core/`'s `readIdeas` takes it, T79), the
 * viewer's actor id (`actorIdOf` over `git config --get user.email`, T80), and every text file kind
 * of every spec folder under `specs/` and `specs/archive/` (folders as `listSpecs` finds them). It
 * parses nothing: every parse is `core/`'s (ISC-5, `bun run check:single-core`). `loadDashboard` adds the local
 * services and calls `buildDashboard`; `loadCatalog` loads the library's document catalog beside it (core's
 * `readCatalog` over the same input, spec 017; `loadCatalogDocs` and `loadCatalogDoc` read the documents alone, core's
 * `readCatalogDocs` and `catalogDocAt`, ISC-156.5). The lock sources are `core/`'s `readLockSources` (T51): the repository's
 * `.spectant/activity.jsonl`, plus the LifeOS frontier locks only when a LifeOS state directory is passed (ISC-37).
 *
 * Read-only (ISC-15): `node:fs` reads, no write, no temp file, no lock. The worktree tree id for the code-reviewed mark
 * is computed in memory by `core/`'s `treeIdOf` over a file list from `git ls-files`, which reads the index and never
 * writes it or an object (`GIT_OPTIONAL_LOCKS=0` keeps even an optional index refresh off). It runs only for a
 * repository root (`.git` directly in the folder) with at least one active spec that carries a code-reviewed mark;
 * anything else, or a git that is missing or fails, is `null`, which `core/` reads as "tree id unavailable".
 * The worktrees (spec 027, ISC-175) come from `git.ts`'s read-only `worktree list`, `rev-list --count` and `status`
 * in one reading every caller shares (`readWorktreeView`, spec 041): `core/`'s `assignWorktrees` decides which spec each
 * belongs to and `liveWorktrees` which have ended. A spec with a live worktree of its own is read per spec
 * (`specSourceFor`): its code-reviewed mark compares with the tree id computed in that worktree (ISC-176), and when git
 * tracks its folder (`ls-files`, `trackedSpecPaths`) its files come from the worktree's copy (`copyDirFor`), with the
 * main checkout's copy beside them (ISC-181); both go to `core/` as `DashboardInput.perSpec`. A spec worktree whose
 * branch is merged into `main`, whose folder is gone or that git lists as `prunable` is no longer the spec's: the
 * dashboard, the spec tabs and their writes, the library and the timeline all leave it out, so no chip shows and the
 * spec reads from the main checkout again, and the timeline carries the derived entry instead (`timelineWorktreeOf`,
 * ISC-175.1, ISC-212.1).
 *
 * An unreadable workspace (gone, not a directory, no permission) is a `{readable: false, error}` value with a stable
 * code, never a throw and never the OS message, which would carry the absolute path (ISC-3).
 */
import { lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { buildDashboard, devServiceLabels, toLocalService } from "../../core/src/dashboard.ts";
import type { DashboardInput, DashboardModel, ProbedService } from "../../core/src/dashboard.ts";
import { actorIdOf } from "../../core/src/actor-id.ts";
import { FILE_KINDS, repoFilePath } from "../../core/src/files.ts";
import type { FileDiagnostic, IdeaFiles, LibraryCatalog, LibraryDoc, MergeState, SpecFiles, SpecRead, TextFileKind, TimelineWorktreeInput, Workflow, Worktree } from "../../core/src/files.ts";
import { parseFrontmatter } from "../../core/src/frontmatter.ts";
import { specIdOf } from "../../core/src/spec-ref.ts";
import { type TreeEntry, type TreeEntryMode, treeIdOf } from "../../core/src/gates.ts";
import { catalogDocAt, readCatalog, readCatalogDocs } from "../../core/src/library.ts";
import { readLockSources } from "../../core/src/locks.ts";
import { type SpecRef, listSpecs } from "../../core/src/resolve.ts";
import { parseWorkflow } from "../../core/src/workflow.ts";
import { WORKTREE_COPY_KINDS, type WorktreeView, assignWorktrees, copyDirFor, liveWorktrees, mainBranchOf } from "../../core/src/worktrees.ts";
import { type SpecBranch, aheadOfMain, dirty, mergeCommitOf, mergedSpecBranches, trackedSpecPaths, userEmail, worktreeList } from "./git.ts";

/** Why a workspace cannot be read. Stable codes: the web app maps them to its own words. */
export type UnreadableCode = "missing" | "not-a-directory" | "permission-denied" | "unreadable";

/**
 * A readable workspace: the model's input, the workflow table (T78, ISC-122; the default table when `specs/workflow.md`
 * is missing) and the reading's own findings, each under its repository-relative file name. The input carries the
 * same workflow (`DashboardInput.workflow`), which decides row 7 of the stage table (`close-pending`, spec 008 T49).
 * `ideas` is the story folder for `buildPlanning` (T79; `DashboardInput` has no field for it, so it rides beside the
 * input as `workflow` does); `viewer` is the viewer's `u:` id, null without a configured git address (T80). `copies`
 * names, per active spec read from its worktree's copy (spec 027, ISC-181), the absolute folder of that copy, so the
 * spec page hashes the same bytes it rendered; server-internal, it never reaches a response (ISC-3).
 */
export type WorkspaceReading =
  | {
      readable: true;
      input: DashboardInput;
      workflow: Workflow;
      ideas: IdeaFiles;
      viewer: string | null;
      diagnostics: readonly FileDiagnostic[];
      copies: Readonly<Record<string, string>>;
      /**
       * One merge state per spec number, active and archived (spec 025, ISC-162.1; `mergeStateOf`): what `core/`'s
       * `resolveEdges` takes. The same rows ride in `input.mergeState`, where the dashboard's stage reads them (T14).
       */
      mergeState: readonly MergeState[];
    }
  | { readable: false; error: UnreadableCode };

export type DashboardLoad = { readable: true; model: DashboardModel } | { readable: false; error: UnreadableCode };

/**
 * The document catalog of one workspace (spec 017), or why the workspace cannot be read. `copies` are the worktree
 * copies the catalog read its specs' own files from (`WorkspaceReading.copies`, spec 027, ISC-181), so the reader opens
 * the same file; server-internal, never part of a response (ISC-3), absent from a loader that names none.
 */
export type CatalogLoad =
  | { readable: true; catalog: LibraryCatalog; copies?: Readonly<Record<string, string>> }
  | { readable: false; error: UnreadableCode };

/** The local listeners of one workspace, given its root and the constitution's port labels. */
export type ServicesProbe = (repoRoot: string, labels: ReadonlyMap<number, string>) => Promise<readonly ProbedService[]>;

/** The kinds that live inside a spec folder; master and constitution are read once per workspace. */
const FOLDER_KINDS = (Object.keys(FILE_KINDS) as Array<keyof typeof FILE_KINDS>).filter(
  (kind): kind is TextFileKind => !FILE_KINDS[kind].directory && !FILE_KINDS[kind].path.startsWith(".."),
);

/** The workflow table's repository-relative name, the `file` of its findings: never the absolute path (ISC-3). */
const WORKFLOW_FILE = repoFilePath("", "workflow");

/** A read failure, carried up to the workspace as its code. */
class Unreadable extends Error {
  constructor(readonly code: UnreadableCode) {
    super(code);
  }
}

function codeOf(error: unknown): UnreadableCode {
  if (error instanceof Unreadable) return error.code;
  switch ((error as NodeJS.ErrnoException | null)?.code) {
    case "ENOENT":
      return "missing";
    case "ENOTDIR":
      return "not-a-directory";
    case "EACCES":
    case "EPERM":
      return "permission-denied";
    default:
      return "unreadable";
  }
}

/** The file's text, or null when it does not exist. Any other failure (permission, a directory) propagates. */
export function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The story folder `specs/ideas/` of the workspace at `root` as `readIdeas` takes it: every regular `*.md` file directly
 * in it, file name to text (`README.md` included, the index). A missing folder is an empty record; any other read
 * failure propagates. Which names are stories is `readIdeas`'s decision, not this one's.
 */
export function readIdeaFiles(root: string): IdeaFiles {
  const dir = repoFilePath(root, "idea");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const files: Record<string, string> = {};
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const path = join(dir, name);
    if (statSync(path).isFile()) files[name] = readFileSync(path, "utf8");
  }
  return files;
}

/** The viewer's actor id (`u:` + hash of `user.email`, core's `actorIdOf`), or null when no address is configured. */
export async function viewerActorOf(root: string): Promise<string | null> {
  const email = await userEmail(root);
  return email === null ? null : actorIdOf(email);
}

/**
 * One `MergeState` per spec number of the workspace (spec 025, T10, ISC-162.1), active folders first, then archived
 * ones, the first folder of a number winning as in `core/`'s `resolveEdges`. `branches` are `git.ts`'s
 * `mergedSpecBranches`: the spec's branch is the one with its number, the merged one when several carry it (the first
 * by name otherwise), and `merged` holds when any does; without one, `branch` is null and `merged` false. `complete`
 * is `phase: complete` in the frontmatter (core's `parseFrontmatter`), `archived` the folder's place. A failed git read
 * hands in no branch, so every row reads as branchless and `core/` decides by `complete` and `archived`.
 */
export function mergeStateOf(specs: readonly SpecFiles[], archived: readonly SpecFiles[], branches: readonly SpecBranch[]): MergeState[] {
  const rows: MergeState[] = [];
  const seen = new Set<string>();
  const add = (files: SpecFiles, inArchive: boolean): void => {
    const spec = specIdOf(files.folder);
    if (spec === null || seen.has(spec)) return;
    seen.add(spec);
    const own = branches.filter((b) => b.spec === spec);
    const branch = own.find((b) => b.merged) ?? own[0];
    const complete = files.texts.spec !== undefined && parseFrontmatter(files.texts.spec).data.phase === "complete";
    rows.push({ spec, branch: branch?.branch ?? null, merged: branch?.merged ?? false, complete, archived: inArchive });
  };
  for (const files of specs) add(files, false);
  for (const files of archived) add(files, true);
  return rows;
}

function specFiles(dir: string, folder: string): SpecFiles {
  const texts: Partial<Record<TextFileKind, string>> = {};
  for (const kind of FOLDER_KINDS) {
    const text = readIfExists(join(dir, FILE_KINDS[kind].path));
    if (text !== null) texts[kind] = text;
  }
  return { folder, texts };
}

// ── one spec folder (spec routes, T45) ─────────────────────────────────────────────────────────────

/**
 * The texts of one spec folder, as `readWorkspaceInput` reads each folder: `folder` is the folder name (`NNN-slug`),
 * the constitution and the master are not included. A missing file is an absent key; any other read failure throws,
 * and `unreadableCode` turns it into the workspace's code.
 */
export function readSpecFiles(ref: Pick<SpecRef, "dir" | "slug">): SpecFiles {
  return specFiles(ref.dir, ref.slug);
}

/** A file's raw bytes, or null when it does not exist; any other failure throws. For hashes over exact bytes. */
export function readBytesIfExists(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The code of a workspace that cannot be read at `root`, or null when it is a readable directory. */
export function workspaceUnreadable(root: string): UnreadableCode | null {
  try {
    if (!statSync(root).isDirectory()) return "not-a-directory";
    readdirSync(root);
    return null;
  } catch (error) {
    return codeOf(error);
  }
}

/** The stable code of a read failure (ENOENT, EACCES, …), never the OS message, which names the path (ISC-3). */
export function unreadableCode(error: unknown): UnreadableCode {
  return codeOf(error);
}

/**
 * Reads the workspace at `root` into the model's input, without services. The lock sources come from `core/`'s
 * `readLockSources`: the repository's `.spectant/activity.jsonl` always, the LifeOS frontier locks only with a
 * `lifeosStateDir` (T51, ISC-37). Without one, no path outside `root` is read.
 */
export async function readWorkspaceInput(root: string, lifeosStateDir: string | null = null): Promise<WorkspaceReading> {
  try {
    if (!statSync(root).isDirectory()) throw new Unreadable("not-a-directory");
    readdirSync(root); // a directory without read permission fails here, not as an empty workspace
    const specs: SpecFiles[] = [];
    const archived: SpecFiles[] = [];
    const perSpec: Record<string, SpecRead> = {};
    const copies: Record<string, string> = {};
    const refs = listSpecs(root);
    const { view, branches } = await readWorktreeView(root, refs);
    const worktrees = view.live.length === 0 ? undefined : { ...view.assignment, worktrees: view.live };
    for (const ref of refs) {
      const main = specFiles(ref.dir, ref.slug);
      if (ref.archived) {
        archived.push(main);
        continue;
      }
      const source = await specSourceFor(root, ref, main, view);
      specs.push(source.files);
      if (source.read !== null) perSpec[ref.slug] = source.read;
      if (source.copy !== null) copies[ref.slug] = source.copy;
    }
    // The main checkout's tree only where a marked spec compares with it: one without a tree of its own (ISC-176).
    const reviewed = specs.some((f) => f.texts.gateCodeReviewed !== undefined && perSpec[f.folder]?.tree === undefined);
    const workflow = parseWorkflow(readIfExists(repoFilePath(root, "workflow")));
    const mergeState = mergeStateOf(specs, archived, branches);
    return {
      readable: true,
      workflow,
      ideas: readIdeaFiles(root),
      viewer: await viewerActorOf(root),
      diagnostics: workflow.diagnostics.map((diagnostic) => ({ file: WORKFLOW_FILE, diagnostic })),
      copies,
      mergeState,
      input: {
        master: readIfExists(join(root, "ISA.md")),
        constitution: readIfExists(join(root, "specs", "constitution.md")),
        tldr: readIfExists(join(root, "specs", "tldr.md")),
        specs,
        archived,
        worktreeTree: reviewed ? await worktreeTreeId(root) : null,
        ...(worktrees === undefined ? {} : { worktrees }),
        ...(Object.keys(perSpec).length === 0 ? {} : { perSpec }),
        locks: await readLockSources({ repoRoot: root, lifeosStateDir }),
        workflow,
        mergeState,
      },
    };
  } catch (error) {
    return { readable: false, error: codeOf(error) };
  }
}

// ── the worktrees (spec 027) ─────────────────────────────────────────────────────────────────────────

/** The worktree view of a workspace and the spec branches it was decided on (`readWorktreeView`). */
export interface WorktreeReading {
  readonly view: WorktreeView;
  /** Every local spec branch with its merge state (`mergedSpecBranches`, ISC-162.1). */
  readonly branches: readonly SpecBranch[];
}

/**
 * The one reading of the worktrees of the workspace at `root` (spec 041, ISC-212.1) that the dashboard, the spec tabs
 * with their three writes, the library and the timeline share: `git worktree list --porcelain` once, assigned to every
 * spec folder of `refs` (active and archived) by `core/`'s `assignWorktrees`, split by `core/`'s `liveWorktrees` into
 * live and ended worktrees on the merge state of the spec branches and on whether each folder still holds its `.git`.
 * Each live spec worktree of a spec gets the chip's two git facts, read inside it: `ahead` (`rev-list --count
 * main..<branch>`) and `dirty` (`status --porcelain`); a builder and a worktree of no spec keep their nulls. For each
 * live spec worktree inside the repository, `tracked` holds what `git ls-files -z -- specs/<folder>` printed in the
 * main checkout for the spec's active folder, `copyDirFor`'s input. Every git call goes through `git.ts`: read-only,
 * no fetch, `GIT_OPTIONAL_LOCKS=0`. A listing with nothing beside the main checkout yields an empty view, as before
 * spec 027.
 */
export async function readWorktreeView(root: string, refs: readonly SpecRef[] = listSpecs(root)): Promise<WorktreeReading> {
  const [porcelain, merge] = await Promise.all([worktreeList(root), mergedSpecBranches(root)]);
  const assignment = assignWorktrees(porcelain, refs.map((ref) => ref.slug));
  // A worktree's folder, joined to the root; null for one outside the repository, whose location core never names.
  const folderOf = (w: Worktree): string | null => (w.path === null ? null : join(root, w.path));
  const ofSpec = assignment.worktrees.filter((w) => w.kind === "spec" && w.spec !== null);
  const merged = merge.branches.filter((b) => b.merged).map((b) => b.branch);
  const present = ofSpec.flatMap((w) => {
    const folder = folderOf(w);
    return folder !== null && w.path !== null && hasGit(folder) ? [{ worktree: w, path: w.path, folder }] : [];
  });
  // A merged worktree still holding uncommitted work stays the spec's (ISC-212.2): only those are asked here.
  const mergedPresent = present.filter(({ worktree: w }) => w.branch !== null && merged.includes(w.branch));
  const dirtyMerged = await Promise.all(mergedPresent.map(({ folder }) => dirty(folder)));
  const facts = {
    merged,
    present: present.map(({ path }) => path),
    dirty: mergedPresent.filter((_, i) => dirtyMerged[i] === true).map(({ path }) => path),
  };
  const split = liveWorktrees(assignment, facts);
  const live: Worktree[] = [];
  const tracked: Record<string, readonly string[]> = {};
  for (const worktree of split.live) {
    if (worktree.kind !== "spec" || worktree.spec === null) {
      live.push(worktree);
      continue;
    }
    // Outside the repository only `ahead` is read, in the main checkout: the branch names the commits, no folder is read.
    const folder = folderOf(worktree);
    const [ahead, changed] = await Promise.all([aheadOfMain(folder ?? root, worktree.branch), folder === null ? null : dirty(folder)]);
    live.push({ ...worktree, ahead, dirty: changed });
    const ref = refs.find((r) => !r.archived && r.id === worktree.spec);
    if (ref !== undefined && worktree.path !== null && insideRepository(worktree.path) && tracked[ref.slug] === undefined) {
      tracked[ref.slug] = await trackedSpecPaths(root, ref.slug);
    }
  }
  const view: WorktreeView = { assignment, live, ended: split.ended, mainBranch: mainBranchOf(porcelain), tracked };
  return { view, branches: merge.branches };
}

/**
 * The timeline's `worktree` input for the spec folder `folder` at `root` (spec 027, T25, ISC-175.1), from git alone:
 *
 * The spec's branches are those named for it and those its worktrees carry, as the whole workspace assigns them, so the
 * path wins over the branch here too (ISC-174.1, ISC-212.1); `reading` is the caller's `readWorktreeView`, read anew
 * when absent.
 *
 * - null while a live worktree carries the spec, on whatever branch, a merged one with uncommitted work included
 *   (ISC-212.2), and when the spec has no branch (nothing to say).
 * - `merged` when one of the spec's branches is merged into `main` (`mergedSpecBranches`, ISC-162.1), dated by its merge
 *   commit (`mergeCommitOf`); a merge commit git cannot name gives no entry rather than an undated one. A merged branch
 *   with a worktree is preferred, and branch and path always come from that one worktree (ISC-212.2).
 * - `removed` when the spec has a branch, none merged: the path and branch of the worktree git still lists for it, if
 *   any. A branch checked out in the main checkout is worked on there and counts as open. A branch that never had a
 *   worktree reads as removed too (principal, 2026-10-14): spec work runs in a worktree of its own.
 *
 * Nothing is written: the entry is derived on every read, `events.jsonl` stays byte-identical.
 */
export async function timelineWorktreeOf(root: string, folder: string, reading?: WorktreeReading): Promise<TimelineWorktreeInput | null> {
  const spec = specIdOf(folder);
  if (spec === null) return null;
  const { view, branches } = reading ?? (await readWorktreeView(root));
  // The spec's worktrees as the whole workspace assigns them, so the path wins over the branch (ISC-174.1).
  const mine = view.assignment.worktrees.filter((w) => w.kind === "spec" && w.spec === spec);
  const own = branches.filter((b) => b.spec === spec || mine.some((w) => w.branch === b.branch));
  // A live worktree of the spec, on whatever branch, means the spec is still worked on: no entry (ISC-212.2).
  if (own.length === 0 || view.live.some((w) => w.kind === "spec" && w.spec === spec)) return null;
  // Branch and path always come from one worktree when the spec has one for the branch (ISC-212.2).
  const worktreeOf = (branch: string): Worktree | undefined => mine.find((w) => w.branch === branch);
  const mergedOwn = own.filter((b) => b.merged);
  const merged = mergedOwn.find((b) => worktreeOf(b.branch) !== undefined) ?? mergedOwn[0];
  if (merged !== undefined) {
    const commit = await mergeCommitOf(root, merged.branch);
    if (commit === null) return null;
    return { merged: commit, removed: false, branch: merged.branch, path: worktreeOf(merged.branch)?.path ?? null };
  }
  if (own.some((b) => b.branch === view.mainBranch)) return null;
  const listed = mine.find((w) => w.branch !== null && own.some((b) => b.branch === w.branch)) ?? mine[0];
  if (listed !== undefined) return { merged: null, removed: true, branch: listed.branch, path: listed.path };
  return { merged: null, removed: true, branch: own[0]?.branch ?? null, path: null };
}

/** How the loader read one active spec (spec 027): its files, the `SpecRead` beside them, and the copy's folder. */
interface SpecSourceReading {
  /** The spec's files: the worktree copy's for `WORKTREE_COPY_KINDS` when the source is `worktree`, else main's. */
  readonly files: SpecFiles;
  /** What `core/` gets in `perSpec` / `read`; null when there is nothing to say (no worktree, no mark). */
  readonly read: SpecRead | null;
  /** The absolute folder of the worktree copy when the source is `worktree`, else null; never leaves the server. */
  readonly copy: string | null;
}

/** A worktree path inside the repository: the only ones whose files are read (plan 027 § Risks, external paths). */
export const insideRepository = (path: string): boolean => !isAbsolute(path) && path !== ".." && !path.startsWith("../");

/** Whether `path` holds its own `.git` (a linked worktree's is a file): a worktree git lists but that is gone is not read. */
function hasGit(path: string): boolean {
  try {
    lstatSync(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * The spec folder read from two places: the kinds of `WORKTREE_COPY_KINDS` from the worktree's copy `copyDir`, every
 * other kind of the folder from the main checkout's `mainDir` (FORMAT.md § Worktrees).
 */
function copyFiles(mainDir: string, copyDir: string, folder: string): SpecFiles {
  const texts: Partial<Record<TextFileKind, string>> = {};
  for (const kind of FOLDER_KINDS) {
    const text = readIfExists(join(WORKTREE_COPY_KINDS.includes(kind) ? copyDir : mainDir, FILE_KINDS[kind].path));
    if (text !== null) texts[kind] = text;
  }
  return { folder, texts };
}

/**
 * How one active spec is read (spec 027, T20 and T21): `main`, its files as read from the main checkout, unless it has
 * a worktree of kind `spec` of its own (the first in git's order, as the row's chip), inside the repository and present.
 * Then the read source is `core/`'s `specSourceOf` over `git ls-files -z -- specs/<folder>` in the main checkout
 * (`trackedSpecPaths`): with `worktree` the copy kinds come from `<worktree>/specs/<folder>/` and `main` rides beside
 * them in `read.main`; a copy without a `spec.md` stays on main, so a spec never vanishes from the board (ISC-181). The
 * code-reviewed mark of the files so read compares with the tree id computed in that worktree, `read.tree` (ISC-176);
 * without a mark no tree is computed, nor with `withTree` false (the library's reader needs the copy alone). A spec
 * without such a worktree has no `read` and keeps the workspace's defaults.
 */
async function specSourceFor(
  root: string,
  ref: Pick<SpecRef, "id" | "slug" | "dir">,
  main: SpecFiles,
  view: WorktreeView,
  withTree = true,
): Promise<SpecSourceReading> {
  const worktree = view.live.find((w) => w.kind === "spec" && w.spec === ref.id) ?? null;
  if (worktree?.path == null || !insideRepository(worktree.path)) return { files: main, read: null, copy: null };
  const at = join(root, worktree.path);
  const copyDir = copyDirFor(root, ref, view);
  const copy = copyDir === null ? null : copyFiles(ref.dir, copyDir, ref.slug);
  const files = copy?.texts.spec === undefined ? main : copy;
  const read: SpecRead = {
    ...(files === main ? {} : { source: "worktree" as const, main }),
    ...(!withTree || files.texts.gateCodeReviewed === undefined ? {} : { tree: await worktreeTreeId(at) }),
  };
  return { files, read: Object.keys(read).length === 0 ? null : read, copy: files === main ? null : copyDir };
}

/**
 * One spec's files from its read source, for the routes that read a single spec (the spec page's tabs): the same
 * decision `readWorkspaceInput` makes per spec, so a tab never reads another copy than the row and the head (ISC-181).
 * `dir` is the folder the copy kinds were read from (the worktree copy's, or the main checkout's `ref.dir`). `reading` is the
 * caller's `readWorktreeView`, read anew when absent.
 */
export async function readSpecSource(root: string, ref: SpecRef, reading?: WorktreeReading): Promise<{ files: SpecFiles; dir: string }> {
  const main = specFiles(ref.dir, ref.slug);
  if (ref.archived) return { files: main, dir: ref.dir };
  const { view } = reading ?? (await readWorktreeView(root));
  const source = await specSourceFor(root, ref, main, view);
  return { files: source.files, dir: source.copy ?? ref.dir };
}

/**
 * The worktree copies of the workspace at `root` (spec 027, ISC-181): per active spec read from its worktree's copy,
 * the copy's absolute folder, by the per-spec decision `readWorkspaceInput` makes (`specSourceFor`), without the tree
 * ids and the chip's git facts: one `git worktree list`, one `git ls-files` per spec worktree, no hash. Empty when no
 * spec has a worktree. For the library's reader and search, which need the documents and never a stage.
 */
async function readCopies(root: string): Promise<Record<string, string>> {
  const refs = listSpecs(root);
  const { view } = await readWorktreeView(root, refs);
  const copies: Record<string, string> = {};
  for (const ref of refs) {
    if (ref.archived || !view.live.some((w) => w.kind === "spec" && w.spec === ref.id)) continue;
    const source = await specSourceFor(root, ref, specFiles(ref.dir, ref.slug), view, false);
    if (source.copy !== null) copies[ref.slug] = source.copy;
  }
  return copies;
}

/**
 * The dashboard model of the workspace at `root`. With a `probe`, its listeners become the model's services, labelled
 * from the constitution's `dev_services:`; with `null` the services are empty (the workspace list needs counts only).
 * `lifeosStateDir` as for `readWorkspaceInput`.
 */
export async function loadDashboard(root: string, probe: ServicesProbe | null, lifeosStateDir: string | null = null): Promise<DashboardLoad> {
  const reading = await readWorkspaceInput(root, lifeosStateDir);
  if (!reading.readable) return reading;
  const { input } = reading;
  const labels = input.constitution === null ? new Map<number, string>() : devServiceLabels(input.constitution);
  const probed = probe === null ? [] : await probe(root, labels).catch(() => []);
  return { readable: true, model: buildDashboard({ ...input, services: probed.map((s) => toLocalService(s, labels)) }) };
}

/**
 * The document catalog of the workspace at `root` (spec 017 T14, ISC-156), loaded beside the model: core's
 * `readCatalog` as it is, metadata only, never a file's content. Nothing is cached, as for the model: each call reads
 * the files again, and every entry carries its `modified` time and title, so the route's body-hash ETag (`api.ts`
 * `json()`) changes with any edited, added or removed document and the web's polling revalidates to a 304 otherwise.
 * `readCatalog` reads a missing folder as an empty catalog, so the workspace root is checked first: a workspace that
 * cannot be read is its stable code, never an empty catalog. Read-only, like every load here.
 *
 * The group heads' stages come from the dashboard's own input (`readWorkspaceInput` with the same `lifeosStateDir`,
 * worktree tree id and lock sources included), so a spec with a fresh code-reviewed mark stands at `close` in the
 * library exactly as on the dashboard (spec 017 T13, ISC-157). A spec's own files come from the read source the reading
 * chose (`reading.copies`, spec 027, ISC-181), so the library lists the documents the spec page renders.
 */
export async function loadCatalog(root: string, lifeosStateDir: string | null = null): Promise<CatalogLoad> {
  const reading = await readWorkspaceInput(root, lifeosStateDir);
  if (!reading.readable) return reading;
  try {
    return { readable: true, catalog: await readCatalog(root, reading.input, { copies: reading.copies }), copies: reading.copies };
  } catch (error) {
    return { readable: false, error: codeOf(error) };
  }
}

/**
 * What the library's reader and search read with the worktree copies: a value of `read`, or why the workspace cannot
 * be read. The copies are the read sources `loadCatalog` lists the documents from (spec 027, ISC-181).
 */
export type CopiesLoad<T> = ({ readable: true; copies: Readonly<Record<string, string>> } & T) | { readable: false; error: UnreadableCode };

/**
 * `read` over the worktree copies of the workspace at `root`, without the dashboard's reading (ISC-156.5): no stage
 * input, workflow, lock source, worktree hash or chip git fact, and never `buildDashboard`. A workspace that cannot be
 * read is its stable code, checked first, as in `loadCatalog`.
 */
async function withCopies<T>(root: string, read: (copies: Readonly<Record<string, string>>) => Promise<T>): Promise<CopiesLoad<T>> {
  const unreadable = workspaceUnreadable(root);
  if (unreadable !== null) return { readable: false, error: unreadable };
  try {
    const copies = await readCopies(root);
    return { readable: true, copies, ...(await read(copies)) };
  } catch (error) {
    return { readable: false, error: codeOf(error) };
  }
}

/**
 * The catalog's documents alone, for the search (`librarySearch`): core's `readCatalogDocs`, equal to the catalog's
 * `docs`, without its group heads and the dashboard model they need. Only the worktree copies are read (`readCopies`),
 * so a spec's own documents come from the same read source as in `loadCatalog`.
 */
export function loadCatalogDocs(root: string): Promise<CopiesLoad<{ docs: readonly LibraryDoc[] }>> {
  return withCopies(root, async (copies) => ({ docs: await readCatalogDocs(root, { copies }) }));
}

/**
 * The one catalog document at `path` (relative to `specs/`), for the reader (`libraryDoc`): core's `catalogDocAt`,
 * equal to the catalog's entry, null where the catalog lists none and for a null `path` (a query that does not decode).
 * Only the folders on the path's way are read, never the tree.
 */
export function loadCatalogDoc(root: string, path: string | null): Promise<CopiesLoad<{ doc: LibraryDoc | null }>> {
  return withCopies(root, async (copies) => ({ doc: path === null ? null : await catalogDocAt(root, path, { copies }) }));
}

// ── the worktree tree id ──────────────────────────────────────────────────────────────────────────────

/**
 * The paths `git add -A` would stage: tracked and untracked, `.gitignore`, `info/exclude` and the global excludes applied.
 * `ls-files` runs the repository's fsmonitor hook, so it is switched off (spec 041, ISC-216.2).
 */
async function listedPaths(root: string): Promise<string[] | null> {
  const git = Bun.which("git", { PATH: process.env.PATH ?? "" });
  if (!git) return null;
  const child = Bun.spawn([git, "-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) return null;
  // Unmerged paths list once per stage; an untracked nested repository lists as `dir/` and is no file.
  return [...new Set(stdout.split("\0"))].filter((path) => path !== "" && !path.endsWith("/"));
}

/** One listed path as git would store it, or null when it is gone from the worktree or is no file (a submodule). */
function entryFor(root: string, path: string): TreeEntry | null {
  const absolute = join(root, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; // deleted: `git add -A` drops it
    throw error;
  }
  let mode: TreeEntryMode;
  let bytes: Uint8Array;
  if (stat.isSymbolicLink()) {
    mode = "120000";
    bytes = readlinkSync(absolute, { encoding: "buffer" });
  } else if (stat.isFile()) {
    mode = (stat.mode & 0o100) !== 0 ? "100755" : "100644";
    bytes = readFileSync(absolute);
  } else {
    return null;
  }
  return { path, mode, bytes };
}

/**
 * The git tree id of the worktree at `root`, as `git add -A && git write-tree` would print it, computed in memory.
 * Null when `root` is not a repository root, git is missing or fails, or a file cannot be read. Clean filters
 * (`core.autocrlf`, LFS) and submodules are not applied, so such a repository reads as changed, never as reviewed.
 */
export async function worktreeTreeId(root: string): Promise<string | null> {
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return null;
  }
  try {
    const paths = await listedPaths(root);
    if (paths === null) return null;
    return treeIdOf(paths.flatMap((path) => entryFor(root, path) ?? []));
  } catch {
    return null;
  }
}
