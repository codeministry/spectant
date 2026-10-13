/**
 * One registered repository read into the dashboard model (T47, ISC-16; plan 001 § Interfaces "HTTP").
 *
 * `readWorkspaceInput` reads the texts `core/` builds from: `ISA.md`, `specs/constitution.md`, `specs/tldr.md`,
 * `specs/workflow.md` (parsed by `core/`'s `parseWorkflow`, carried beside the input, T78), the story folder
 * `specs/ideas/` (every `*.md` directly in it, `README.md` the index, as `core/`'s `readIdeas` takes it, T79), the
 * viewer's actor id (`actorIdOf` over `git config --get user.email`, T80), and every text file kind
 * of every spec folder under `specs/` and `specs/archive/` (folders as `listSpecs` finds them). It
 * parses nothing: every parse is `core/`'s (ISC-5, `bun run check:single-core`). `loadDashboard` adds the local
 * services and calls `buildDashboard`. The lock sources are `core/`'s `readLockSources` (T51): the repository's
 * `.spectant/activity.jsonl`, plus the LifeOS frontier locks only when a LifeOS state directory is passed (ISC-37).
 *
 * Read-only (ISC-15): `node:fs` reads, no write, no temp file, no lock. The worktree tree id for the code-reviewed mark
 * is computed in memory by `core/`'s `treeIdOf` over a file list from `git ls-files`, which reads the index and never
 * writes it or an object (`GIT_OPTIONAL_LOCKS=0` keeps even an optional index refresh off). It runs only for a
 * repository root (`.git` directly in the folder) with at least one active spec that carries a code-reviewed mark;
 * anything else, or a git that is missing or fails, is `null`, which `core/` reads as "tree id unavailable".
 * The worktrees (spec 027, ISC-175) come from `git.ts`'s read-only `worktree list`, `rev-list --count` and `status`
 * (`readWorktrees`); `core/`'s `assignWorktrees` decides which spec each belongs to.
 *
 * An unreadable workspace (gone, not a directory, no permission) is a `{readable: false, error}` value with a stable
 * code, never a throw and never the OS message, which would carry the absolute path (ISC-3).
 */
import { lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildDashboard, devServiceLabels, toLocalService } from "../../core/src/dashboard.ts";
import type { DashboardInput, DashboardModel, ProbedService } from "../../core/src/dashboard.ts";
import { actorIdOf } from "../../core/src/actor-id.ts";
import { FILE_KINDS, repoFilePath } from "../../core/src/files.ts";
import type { FileDiagnostic, IdeaFiles, SpecFiles, TextFileKind, Workflow, Worktree } from "../../core/src/files.ts";
import { type TreeEntry, type TreeEntryMode, treeIdOf } from "../../core/src/gates.ts";
import { readLockSources } from "../../core/src/locks.ts";
import { type SpecRef, listSpecs } from "../../core/src/resolve.ts";
import { parseWorkflow } from "../../core/src/workflow.ts";
import { type WorktreeAssignment, assignWorktrees } from "../../core/src/worktrees.ts";
import { aheadOfMain, dirty, userEmail, worktreeList } from "./git.ts";

/** Why a workspace cannot be read. Stable codes: the web app maps them to its own words. */
export type UnreadableCode = "missing" | "not-a-directory" | "permission-denied" | "unreadable";

/**
 * A readable workspace: the model's input, the workflow table (T78, ISC-122; the default table when `specs/workflow.md`
 * is missing) and the reading's own findings, each under its repository-relative file name. The input carries the
 * same workflow (`DashboardInput.workflow`), which decides row 7 of the stage table (`close-pending`, spec 008 T49).
 * `ideas` is the story folder for `buildPlanning` (T79; `DashboardInput` has no field for it, so it rides beside the
 * input as `workflow` does); `viewer` is the viewer's `u:` id, null without a configured git address (T80).
 */
export type WorkspaceReading =
  | {
      readable: true;
      input: DashboardInput;
      workflow: Workflow;
      ideas: IdeaFiles;
      viewer: string | null;
      diagnostics: readonly FileDiagnostic[];
    }
  | { readable: false; error: UnreadableCode };

export type DashboardLoad = { readable: true; model: DashboardModel } | { readable: false; error: UnreadableCode };

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
    const refs = listSpecs(root);
    for (const ref of refs) (ref.archived ? archived : specs).push(specFiles(ref.dir, ref.slug));
    const reviewed = specs.some((f) => f.texts.gateCodeReviewed !== undefined);
    const worktrees = await readWorktrees(root, refs.map((ref) => ref.slug));
    const workflow = parseWorkflow(readIfExists(repoFilePath(root, "workflow")));
    return {
      readable: true,
      workflow,
      ideas: readIdeaFiles(root),
      viewer: await viewerActorOf(root),
      diagnostics: workflow.diagnostics.map((diagnostic) => ({ file: WORKFLOW_FILE, diagnostic })),
      input: {
        master: readIfExists(join(root, "ISA.md")),
        constitution: readIfExists(join(root, "specs", "constitution.md")),
        tldr: readIfExists(join(root, "specs", "tldr.md")),
        specs,
        archived,
        worktreeTree: reviewed ? await worktreeTreeId(root) : null,
        ...(worktrees === undefined ? {} : { worktrees }),
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
