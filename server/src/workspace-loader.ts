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
 * `readCatalog` over the same input, spec 017; `loadCatalogDocs` without it). The lock sources are `core/`'s `readLockSources` (T51): the repository's
 * `.spectant/activity.jsonl`, plus the LifeOS frontier locks only when a LifeOS state directory is passed (ISC-37).
 *
 * Read-only (ISC-15): `node:fs` reads, no write, no temp file, no lock. The worktree tree id for the code-reviewed mark
 * is computed in memory by `core/`'s `treeIdOf` over a file list from `git ls-files`, which reads the index and never
 * writes it or an object (`GIT_OPTIONAL_LOCKS=0` keeps even an optional index refresh off). It runs only for a
 * repository root (`.git` directly in the folder) with at least one active spec that carries a code-reviewed mark;
 * anything else, or a git that is missing or fails, is `null`, which `core/` reads as "tree id unavailable".
 * The worktrees (spec 027, ISC-175) come from `git.ts`'s read-only `worktree list`, `rev-list --count` and `status`
 * (`readWorktrees`); `core/`'s `assignWorktrees` decides which spec each belongs to. A spec with a worktree of its own
 * is read per spec (`specSourceFor`): its code-reviewed mark compares with the tree id computed in that worktree
 * (ISC-176), and when git tracks its folder (`ls-files`, `trackedSpecPaths`) its files come from the worktree's copy,
 * with the main checkout's copy beside them (ISC-181); both go to `core/` as `DashboardInput.perSpec`.
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
import type { FileDiagnostic, IdeaFiles, LibraryCatalog, MergeState, SpecFiles, SpecRead, TextFileKind, Workflow, Worktree } from "../../core/src/files.ts";
import { parseFrontmatter } from "../../core/src/frontmatter.ts";
import { specIdOf } from "../../core/src/spec-ref.ts";
import { type TreeEntry, type TreeEntryMode, treeIdOf } from "../../core/src/gates.ts";
import { readCatalog } from "../../core/src/library.ts";
import { readLockSources } from "../../core/src/locks.ts";
import { type SpecRef, listSpecs } from "../../core/src/resolve.ts";
import { parseWorkflow } from "../../core/src/workflow.ts";
import { WORKTREE_COPY_KINDS, type WorktreeAssignment, assignWorktrees, specSourceOf } from "../../core/src/worktrees.ts";
import { type SpecBranch, aheadOfMain, dirty, mergedSpecBranches, trackedSpecPaths, userEmail, worktreeList } from "./git.ts";

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
       * `resolveEdges` takes beside the input. It rides beside the input, as `ideas` does, until the model uses it.
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
    const worktrees = await readWorktrees(root, refs.map((ref) => ref.slug));
    for (const ref of refs) {
      const main = specFiles(ref.dir, ref.slug);
      if (ref.archived) {
        archived.push(main);
        continue;
      }
      const source = await specSourceFor(root, ref, main, worktrees);
      specs.push(source.files);
      if (source.read !== null) perSpec[ref.slug] = source.read;
      if (source.copy !== null) copies[ref.slug] = source.copy;
    }
    // The main checkout's tree only where a marked spec compares with it: one without a tree of its own (ISC-176).
    const reviewed = specs.some((f) => f.texts.gateCodeReviewed !== undefined && perSpec[f.folder]?.tree === undefined);
    const workflow = parseWorkflow(readIfExists(repoFilePath(root, "workflow")));
    return {
      readable: true,
      workflow,
      ideas: readIdeaFiles(root),
      viewer: await viewerActorOf(root),
      diagnostics: workflow.diagnostics.map((diagnostic) => ({ file: WORKFLOW_FILE, diagnostic })),
      copies,
      mergeState: mergeStateOf(specs, archived, (await mergedSpecBranches(root)).branches),
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
      },
    };
  } catch (error) {
    return { readable: false, error: codeOf(error) };
  }
}

// ── the worktrees (spec 027) ─────────────────────────────────────────────────────────────────────────

