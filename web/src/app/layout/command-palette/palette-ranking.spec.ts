import { describe, expect, it } from 'vitest';
import type { PaletteEntry } from '../../core/palette-sources';
import { highlight, RANK, rankEntries, rankEntry } from './palette-ranking';

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
