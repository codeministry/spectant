// The TL;DR and its staleness (spec 001 T38, ISC-16), ported from the old SpecTldr: sections by their
// `<!-- section: key -->` markers, `generated:` from the frontmatter, stale when a spec's `updated:` or newest round is
// later than `generated:`. Harbor's tldr.md was generated on 2026-03-07, before 003's `updated:` (2026-03-09): stale,
// and it never names 006 (core/fixtures/README.md). Lantern has no TL;DR.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseFrontmatter } from '../src/frontmatter.ts';
import { parseTldr, tldrState, TLDR_SECTIONS, type TldrStateInput } from '../src/tldr.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

/** The active specs of a fixture tree, as the dashboard hands them to `tldrState`. */
function activeSpecs(tree: string): TldrStateInput['specs'] {
  const specs = join(FIXTURES, tree, 'specs');
  return readdirSync(specs)
    .filter((d) => /^\d{3}-/.test(d) && existsSync(join(specs, d, 'spec.md')))
    .sort()
    .map((d) => {
      const { data } = parseFrontmatter(readFileSync(join(specs, d, 'spec.md'), 'utf8'));
      return { number: d.slice(0, 3), updated: data.updated, phase: data.phase };
    });
}

describe('harbor', () => {
  const text = readFileSync(join(FIXTURES, 'harbor', 'specs', 'tldr.md'), 'utf8');
  const tldr = parseTldr(text);

  test('reads generated and the five sections in file order', () => {
    expect(tldr.generated).toBe('2026-03-07T18:00:00Z');
    expect(Object.keys(tldr.sections)).toEqual([...TLDR_SECTIONS]);
    expect(tldr.sections.overview).toStartWith('Sync is done and archived (001).');
    expect(tldr.sections.next).toBe('Answer the empty-state question in 002, then run the code review for 004.');
    expect(tldr.sections['per-spec']).toContain('- **005** Config format choice');
    expect(tldr.diagnostics).toEqual([]);
  });

  test('stale, complete in its sections, and 006 unnamed', () => {
    expect(tldrState({ tldr, specs: activeSpecs('harbor') })).toEqual({
      present: true,
      stale: true,
      missingSections: [],
      unnamedSpecs: ['006'],
    });
  });

  test('fresh once generated is later than every updated and every round', () => {
    const later = parseTldr(text.replace('2026-03-07T18:00:00Z', '2026-03-10T00:00:00Z'));
    const specs = activeSpecs('harbor');
    expect(tldrState({ tldr: later, specs }).stale).toBe(false);
    const withRound = specs.map((s) => (s.number === '002' ? { ...s, lastRound: '2026-03-11T09:00:00Z' } : s));
    expect(tldrState({ tldr: later, specs: withRound }).stale).toBe(true);
  });
});

describe('lantern', () => {
  test('no TL;DR: not present, not stale, nothing to complete', () => {
    expect(existsSync(join(FIXTURES, 'lantern', 'specs', 'tldr.md'))).toBe(false);
    expect(tldrState({ tldr: null, specs: activeSpecs('lantern') })).toEqual({
      present: false,
      stale: false,
      missingSections: [],
      unnamedSpecs: [],
    });
  });
});

describe('the file shape', () => {
  test('missing sections, unknown keys kept, a repeated key appended, a complete spec need not be named', () => {
    const tldr = parseTldr(
      '---\ngenerated: 2026-03-07T18:00:00Z\n---\n\n<!-- section: overview -->\nOne 101.\n\n<!-- section: extra -->\nKept.\n\n<!-- section: overview -->\nTwo.\n',
    );
    expect(tldr.sections).toEqual({ overview: 'One 101.\n\nTwo.', extra: 'Kept.' });
    const state = tldrState({
      tldr,
      specs: [
        { number: '101', updated: '2026-03-01T00:00:00Z', phase: 'building' },
        { number: '102', updated: '2026-03-01T00:00:00Z', phase: 'complete' },
        { number: '103', updated: null, phase: null },
      ],
    });
    expect(state).toEqual({ present: true, stale: false, missingSections: ['try', 'per-spec', 'risks', 'next'], unnamedSpecs: ['103'] });
  });

  test('without generated, or with one that is no time: a diagnostic, and stale', () => {
    const none = parseTldr('# TL;DR\n\n<!-- section: overview -->\nText.\n');
    expect(none.generated).toBeNull();
    expect(none.diagnostics.map((d) => d.code)).toEqual(['tldr-generated-missing']);
    expect(tldrState({ tldr: none, specs: [] }).stale).toBe(true);

    const bad = parseTldr('---\ngenerated: yesterday\n---\n');
    expect(bad.generated).toBe('yesterday');
    expect(bad.diagnostics.map((d) => d.code)).toEqual(['tldr-generated-invalid']);
    expect(tldrState({ tldr: bad, specs: [] }).stale).toBe(true);
  });
});
