import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import type { PaletteEntry, PaletteSource } from '../../core/palette-sources';
import {
  CLAIM_HITS,
  CLAIMS_GROUP,
  EXCERPT_LEAD,
  excerpt,
  highlight,
  isClaimQuery,
  RANK,
  rankClaim,
  rankEntries,
  rankEntry,
  rankGroups,
} from './palette-ranking';

const entry = (label: string, chip?: string, keywords: string[] = []): PaletteEntry => ({
  id: label,
  label,
  chip,
  link: ['/'],
  keywords,
});

const marked = (text: string, query: string): string[] =>
  highlight(text, query)
    .filter((segment) => segment.mark)
    .map((segment) => segment.text);

describe('palette ranking (design.md § Command palette and keyboard)', () => {
  it('ranks exact ID > ID prefix > title word prefix > subsequence', () => {
    expect(rankEntry(entry('Web console', '002'), '002')).toBe(RANK.exactId);
    expect(rankEntry(entry('Web console', '022'), '02')).toBe(RANK.idPrefix);
    expect(rankEntry(entry('Web console', '002'), 'cons')).toBe(RANK.wordPrefix);
    expect(rankEntry(entry('Web console', '002'), 'wcl')).toBe(RANK.subsequence);
    expect(rankEntry(entry('Web console', '002'), 'xyz')).toBe(RANK.none);
  });

  it('orders the matches best rank first and keeps the source order within a rank', () => {
    const entries = [entry('Config loader', '003'), entry('Web console', '002'), entry('Console export', '004')];
    expect(rankEntries(entries, 'con').map(({ entry: e }) => e.chip)).toEqual(['003', '002', '004']);
    expect(rankEntries(entries, '002').map(({ entry: e }) => e.chip)).toEqual(['002']);
  });

  it('marks a word-prefix run, else each subsequence hit', () => {
    expect(marked('Web console', 'cons')).toEqual(['cons']);
    expect(marked('Web console', 'wcl')).toEqual(['W', 'c', 'l']);
    expect(highlight('Web console', '')).toEqual([{ text: 'Web console', mark: false }]);
  });

  it('never splits a character outside the BMP across a mark boundary', () => {
    // '🚀' is two UTF-16 units; marking by code unit would cut it and shift every hit after it.
    const segments = highlight('🚀 Launch console', 'lc');
    expect(segments.map((s) => s.text).join('')).toBe('🚀 Launch console');
    expect(segments.filter((s) => s.mark).map((s) => s.text)).toEqual(['L', 'c']);
    expect(segments.every((s) => !/[\uD800-\uDBFF]$/u.test(s.text))).toBe(true);
    expect(marked('🚀 Launch', 'lau')).toEqual(['Lau']);
  });

  it('marks the same characters when lower-casing changes the length of one', () => {
    // 'İ' folds to 'i̇' (two code units), which shifted every offset after it by one.
    expect(marked('İstanbul sync', 'sync')).toEqual(['sync']);
    expect(marked('İstanbul', 'stan')).toEqual(['stan']);
  });
});

