/**
 * The library's search (spec 017 T18, ISC-156.3): the trimmed query, case-insensitive, over each document's rendered
 * page as plain text, else its title; hits in catalog order, the snippet 40 characters before the first match and 60
 * after with an ellipsis where cut, or the title for a title-only match. The plain texts are cached in memory per
 * workspace by source folder (a worktree copy or main's `specs/`, spec 041, ISC-217) and catalog path, checked against
 * size and mtime; a search keeps only the entries of the catalog it read. Each document is resolved once from the
 * entry in hand (no lookup by path), its real folder once per search, and the files are read `SEARCH_READS` at a time,
 * so a search grows linearly with the documents (ISC-156.5).
 */
import type { DocsPage, LibraryDoc } from "../../../core/src/files.ts";
import type { RepoFileCopy } from "../../../core/src/library.ts";
import type { LibrarySearchHit } from "../contracts/spec-routes.contract.ts";
import { readTextOf, realPathOf } from "../infra/fs/stat.ts";
import { mapBounded } from "../infra/git/index.ts";
import { catalogFile, isReadableDoc, renderCatalogDoc } from "./catalog-file.ts";

/** Characters of plain text a search snippet keeps before and after the match (spec 017, as the e2e stub cuts it). */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 60;

const ENTITY: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * A rendered page as plain text: tags dropped, the five entities the renderer writes decoded, whitespace collapsed.
 * The renderer escapes every text and emits only its own tags, so this is its exact text, never a parse of the file.
 */
function plainTextOf(page: DocsPage): string {
  return page.html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITY[entity] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The plain text around a match at `at`: 40 characters before it and 60 after, an ellipsis where the text is cut. */
function snippetAt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + length + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Files a search reads at once (ISC-156.5): enough to overlap the reads, few enough to stay clear of the fd limit. */
const SEARCH_READS = 16;

/** One document's search text with the file version it was taken from; a changed size or mtime renders it again. */
type SearchText = { readonly mtimeMs: number; readonly size: number; readonly text: string };

/**
 * The search text of one catalog document: its rendered page as plain text, from the cache while the file's size and
 * mtime are unchanged, else rendered again. Null when the file cannot be resolved or read; the title still matches.
 * One resolution per document (`catalogFile`), whose stat also decides the cache, and one read on a miss.
 */
const searchTextOf = async (
  root: string,
  doc: LibraryDoc,
  copies: Readonly<Record<string, string>>,
  repoFiles: Readonly<Record<string, RepoFileCopy>>,
  realDirOf: (dir: string) => Promise<string>,
  previous: ReadonlyMap<string, SearchText>,
  seen: Map<string, SearchText>,
): Promise<string | null> => {
  const file = await catalogFile(root, doc, copies, repoFiles, realDirOf);
  if (file === null || file === "symlink-escape") return null;
  const { mtimeMs, size } = file.stats;
  // Keyed by source and catalog path (spec 041, ISC-217): a spec whose source switched between the copy and main never
  // gets the other source's text, even where both files share size and mtime.
  const key = `${file.source}\0${doc.path}`;
  const cached = previous.get(key);
  let entry: SearchText;
  if (cached?.mtimeMs === mtimeMs && cached.size === size) entry = cached;
  else {
    try {
      entry = { mtimeMs, size, text: plainTextOf(renderCatalogDoc(root, file, await readTextOf(file.absolute))) };
    } catch (error) {
      if (typeof (error as NodeJS.ErrnoException | null)?.code !== "string") throw error;
      return null;
    }
  }
  seen.set(key, entry);
  return entry.text;
};

/** The documents a search runs over, with the worktree copies they are read from. */
export type SearchDocs = {
  readonly docs: readonly LibraryDoc[];
  readonly copies: Readonly<Record<string, string>>;
  readonly repoFiles: Readonly<Record<string, RepoFileCopy>>;
};

/**
 * A searcher with its own text cache, by workspace root and catalog path: `query` is already trimmed and not blank.
 * Each search keeps only what it saw.
 */
export function librarySearcher(): (root: string, query: string, loaded: SearchDocs) => Promise<LibrarySearchHit[]> {
  const searchTexts = new Map<string, Map<string, SearchText>>();
  return async (root, query, loaded) => {
    const needle = query.toLowerCase();
    const previous = searchTexts.get(root) ?? new Map<string, SearchText>();
    const seen = new Map<string, SearchText>();
    // Each folder's real path once per search: every document below it shares the one realpath.
    const realDirs = new Map<string, Promise<string>>();
    const realDirOf = (dir: string): Promise<string> => {
      let real = realDirs.get(dir);
      if (real === undefined) {
        real = realPathOf(dir);
        real.catch(() => undefined); // awaited by every caller inside its own try; never an unhandled rejection
        realDirs.set(dir, real);
      }
      return real;
    };
    const docs = loaded.docs.filter(isReadableDoc);
    const texts = await mapBounded(docs, SEARCH_READS, (doc) => searchTextOf(root, doc, loaded.copies, loaded.repoFiles, realDirOf, previous, seen));
    const hits: LibrarySearchHit[] = [];
    docs.forEach((doc, i) => {
      const text = texts[i] ?? null;
      const at = text === null ? -1 : text.toLowerCase().indexOf(needle);
      if (text !== null && at !== -1) hits.push({ path: doc.path, snippet: snippetAt(text, at, needle.length) });
      else if (doc.title.toLowerCase().includes(needle)) hits.push({ path: doc.path, snippet: doc.title });
    });
    // Only the documents of this catalog stay cached: a removed or renamed document leaves the cache with it.
    searchTexts.set(root, seen);
    return hits;
  };
}