/**
 * The worktrees of the workspace at `root` (spec 027, T19, ISC-175): `git worktree list --porcelain`, assigned to the
 * spec `folders` by `core/`'s `assignWorktrees`, with the chip's two git facts read inside each worktree of kind `spec`
 * that belongs to a spec: `ahead` (`rev-list --count main..<branch>`) and `dirty` (`status --porcelain`), through
 * `git.ts`, which never fetches and runs with `GIT_OPTIONAL_LOCKS=0`. A builder is counted and never read, and a
 * worktree of no spec has no chip to fill, so both keep their nulls. One worktree after the other, each with its two
 * reads side by side: a workspace has a handful. Undefined when git lists nothing beside the main checkout (no
 * repository of its own, no git, a failure), so such an input is the same as before spec 027.
 */
async function readWorktrees(root: string, folders: readonly string[]): Promise<WorktreeAssignment | undefined> {
  const assignment = assignWorktrees(await worktreeList(root), folders);
  if (assignment.worktrees.length === 0) return undefined;
  const worktrees: Worktree[] = [];
  for (const worktree of assignment.worktrees) {
    if (worktree.kind !== "spec" || worktree.spec === null) {
      worktrees.push(worktree);
      continue;
    }
    const at = join(root, worktree.path);
    const [ahead, changed] = await Promise.all([aheadOfMain(at, worktree.branch), dirty(at)]);
    worktrees.push({ ...worktree, ahead, dirty: changed });
  }
  return { ...assignment, worktrees };
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
const insideRepository = (path: string): boolean => !isAbsolute(path) && path !== ".." && !path.startsWith("../");

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
  assignment: WorktreeAssignment | undefined,
  withTree = true,
): Promise<SpecSourceReading> {
  const worktree = assignment?.worktrees.find((w) => w.kind === "spec" && w.spec === ref.id) ?? null;
  if (worktree === null || !insideRepository(worktree.path) || !hasGit(join(root, worktree.path))) {
    return { files: main, read: null, copy: null };
  }
  const at = join(root, worktree.path);
  const source = specSourceOf({ folder: ref.slug, worktree, lsFiles: await trackedSpecPaths(root, ref.slug) });
  const copyDir = join(at, "specs", ref.slug);
  const copy = source === "worktree" ? copyFiles(ref.dir, copyDir, ref.slug) : null;
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
 * `dir` is the folder the copy kinds were read from (the worktree copy's, or the main checkout's `ref.dir`).
 */
export async function readSpecSource(root: string, ref: SpecRef): Promise<{ files: SpecFiles; dir: string }> {
  const main = specFiles(ref.dir, ref.slug);
  if (ref.archived) return { files: main, dir: ref.dir };
  const assignment = assignWorktrees(await worktreeList(root), listSpecs(root).map((r) => r.slug));
  const source = await specSourceFor(root, ref, main, assignment);
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
  const assignment = assignWorktrees(await worktreeList(root), refs.map((ref) => ref.slug));
  const copies: Record<string, string> = {};
  for (const ref of refs) {
    if (ref.archived || !assignment.worktrees.some((w) => w.kind === "spec" && w.spec === ref.id)) continue;
    const source = await specSourceFor(root, ref, specFiles(ref.dir, ref.slug), assignment, false);
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
 * The catalog's documents without the dashboard's reading: core's `readCatalog` over the files alone, for the routes
 * that need the document list and never a stage (`libraryDoc`, `librarySearch`). The documents and their states do not
 * depend on the dashboard input; skipping it keeps a search keystroke free of the worktree hash and the chip's git
 * facts. Only the worktree copies are read (`readCopies`), so a spec's own documents come from the same read source as
 * in `loadCatalog` (spec 027, ISC-181).
 */
export async function loadCatalogDocs(root: string): Promise<CatalogLoad> {
  const unreadable = workspaceUnreadable(root);
  if (unreadable !== null) return { readable: false, error: unreadable };
  try {
    const copies = await readCopies(root);
    return { readable: true, catalog: await readCatalog(root, undefined, { copies }), copies };
  } catch (error) {
    return { readable: false, error: codeOf(error) };
  }
}

// ── the worktree tree id ──────────────────────────────────────────────────────────────────────────────

/** The paths `git add -A` would stage: tracked and untracked, `.gitignore`, `info/exclude` and the global excludes applied. */
async function listedPaths(root: string): Promise<string[] | null> {
  const git = Bun.which("git", { PATH: process.env.PATH ?? "" });
  if (!git) return null;
  const child = Bun.spawn([git, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
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