// 019 T40 · ISC-139: claims rank by ID, by the bare number on whole segments and by a word of their text; a claim-like
// query lifts the Claims group to the top, so its first hit is the preselected option.
describe('palette claims ranking (T40, ISC-139)', () => {
  const claim = (isc: string, text: string, status = 'open'): PaletteEntry => ({
    id: `claim:harbor:${isc}`,
    label: text,
    chip: isc,
    link: `/w/harbor/s/007/claims#claim-${isc}`,
    keywords: [isc.replace(/^ISC-/u, ''), status],
  });
  const restart = claim('ISC-126', 'The rotated token is used without a restart.', 'taken');
  const sub = claim('ISC-126.1', 'The old token is revoked.');
  const longer = claim('ISC-1260', 'A claim about 126 ms.');

  it('takes ISC-… and a bare number as claim-like, and nothing else', () => {
    expect(['ISC-126', 'isc-12', 'ISC-', '126', '126.1', ' 7 '].map(isClaimQuery)).toEqual([true, true, true, true, true, true]);
    expect(['restart', 'isc', '126a', '007-x', ''].map(isClaimQuery)).toEqual([false, false, false, false, false]);
  });

  it('matches the full ID exactly or as a prefix', () => {
    expect(rankClaim(restart, 'ISC-126')).toBe(RANK.exactId);
    expect(rankClaim(sub, 'isc-126')).toBe(RANK.idPrefix);
    expect(rankClaim(restart, 'ISC-12')).toBe(RANK.idPrefix);
    expect(rankClaim(restart, 'ISC-127')).toBe(RANK.none);
  });

  it('matches a bare number on whole segments of the number, never the text', () => {
    expect(rankClaim(restart, '126')).toBe(RANK.exactId);
    expect(rankClaim(sub, '126')).toBe(RANK.idPrefix);
    expect(rankClaim(longer, '126')).toBe(RANK.none);
    expect(rankClaim(restart, '12')).toBe(RANK.none);
  });

  it('matches a word of the text or a status word, never a subsequence or an empty query', () => {
    expect(rankClaim(restart, 'restart')).toBe(RANK.wordPrefix);
    expect(rankClaim(restart, 'without a re')).toBe(RANK.wordPrefix);
    expect(rankClaim(restart, 'taken')).toBe(RANK.idPrefix);
    expect(rankClaim(restart, 'tart')).toBe(RANK.none);
    expect(rankClaim(restart, 'rtd')).toBe(RANK.none);
    expect(rankClaim(restart, '')).toBe(RANK.none);
  });

  const source = (id: string, order: number, entries: readonly PaletteEntry[]): PaletteSource => ({
    id,
    labelKey: `palette.groups.${id}`,
    order,
    entries: signal(entries),
  });
  const recent = source('recent', 10, [entry('Restart notes', '009')]);
  const claims = source(CLAIMS_GROUP, 15, [restart, sub, longer]);
  const specs = source('specs', 40, [entry('Restart the mirror', '126'), entry('Token rotation', '007')]);
  const order = (query: string): string[] => rankGroups([recent, claims, specs], query).map((group) => group.source.id);

  it('shows Recent and no Claims for an empty query', () => {
    expect(order('')).toEqual(['recent', 'specs']);
  });

  it('puts Claims first for a claim-like query, even when another group ties or leads', () => {
    // "126" is also the exact ID of a spec here; the claim-like query still leads with Claims.
    expect(order('126')).toEqual([CLAIMS_GROUP, 'specs']);
    expect(rankGroups([recent, claims, specs], '126')[0]?.matches.map((m) => m.entry.chip)).toEqual(['ISC-126', 'ISC-126.1']);
    expect(order('ISC-126')).toEqual([CLAIMS_GROUP]);
  });

  it('never puts Claims before Specs for a text query while Specs has a hit', () => {
    expect(order('restart')).toEqual(['specs', CLAIMS_GROUP]);
    expect(order('revoked')).toEqual([CLAIMS_GROUP]);
  });

  it('keeps at most eight claim hits', () => {
    const many = source(CLAIMS_GROUP, 15, Array.from({ length: 12 }, (_, i) => claim(`ISC-5.${String(i + 1)}`, 'A claim.')));
    expect(rankGroups([many], '5')[0]?.matches).toHaveLength(CLAIM_HITS);
    expect(CLAIM_HITS).toBe(8);
  });

  it('starts a long claim line near a late text hit, so the hit is on the shown line', () => {
    const text = '`harbor token rotate` replaces the push token in the credential store, and the next scheduled run uses it without a restart.';
    const shown = excerpt(text, 'restart');
    expect(shown.startsWith('…')).toBe(true);
    expect(shown.endsWith('without a restart.')).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(EXCERPT_LEAD + 'restart.'.length + 1);
    expect(marked(shown, 'restart')).toEqual(['restart']);
    expect(excerpt(text, 'harbor')).toBe(text);
    expect(excerpt(text, 'zzz')).toBe(text);
    expect(excerpt(text, '')).toBe(text);
  });
});
