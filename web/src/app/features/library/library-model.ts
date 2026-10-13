import type { DemoLibraryEntry, DemoLibraryType } from '../../shared/demo/demo-data';

/** The document types in the prototype's order (`library.js` `TYPES`); the filter chips and their labels follow it. */
export const LIBRARY_TYPES: readonly DemoLibraryType[] = ['plan', 'design', 'decisions', 'constitution', 'evidence', 'notes'];

/** The spec value of a workspace-wide document (the constitution). */
export const WORKSPACE_WIDE = 'ws';

/** The list's filters: `type` and `spec` are `all` or one value, `query` is the raw search text. */
export interface LibraryFilter {
  readonly query: string;
  readonly type: DemoLibraryType | 'all';
  readonly spec: string;
  readonly stale: boolean;
}

export const NO_FILTER: LibraryFilter = { query: '', type: 'all', spec: 'all', stale: false };

/** One run of a highlighted text: `hit` marks the search match (rendered as `<mark>`). */
export interface TextRun {
  readonly text: string;
  readonly hit: boolean;
}

const SNIPPET = 90;
const IMAGE_FILE = /\.(png|jpe?g|webp|gif|avif|svg)$/iu;

/** The body as one line of plain text, Markdown marks stripped (the prototype's `plain`). */
export const plainText = (body: string): string => body.replace(/[#*`]/gu, '').replace(/\s+/gu, ' ').trim();

/** The spec's slug from the document's path (`specs/002-web-console/plan.md` → `web-console`), null when it has none. */
export function specSlug(entry: DemoLibraryEntry): string | null {
  const match = /(?:^|\/)specs\/\d+-([^/]+)\//u.exec(entry.file);
  return match?.[1] ?? null;
}

/** Whether the document is an image the reader previews instead of only describing. */
export const isImage = (entry: DemoLibraryEntry): boolean => IMAGE_FILE.test(entry.file);

/** Whether the entry passes every filter; the query matches title, file, plain body and references, ignoring case. */
export function matches(entry: DemoLibraryEntry, filter: LibraryFilter): boolean {
  const query = filter.query.trim().toLowerCase();
  if (filter.type !== 'all' && entry.type !== filter.type) return false;
  if (filter.spec !== 'all' && entry.spec !== filter.spec) return false;
  if (filter.stale && entry.stale === undefined) return false;
  if (query === '') return true;
  return [entry.title, entry.file, plainText(entry.body), ...entry.refs].join(' ').toLowerCase().includes(query);
}

/** The other documents sharing at least one reference with `entry`, in fixture order (the cross-reference panel). */
export function related(entry: DemoLibraryEntry, all: readonly DemoLibraryEntry[]): readonly DemoLibraryEntry[] {
  return all.filter((other) => other.id !== entry.id && other.refs.some((ref) => entry.refs.includes(ref)));
}

/** The references `other` shares with `entry`, in `other`'s order. */
export const sharedRefs = (entry: DemoLibraryEntry, other: DemoLibraryEntry): readonly string[] =>
  other.refs.filter((ref) => entry.refs.includes(ref));

/** `text` split around the first match of `query` (case ignored); one plain run without a query or a match. */
export function highlight(text: string, query: string): readonly TextRun[] {
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : text.toLowerCase().indexOf(q);
  if (at < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + q.length), hit: true },
    { text: text.slice(at + q.length), hit: false },
  ].filter((run) => run.text !== '');
}

/**
 * The row's snippet: the first 90 characters of the plain body, or, with a query found in it, a window from 30
 * characters before the match to 50 after it, with ellipses where it was cut (the prototype's `snippet`).
 */
export function snippet(body: string, query: string): readonly TextRun[] {
  const plain = plainText(body);
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : plain.toLowerCase().indexOf(q);
  if (at < 0) return [{ text: plain.length > SNIPPET ? `${plain.slice(0, SNIPPET)}…` : plain, hit: false }];
  const from = Math.max(0, at - 30);
  const to = at + q.length + 50;
  const runs = highlight(plain.slice(from, to), q);
  return [...(from > 0 ? [{ text: '…', hit: false }] : []), ...runs, ...(to < plain.length ? [{ text: '…', hit: false }] : [])];
}

/** The spec values in fixture order, each once (the Spec select). */
export const specsOf = (all: readonly DemoLibraryEntry[]): readonly string[] => [...new Set(all.map((entry) => entry.spec))];
