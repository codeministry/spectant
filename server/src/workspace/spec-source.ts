/**
 * The read source of one active spec (spec 027). A spec with a live worktree of its own is read per spec
 * (`specSourceFor`): its code-reviewed mark compares with the tree id computed in that worktree (ISC-176), and when git
 * tracks its folder (`ls-files`, `trackedSpecPaths`) its files come from the worktree's copy (`copyDirFor`), with the
 * main checkout's copy beside them (ISC-181); both go to `core/` as `DashboardInput.perSpec`. The worktree tree id
 * (`infra/git/tree-id.ts`) runs only for a spec that carries a code-reviewed mark.
 */
import { join } from "node:path";
import { FILE_KINDS } from "../../../core/src/files.ts";
import type { SpecFiles, SpecRead, TextFileKind } from "../../../core/src/files.ts";
import { SPEC_FOLDER, SPEC_ID, specSlugOf } from "../../../core/src/spec-ref.ts";
import { type NotFound, type SpecNotFoundReason, type SpecRef, listSpecs, resolveSpec } from "../../../core/src/resolve.ts";
import { WORKTREE_COPY_KINDS, type WorktreeView, copyDirFor } from "../../../core/src/worktrees.ts";
import { worktreeTreeId } from "../infra/git/tree-id.ts";
import { readIfExists } from "../infra/fs/read.ts";
import { FOLDER_KINDS, specFiles } from "./spec-files.ts";
import { type WorktreeReading, insideRepository, readWorktreeView, withWorktreeOnly } from "./worktree-view.ts";

/** How the loader read one active spec (spec 027): its files, the `SpecRead` beside them, and the copy's folder. */
export interface SpecSourceReading {
  /** The spec's files: the worktree copy's for `WORKTREE_COPY_KINDS` when the source is `worktree`, else main's. */
  readonly files: SpecFiles;
  /** What `core/` gets in `perSpec` / `read`; null when there is nothing to say (no worktree, no mark). */
  readonly read: SpecRead | null;
  /** The absolute folder of the worktree copy when the source is `worktree`, else null; never leaves the server. */
  readonly copy: string | null;
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
 * without a mark no tree is computed, nor with `withTree` false (the library's reader and `readSpecSource` need the copy
 * alone). A spec without such a worktree has no `read` and keeps the workspace's defaults.
 */
export async function specSourceFor(
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
  // A spec only the worktree carries (ISC-208.1): its folder is the copy, and the main checkout has none to show beside it.
  const only = copyDir === ref.dir;
  const read: SpecRead = {
    ...(files === main ? {} : only ? { source: "worktree" as const } : { source: "worktree" as const, main }),
    ...(!withTree || files.texts.gateCodeReviewed === undefined ? {} : { tree: await worktreeTreeId(at) }),
  };
  return { files, read: Object.keys(read).length === 0 ? null : read, copy: files === main ? null : copyDir };
}

/**
 * One spec's files from its read source, for the routes that read a single spec (the spec page's tabs): the same
 * decision `readWorkspaceInput` makes per spec, so a tab never reads another copy than the row and the head (ISC-181).
 * `dir` is the folder the copy kinds were read from (the worktree copy's, or the main checkout's `ref.dir`). `reading` is the
 * caller's `readWorktreeView`, read anew when absent. No tree id is computed: the answer carries none, so hashing the
 * worktree here would only be dropped (spec 057, ISC-359); a route that shows the tree takes it from the one
 * `readWorkspaceInput` it reads.
 */
export async function readSpecSource(root: string, ref: SpecRef, reading?: WorktreeReading): Promise<{ files: SpecFiles; dir: string }> {
  const main = specFiles(ref.dir, ref.slug);
  if (ref.archived) return { files: main, dir: ref.dir };
  const { view } = reading ?? (await readWorktreeView(root));
  const source = await specSourceFor(root, ref, main, view, false);
  return { files: source.files, dir: source.copy ?? ref.dir };
}

/**
 * The worktree copies of the workspace at `root` (spec 027, ISC-181): per active spec read from its worktree's copy,
 * the copy's absolute folder, by the per-spec decision `readWorkspaceInput` makes (`specSourceFor`), without the tree
 * ids and the chip's git facts: one `git worktree list`, one `git ls-files` per spec worktree, no hash. Empty when no
 * spec has a worktree. For the library's reader and search, which need the documents and never a stage.
 */
export async function readCopies(root: string): Promise<Record<string, string>> {
  const listed = listSpecs(root);
  const { view, worktreeOnly } = await readWorktreeView(root, listed);
  const refs = withWorktreeOnly(listed, worktreeOnly);
  const copies: Record<string, string> = {};
  for (const ref of refs) {
    if (ref.archived || !view.live.some((w) => w.kind === "spec" && w.spec === ref.id)) continue;
    const source = await specSourceFor(root, ref, specFiles(ref.dir, ref.slug), view, false);
    if (source.copy !== null) copies[ref.slug] = source.copy;
  }
  return copies;
}

/**
 * The spec `id` names in the workspace at `root` as `resolveSpec` finds it, else among the specs only a live spec
 * worktree carries (spec 039, ISC-208.1), matched by the same three forms: `NNN`, `NNN-slug` or the slug alone.
 * `reading` is the caller's `readWorktreeView`, read only when the main checkout names nothing.
 */
export async function resolveWorkspaceSpec(root: string, id: string, reading?: WorktreeReading): Promise<SpecRef | NotFound<SpecNotFoundReason>> {
  const found = resolveSpec(root, id);
  if (found.kind === "spec" || found.reason === "ambiguous") return found;
  const { worktreeOnly } = reading ?? (await readWorktreeView(root));
  const matches = worktreeOnly.filter((ref) =>
    SPEC_ID.test(id) ? ref.id === id : SPEC_FOLDER.test(id) && ref.slug === id ? true : id !== "" && specSlugOf(ref.slug) === id,
  );
  return matches.length === 1 && matches[0] !== undefined ? matches[0] : found;
}
