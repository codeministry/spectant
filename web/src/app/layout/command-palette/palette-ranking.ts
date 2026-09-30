import type { PaletteEntry } from '../../core/palette-sources';

/**
 * The palette's ranking (design.md § Command palette and keyboard): exact ID > ID prefix > title word prefix >
 * subsequence. The ID is the entry's `chip` when it has one (a spec's mono ID), else its first keyword; the other
 * keywords rank like the ID's prefix. Pure, so the unit tests pin it without a DOM.
 */
export const RANK = { none: 0, subsequence: 1, wordPrefix: 2, idPrefix: 3, exactId: 4 } as const;
export type Rank = (typeof RANK)[keyof typeof RANK];

/** A piece of the label: `mark` pieces render inside `<mark>`. */
export interface Segment {
  readonly text: string;
  readonly mark: boolean;
}

const fold = (value: string): string => value.toLocaleLowerCase();

/** Every candidate the ID tiers compare against: the chip, then the keywords. */
function ids(entry: PaletteEntry): string[] {
  return [entry.chip, ...entry.keywords].filter((value): value is string => value !== undefined && value !== '').map(fold);
}

/** Start offsets of the label's words (a word starts after anything that is not a letter or digit). */
function wordStarts(label: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < label.length; i++) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(label.charAt(i - 1))) starts.push(i);
  }
  return starts;
}

/** Offsets of `query` as a subsequence of `text`, or null. */
function subsequence(text: string, query: string): number[] | null {
  const hits: number[] = [];
  let from = 0;
  for (const char of query) {
    const at = text.indexOf(char, from);
    if (at < 0) return null;
    hits.push(at);
    from = at + 1;
  }
  return hits;
}

/** How well `entry` matches `query`; an empty query matches everything at the lowest positive rank. */
export function rankEntry(entry: PaletteEntry, query: string): Rank {
  const q = fold(query.trim());
  if (q === '') return RANK.subsequence;
  const candidates = ids(entry);
  if (candidates.includes(q)) return RANK.exactId;
  if (candidates.some((id) => id.startsWith(q))) return RANK.idPrefix;
  const label = fold(entry.label);
  if (wordStarts(label).some((start) => label.startsWith(q, start))) return RANK.wordPrefix;
  if (subsequence(label, q) !== null || candidates.some((id) => subsequence(id, q) !== null)) return RANK.subsequence;
  return RANK.none;
}

/** The entries that match, best rank first, keeping the source's order within a rank. */
export function rankEntries(entries: readonly PaletteEntry[], query: string): Array<{ entry: PaletteEntry; rank: Rank }> {
  return entries
    .map((entry, index) => ({ entry, rank: rankEntry(entry, query), index }))
    .filter((item) => item.rank > RANK.none)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ entry, rank }) => ({ entry, rank }));
}

/**
 * Splits `text` into marked and plain pieces: a word-prefix or substring hit marks one run, else each subsequence hit.
 * Works on code points folded one by one, so a character outside the BMP is never cut and a character whose lower
 * case is longer (`İ` → `i̇`) cannot shift the offsets of the hits after it.
 */
export function highlight(text: string, query: string): Segment[] {
  const q = Array.from(fold(query.trim()));
  if (q.length === 0) return [{ text, mark: false }];
  const chars = Array.from(text);
  const lower = chars.map(fold);
  const matchesAt = (start: number): boolean => q.every((char, i) => lower[start + i] === char);
  const wordStart = (i: number): boolean => i === 0 || !/[\p{L}\p{N}]/u.test(chars[i - 1] ?? '');
  const indices = chars.map((_, i) => i);
  const start = indices.find((i) => wordStart(i) && matchesAt(i)) ?? indices.find((i) => matchesAt(i)) ?? -1;
  let marked: Set<number>;
  if (start >= 0) {
    marked = new Set(q.map((_, i) => start + i));
  } else {
    const hits: number[] = [];
    let from = 0;
    for (const char of q) {
      const at = lower.indexOf(char, from);
      if (at < 0) return [{ text, mark: false }];
      hits.push(at);
      from = at + 1;
    }
    marked = new Set(hits);
  }
  const segments: Segment[] = [];
  chars.forEach((char, i) => {
    const mark = marked.has(i);
    const last = segments.at(-1);
    if (last?.mark === mark) segments[segments.length - 1] = { text: last.text + char, mark };
    else segments.push({ text: char, mark });
  });
  return segments;
}
