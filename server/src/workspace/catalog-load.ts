/**
 * The library's document catalog of one workspace, loaded beside the dashboard model (spec 017): `loadCatalog` is
 * core's `readCatalog` over the same input; `loadCatalogDocs` and `loadCatalogDoc` read the documents alone, core's
 * `readCatalogDocs` and `catalogDocAt` (ISC-156.5). Read-only, like every load of the workspace.
 *
 * Held here until the `library/` slice takes it over (spec 059, T42).
 */
import { join } from "node:path";
import type { LibraryCatalog, LibraryDoc } from "../../../core/src/files.ts";
import { type RepoFileCopy, catalogDocAt, readCatalog, readCatalogDocs } from "../../../core/src/library.ts";
import type { UnreadableCode } from "../contracts/spec-routes.contract.ts";
import { codeOf, workspaceUnreadable } from "../infra/fs/errno.ts";
import { readWorkspaceInput } from "./reading.ts";
import { readIdeaSources, readRepoFile } from "./repo-files.ts";
import { readCopies } from "./spec-source.ts";
import { type WorktreeReading, readWorktreeView } from "./worktree-view.ts";

/**
 * The document catalog of one workspace (spec 017), or why the workspace cannot be read. `copies` are the worktree
 * copies the catalog read its specs' own files from (`WorkspaceReading.copies`, spec 027, ISC-181), so the reader opens
 * the same file; server-internal, never part of a response (ISC-3), absent from a loader that names none.
 */
export type CatalogLoad =
  | { readable: true; catalog: LibraryCatalog; copies?: Readonly<Record<string, string>>; repoFiles?: Readonly<Record<string, RepoFileCopy>> }
  | { readable: false; error: UnreadableCode };

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
    const repoFiles = await readRepoCatalogFiles(root);
    return { readable: true, catalog: await readCatalog(root, reading.input, { copies: reading.copies, repoFiles }), copies: reading.copies, repoFiles };
  } catch (error) {
    return { readable: false, error: codeOf(error) };
  }
}

/**
 * What the library's reader and search read with the worktree copies: a value of `read`, or why the workspace cannot
 * be read. The copies are the read sources `loadCatalog` lists the documents from (spec 027, ISC-181).
 */
export type CopiesLoad<T> =
  | ({ readable: true; copies: Readonly<Record<string, string>>; repoFiles: Readonly<Record<string, RepoFileCopy>> } & T)
  | { readable: false; error: UnreadableCode };

/**
 * The workspace documents of the library read from a spec worktree's copy (spec 039, ISC-209), by catalog path:
 * `constitution.md`, `tech.md`, `tldr.md` and each story `ideas/<name>.md` whose `readRepoFile` source is a worktree,
 * with the absolute file and the source. Documents read from the main checkout are not named. `reading` as for
 * `readRepoFile`.
 */
export async function readRepoCatalogFiles(root: string, reading?: WorktreeReading): Promise<Record<string, RepoFileCopy>> {
  const view = reading ?? (await readWorktreeView(root));
  const out: Record<string, RepoFileCopy> = {};
  if (view.repoFacts.worktrees.length === 0) return out;
  for (const name of ["constitution.md", "tech.md", "tldr.md"]) {
    const read = await readRepoFile(root, `specs/${name}`, view);
    if (read.source.kind === "worktree" && read.text !== null) out[name] = { absolute: read.absolute, source: read.source };
  }
  const ideas = await readIdeaSources(root, view);
  for (const [name, source] of Object.entries(ideas.sources)) {
    if (source.kind === "worktree") out[`ideas/${name}`] = { absolute: join(root, source.worktree, "specs", "ideas", name), source };
  }
  return out;
}

/**
 * `read` over the worktree copies of the workspace at `root`, without the dashboard's reading (ISC-156.5): no stage
 * input, workflow, lock source, worktree hash or chip git fact, and never `buildDashboard`. A workspace that cannot be
 * read is its stable code, checked first, as in `loadCatalog`.
 */
async function withCopies<T>(
  root: string,
  read: (copies: Readonly<Record<string, string>>, repoFiles: Readonly<Record<string, RepoFileCopy>>) => Promise<T>,
): Promise<CopiesLoad<T>> {
  const unreadable = workspaceUnreadable(root);
  if (unreadable !== null) return { readable: false, error: unreadable };
  try {
    const [copies, repoFiles] = await Promise.all([readCopies(root), readRepoCatalogFiles(root)]);
    return { readable: true, copies, repoFiles, ...(await read(copies, repoFiles)) };
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
  return withCopies(root, async (copies, repoFiles) => ({ docs: await readCatalogDocs(root, { copies, repoFiles }) }));
}

/**
 * The one catalog document at `path` (relative to `specs/`), for the reader (`libraryDoc`): core's `catalogDocAt`,
 * equal to the catalog's entry, null where the catalog lists none and for a null `path` (a query that does not decode).
 * Only the folders on the path's way are read, never the tree.
 */
export function loadCatalogDoc(root: string, path: string | null): Promise<CopiesLoad<{ doc: LibraryDoc | null }>> {
  return withCopies(root, async (copies, repoFiles) => ({ doc: path === null ? null : await catalogDocAt(root, path, { copies, repoFiles }) }));
}
