import type { PaletteEntry, PaletteSource } from '../../core/palette-sources';

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

/** The entries that match, best rank first, keeping the source's order within a rank; `rank` defaults to `rankEntry`. */
export function rankEntries(
  entries: readonly PaletteEntry[],
  query: string,
  rank: (entry: PaletteEntry, query: string) => Rank = rankEntry,
): Array<{ entry: PaletteEntry; rank: Rank }> {
  return entries
    .map((entry, index) => ({ entry, rank: rank(entry, query), index }))
    .filter((item) => item.rank > RANK.none)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ entry, rank: tier }) => ({ entry, rank: tier }));
}

/** The Claims group (019 T4 · ISC-139): ranked by `rankClaim`, at most `CLAIM_HITS` hits, first for a claim-like query. */
export const CLAIMS_GROUP = 'claims';
export const CLAIM_HITS = 8;

/** `ISC-`, `ISC-12`, `ISC-126.1` (folded). */
const CLAIM_ID = /^isc-[\d.]*$/u;
/** `126`, `126.1`: a claim number without its prefix. */
const CLAIM_NUMBER = /^\d+(?:\.\d+)*$/u;

/** Whether `query` looks like a claim ID (`ISC-…`) or a bare claim number (`126`): the Claims group then leads (T40). */
export function isClaimQuery(query: string): boolean {
  const q = fold(query.trim());
  return CLAIM_ID.test(q) || CLAIM_NUMBER.test(q);
}

/**
 * How well a claim entry (its ISC in `chip`, its text in `label`, its status word among the `keywords`) matches `query`
 * (T40). A claim ID matches the chip exactly or as a prefix; a bare number matches the number part of the chip on whole
 * segments, so "126" finds ISC-126 (exact) and ISC-126.1 (prefix) but not ISC-1260. A claim-like query never matches
 * the text. Any other query matches a status word as a prefix or a word of the text as a word prefix, never as a
 * subsequence: a long claim line holds nearly any letters in order. An empty query matches nothing, so the group only
 * lists with a query.
 */
export function rankClaim(entry: PaletteEntry, query: string): Rank {
  const q = fold(query.trim());
  if (q === '') return RANK.none;
  const id = fold(entry.chip ?? '');
  if (CLAIM_NUMBER.test(q)) {
    const number = id.replace(/^isc-/u, '');
    if (number === q) return RANK.exactId;
    return number.startsWith(`${q}.`) ? RANK.idPrefix : RANK.none;
  }
  if (CLAIM_ID.test(q)) {
    if (id === q) return RANK.exactId;
    return id.startsWith(q) ? RANK.idPrefix : RANK.none;
  }
  if (entry.keywords.some((keyword) => keyword !== '' && fold(keyword).startsWith(q))) return RANK.idPrefix;
  const label = fold(entry.label);
  return wordStarts(label).some((start) => label.startsWith(q, start)) ? RANK.wordPrefix : RANK.none;
}

export interface RankedGroup<S extends PaletteSource = PaletteSource> {
  readonly source: S;
  readonly matches: ReadonlyArray<{ entry: PaletteEntry; rank: Rank }>;
}

/**
 * The palette's groups for `query`, from `sources` in their `order`. An empty query keeps that order, shows Recent and
 * no Claims; a query drops Recent, and the groups follow their best match (ties by `order`), so Enter lands on it.
 * Claims (T40) rank by `rankClaim` and keep at most `CLAIM_HITS` hits: a claim-like query puts the group first, so its
 * first hit is the preselected option; any other query never puts it before Specs while Specs has a hit, since a spec
 * title naming the word is the likelier target than a line inside a claim.
 */
export function rankGroups<S extends PaletteSource>(sources: readonly S[], query: string): Array<RankedGroup<S>> {
  const q = query.trim();
  const groups = sources
    .filter((source) => (q === '' ? source.id !== CLAIMS_GROUP : source.id !== 'recent'))
    .map((source) => ({
      source,
      matches: source.id === CLAIMS_GROUP ? rankEntries(source.entries(), q, rankClaim).slice(0, CLAIM_HITS) : rankEntries(source.entries(), q),
    }))
    .filter((group) => group.matches.length > 0);
  if (q === '') return groups;
  groups.sort((a, b) => (b.matches[0]?.rank ?? 0) - (a.matches[0]?.rank ?? 0) || a.source.order - b.source.order);
  const at = groups.findIndex((group) => group.source.id === CLAIMS_GROUP);
  if (at < 0) return groups;
  const [claims] = groups.splice(at, 1);
  if (isClaimQuery(q)) return [claims, ...groups];
  const specs = groups.findIndex((group) => group.source.id === 'specs');
  groups.splice(specs >= at ? specs + 1 : at, 0, claims);
  return groups;
}

/** How many characters of a claim line may stand before a text hit before the shown line starts nearer to it. */
export const EXCERPT_LEAD = 24;

/**
 * The part of a claim line the palette shows for `query`: the whole line when the hit (a word prefix) starts within
 * `EXCERPT_LEAD` characters or there is none, else "…" and the line from the first whole word at most that far before
 * the hit, so a word late in a long claim is on the one shown line with its mark. Code points, like `highlight`.
 */
export function excerpt(text: string, query: string): string {
  const q = Array.from(fold(query.trim()));
  if (q.length === 0) return text;
  const chars = Array.from(text);
  const lower = chars.map(fold);
  const isWord = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);
  const wordStart = (i: number): boolean => isWord(chars[i]) && !isWord(chars[i - 1]);
  const hit = chars.findIndex((_, i) => (i === 0 || !isWord(chars[i - 1])) && q.every((char, k) => lower[i + k] === char));
  if (hit <= EXCERPT_LEAD) return text;
  let from = hit;
  for (let i = hit - 1; i >= hit - EXCERPT_LEAD; i--) if (wordStart(i)) from = i;
  return `…${chars.slice(from).join('')}`;
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
