/**
 * The file behind a catalog document (spec 017 T59, ISC-156.4), shared by the reader and the search: a document is one
 * the catalog lists as Markdown and not `missing`; its file is reached only by its listed path, confined below the
 * real `specs/` (`catalogFileBelow`), so a request never names a file and a symlink out of `specs/` is never read. The
 * listed path is already decoded, so a name with a space, a `%`, an umlaut or a literal percent sequence opens and is
 * searched. A spec's own file read from its worktree copy (spec 027, ISC-181) is reached the same way below that copy's
 * folder (`catalogSourceOf`). Also here: the render of such a document as its Docs tab renders it.
 */
import { basename, dirname, join, sep } from "node:path";
import { docsRenderOptions } from "../../../core/src/evidence.ts";
import type { DocName, DocsPage, LibraryDoc } from "../../../core/src/files.ts";
import { type RepoFileCopy, catalogSourceOf } from "../../../core/src/library.ts";
import { renderDocsMarkdown } from "../../../core/src/markdown-docs.ts";
import { renderTechDocument } from "../../../core/src/tech.ts";
import { type Stats, lstatOf, realPathOf, statOf } from "../infra/fs/stat.ts";

/** A catalog document the reader and the search read: Markdown, and a file that exists (not `missing`). */
export const isReadableDoc = (doc: LibraryDoc): boolean => doc.media === "markdown" && doc.state !== "missing";

/** The Docs tab a catalog document renders as: the constitution's and the Design tab's own options, else a plain page. */
const docNameOf = (type: LibraryDoc["type"]): DocName => (type === "constitution" ? "constitution" : type === "design" ? "design" : "plan");

/**
 * The real file of a catalog path below `dir`, or null (spec 017 T59, ISC-156.4). The path is the catalog's own
 * spelling, read from the directory and matched exactly, so it is already decoded: a `%` in it is part of the name,
 * never an escape, and nothing decodes it again. Core's `resolveEvidencePath` takes a raw request and refuses a percent
 * sequence after its one decode, which turned away a listed `run%20retry.md` (code-review finding 7). Its other rules
 * stand here: no control character or backslash, no empty, `.` or `..` segment, the real path below the real `dir`
 * and a regular file. A real path that leaves `dir` (a symlink out) is `symlink-escape`, anything else unresolved null.
 */
const catalogFileBelow = async (
  dir: string,
  rel: string,
  realDirOf: (dir: string) => Promise<string> = realPathOf,
): Promise<{ real: string; stats: Stats } | "symlink-escape" | null> => {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused here
  if (rel === "" || /[\u0000-\u001f\u007f\\]/.test(rel)) return null;
  const segments = rel.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  try {
    const realDir = await realDirOf(dir);
    const real = await realPathOf(join(realDir, ...segments));
    if (!real.startsWith(realDir + sep)) return "symlink-escape";
    const stats = await statOf(real);
    return stats.isFile() ? { real, stats } : null;
  } catch {
    return null;
  }
};

/** Whether `dir` is a directory now, through a link; false when it is gone or cannot be read. */
export const isFolder = async (dir: string): Promise<boolean> => {
  try {
    return (await statOf(dir)).isDirectory();
  } catch {
    return false;
  }
};

/** Whether `path` is a regular file now, never through a link; false when it is gone or cannot be read. */
export const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await lstatOf(path)).isFile();
  } catch {
    return false;
  }
};

/** A resolved catalog file: the document, its real file and stats, the logical path the render confines by, its source folder. */
export type CatalogFile = { doc: LibraryDoc; absolute: string; stats: Stats; logical: string; source: string };

/**
 * The real file of a catalog document, confined below `specs/` (`catalogFileBelow`, the listed path never decoded
 * again): null for a document that is not readable Markdown, or whose real path leaves `specs/` (a symlink out). The
 * document is the catalog's entry in hand, so a request alone never names a file and nothing is looked up by path. A
 * spec's own file comes from its worktree copy when `copies` names one (core's `catalogSourceOf`, spec 027, ISC-181),
 * resolved from the copy's `specs/` with `NNN-slug/<file>` (spec 041, ISC-216.1), so the confinement covers the copy
 * folder itself: a copy folder or file whose real path leaves the worktree's `specs/` is `symlink-escape`, which the
 * reader answers 403. A symlink out of the main checkout's `specs/` stays null (404), as before. A copy folder that is
 * gone by now (its worktree removed since the copies were read) falls back to the main checkout's file (spec 041,
 * ISC-217). A workspace document whose read source is a spec worktree (`repoFiles`, spec 039, ISC-209) is resolved
 * below that worktree's `specs/` with its catalog path, and falls back to the main checkout's file when it is gone by
 * now. `source` names the folder the file was read from, the copy's, the worktree's or main's `specs/`, for the
 * search's text cache. `realDirOf` lets a search resolve each folder once.
 */
export const catalogFile = async (
  root: string,
  doc: LibraryDoc,
  copies: Readonly<Record<string, string>>,
  repoFiles: Readonly<Record<string, RepoFileCopy>>,
  realDirOf?: (dir: string) => Promise<string>,
): Promise<CatalogFile | "symlink-escape" | null> => {
  if (!isReadableDoc(doc)) return null;
  const main = join(root, "specs");
  const source = catalogSourceOf(root, doc, copies, repoFiles);
  const fromCopy = copies[doc.spec] === source.dir;
  let found = fromCopy
    ? await catalogFileBelow(dirname(source.dir), `${basename(source.dir)}/${source.rel}`, realDirOf)
    : await catalogFileBelow(source.dir, source.rel, realDirOf);
  let from = source.dir;
  if (found === null && from !== main && (!fromCopy || !(await isFolder(source.dir)))) {
    found = await catalogFileBelow(main, doc.path, realDirOf);
    from = main;
  }
  if (found === "symlink-escape") return from !== main ? found : null;
  // The logical path (not the real one) feeds the render options, whose confinement is lexical under `root`: the copy's
  // file for a document read from a copy, where its relative images resolve, since the whole folder, `artifacts/` and
  // `.design/` included, is read from it (spec 039, ISC-208); else the main checkout's.
  const logical = from === main ? join(main, ...doc.path.split("/")) : join(source.dir, ...source.rel.split("/"));
  return found === null ? null : { doc, absolute: found.real, stats: found.stats, logical, source: from };
};

/**
 * A catalog document rendered as its Docs tab renders it: `renderDocsMarkdown` with `docsRenderOptions`; tech.md
 * through core's `renderTechDocument`, the same render with each marker's part marked (ISC-355).
 */
export const renderCatalogDoc = (root: string, file: { doc: LibraryDoc; logical: string }, source: string): DocsPage =>
  (file.doc.type === "tech" ? renderTechDocument : renderDocsMarkdown)(source, docsRenderOptions(root, file.logical, docNameOf(file.doc.type)));
