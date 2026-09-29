// Claim parser (spec 001 T33, seam for ISC-6): claim lines, feature blocks, fog, Test Strategy rows and the progress
// recount, measured on every fixture against the counts core/fixtures/README.md states. Port of the old IsaFrontier
// claim parser (`- [ ] ISC-N: text (after: ISC-A)`, Anti/Antecedent, dotted IDs, [DROPPED …] tombstones) plus the
// SpecStatus section readers (fog, Test Strategy, Verification).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatProgress, parseClaims, validateEdges, type ClaimsDocument } from '../src/claims.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

function parse(rel: string): ClaimsDocument {
  return parseClaims(readFileSync(join(FIXTURES, rel), 'utf8'));
}

interface Expected {
  claims: number;
  closed: number;
  counted: string;
  dropped: number;
  anti: number;
  antecedent: number;
  edged: number;
  features: string[];
  fog: number;
  rows: number;
}

// Counts as core/fixtures/README.md states them, completed from the trees for the files the README does not list.
const EXPECTED: Record<string, Expected> = {
  'harbor/ISA.md': { claims: 124, closed: 101, counted: '101/124', dropped: 0, anti: 30, antecedent: 1, edged: 29, features: ['F0', 'F1', 'F2', 'F3', 'F4'], fog: 2, rows: 124 },
  'harbor/specs/archive/001-manifest-sync/spec.md': { claims: 46, closed: 46, counted: '46/46', dropped: 0, anti: 12, antecedent: 0, edged: 9, features: ['F1'], fog: 0, rows: 46 },
  'harbor/specs/002-web-console/spec.md': { claims: 30, closed: 25, counted: '25/30', dropped: 0, anti: 0, antecedent: 0, edged: 4, features: ['F2'], fog: 0, rows: 30 },
  'harbor/specs/003-config-loader/spec.md': { claims: 13, closed: 0, counted: '0/13', dropped: 0, anti: 6, antecedent: 0, edged: 6, features: [], fog: 0, rows: 13 },
  'harbor/specs/004-retention-policies/spec.md': { claims: 30, closed: 30, counted: '30/30', dropped: 0, anti: 10, antecedent: 0, edged: 10, features: ['F4'], fog: 0, rows: 30 },
  'harbor/specs/005-config-format-choice/spec.md': { claims: 1, closed: 0, counted: '0/1', dropped: 0, anti: 0, antecedent: 1, edged: 0, features: [], fog: 2, rows: 1 },
  'harbor/specs/006-partial-push/spec.md': { claims: 4, closed: 0, counted: '0/4', dropped: 0, anti: 3, antecedent: 0, edged: 0, features: [], fog: 0, rows: 4 },
  'lantern/ISA.md': { claims: 12, closed: 4, counted: '4/12', dropped: 0, anti: 4, antecedent: 0, edged: 4, features: ['F0', 'F1'], fog: 0, rows: 12 },
  'lantern/specs/001-reading-list/spec.md': { claims: 8, closed: 4, counted: '4/8', dropped: 0, anti: 0, antecedent: 0, edged: 4, features: ['F1'], fog: 0, rows: 8 },
  'lantern/specs/002-duplicate-links/spec.md': { claims: 2, closed: 0, counted: '0/2', dropped: 0, anti: 2, antecedent: 0, edged: 0, features: [], fog: 0, rows: 2 },
  'empty-master/ISA.md': { claims: 3, closed: 0, counted: '0/3', dropped: 0, anti: 1, antecedent: 0, edged: 1, features: ['F0', 'F1'], fog: 0, rows: 3 },
  'spectant-001/ISA.md': { claims: 47, closed: 14, counted: '14/47', dropped: 0, anti: 7, antecedent: 3, edged: 9, features: ['F0', 'F1'], fog: 0, rows: 47 },
  'spectant-001/specs/001-app-skeleton/spec.md': { claims: 47, closed: 14, counted: '14/47', dropped: 0, anti: 7, antecedent: 3, edged: 9, features: ['F0', 'F1'], fog: 0, rows: 47 },
  // The frozen leadgen master declares 31/33 but tombstones ISC-342: the recount says 31/32 (a finding, not an edit).
  'leadgen/ISA.md': { claims: 33, closed: 31, counted: '31/32', dropped: 1, anti: 3, antecedent: 0, edged: 15, features: ['F40', 'F41', 'F50'], fog: 0, rows: 33 },
  'leadgen/specs/012-pwa-install/spec.md': { claims: 10, closed: 9, counted: '9/10', dropped: 0, anti: 1, antecedent: 0, edged: 8, features: ['F40'], fog: 1, rows: 10 },
  'leadgen/specs/022-chat-turn-status-and-bulk-delete/spec.md': { claims: 8, closed: 8, counted: '8/8', dropped: 0, anti: 1, antecedent: 0, edged: 4, features: ['F50'], fog: 0, rows: 8 },
  'leadgen/specs/archive/013-tech-debt/spec.md': { claims: 15, closed: 14, counted: '14/14', dropped: 1, anti: 1, antecedent: 0, edged: 3, features: [], fog: 0, rows: 15 },
};

describe('fixtures', () => {
  test.each(Object.keys(EXPECTED))('%s parses to the stated counts with no error', (rel) => {
    const doc = parse(rel);
    const want = EXPECTED[rel];
    if (!want) throw new Error(`no expectation for ${rel}`);
    expect(doc.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(doc.idlessBoxes).toBe(0);
    expect({
      claims: doc.claims.length,
      closed: doc.claims.filter((c) => c.checked).length,
      counted: formatProgress(doc.counted),
      dropped: doc.claims.filter((c) => c.dropped).length,
      anti: doc.claims.filter((c) => c.kind === 'anti').length,
      antecedent: doc.claims.filter((c) => c.kind === 'antecedent').length,
      edged: doc.claims.filter((c) => c.after.length > 0).length,
      features: doc.features.map((f) => f.id),
      fog: doc.fog.length,
      rows: doc.testStrategy.length,
    }).toEqual(want);
  });

  test('every claim ID is unique within its file', () => {
    for (const rel of Object.keys(EXPECTED)) {
      const ids = parse(rel).claims.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('harbor master: 101/124 is the three-digit/three-digit fraction, F0 holds ISC-1 to ISC-4', () => {
    const doc = parse('harbor/ISA.md');
    expect(doc.section).toEqual({ heading: 'Features', line: 179 });
    const f0 = doc.features.find((f) => f.id === 'F0');
    expect(f0).toMatchObject({ name: 'Cross-cutting', line: 181, claims: ['ISC-1', 'ISC-2', 'ISC-3', 'ISC-4'] });
    expect(f0?.why?.startsWith('what would sink Harbor whichever feature slipped')).toBe(true);
    const first = doc.claims[0];
    expect(first).toMatchObject({ id: 'ISC-1', checked: false, kind: 'anti', feature: 'F0', line: 184, indent: 0, dropped: false });
    expect(first?.text).toBe('a failed push leaves a partial manifest visible in the target registry.');
    expect(doc.fog.map((f) => f.line)).toEqual([47, 48]);
    expect(doc.fog[0]?.text).toBe('which config format version 2 uses — the spike in spec 005 has to name the trade-off first');
    // Remaining Work sits outside the claim section: its checkbox is not a claim and not an ID-less box.
    expect(doc.claims.some((c) => c.line > 325)).toBe(false);
  });

  test('harbor 002: dotted IDs ISC-60.1 and ISC-60.2 with their edges', () => {
    const doc = parse('harbor/specs/002-web-console/spec.md');
    const byId = new Map(doc.claims.map((c) => [c.id, c]));
    expect(byId.get('ISC-60.1')?.after).toEqual(['ISC-60']);
    expect(byId.get('ISC-60.2')?.after).toEqual(['ISC-60']);
    expect(byId.get('ISC-60.1')?.text).toBe('The theme switch follows the system colour scheme until a mode is chosen.');
    expect(doc.features[0]?.claims).toHaveLength(30);
  });

  test('harbor 006: ISC-125 is parsed like any other claim', () => {
    expect(parse('harbor/specs/006-partial-push/spec.md').claims.map((c) => c.id)).toContain('ISC-125');
  });

  test('leadgen archive/013: the tombstone is dropped, keeps its edge and leaves the denominator', () => {
    const doc = parse('leadgen/specs/archive/013-tech-debt/spec.md');
    expect(doc.section?.heading).toBe('Claims');
    const tomb = doc.claims.find((c) => c.id === 'ISC-342');
    expect(tomb).toMatchObject({ dropped: true, droppedNote: 'see Decisions 2026-09-24', checked: false, after: ['ISC-348'], feature: null });
    expect(tomb?.text.startsWith('The jar carries the Gradle version')).toBe(true);
    expect(doc.counted).toEqual({ closed: 14, total: 14 });
  });

  test('Test Strategy rows carry the seven positional columns, escaped pipes unescaped', () => {
    const doc = parse('spectant-001/specs/001-app-skeleton/spec.md');
    const row8 = doc.testStrategy.find((r) => r.isc === 'ISC-8');
    expect(row8).toMatchObject({ type: 'bash', check: 'release build targets', threshold: 'exactly 4', anchorsTo: 'literal', severity: '', cells: 7 });
    expect(row8?.tool).toBe('`bun run build && test $(ls dist/spectant-{darwin,linux}-{arm64,x64} | wc -l) -eq 4`');
    const row1 = doc.testStrategy[0];
    expect(row1).toMatchObject({ isc: 'ISC-1', type: 'bun-test', anchorsTo: 'derived: local-only', severity: 'high' });
    expect(doc.testStrategy.map((r) => r.isc)).toContain('ISC-5.1');
  });

  test('Verification lines name the claim they prove', () => {
    const doc = parse('harbor/ISA.md');
    const v = doc.verification.find((l) => l.id === 'ISC-60.1');
    expect(v?.text).toBe('`bun run e2e -- theme-switch -g system` passed, 2026-03-08');
    expect(doc.verification.length).toBeGreaterThan(90);
  });
});

describe('claim lines', () => {
  const doc = (lines: string[]) => parseClaims(['# T', '', '## Features', '', ...lines, '', '## Decisions', ''].join('\n'));
  const one = (line: string) => {
    const claim = doc([line]).claims[0];
    if (!claim) throw new Error(`no claim parsed from ${line}`);
    return claim;
  };

  test('a plain open claim', () => {
    expect(one('- [ ] ISC-7: The digest fits in 60 lines.')).toMatchObject({
      id: 'ISC-7',
      checked: false,
      kind: 'normal',
      text: 'The digest fits in 60 lines.',
      raw: 'The digest fits in 60 lines.',
      after: [],
      marks: [],
      dropped: false,
      droppedNote: null,
      feature: null,
      line: 5,
    });
  });

  test('closed with x or X', () => {
    expect(one('- [x] ISC-7: done').checked).toBe(true);
    expect(one('- [X] ISC-7: done').checked).toBe(true);
  });

  test('Anti: and Antecedent: set the kind and leave the text', () => {
    expect(one('- [ ] ISC-3: Anti: a request leaves the machine.')).toMatchObject({ kind: 'anti', text: 'a request leaves the machine.' });
    expect(one('- [x] ISC-18: Antecedent: the themes carry the old values.')).toMatchObject({ kind: 'antecedent', text: 'the themes carry the old values.' });
  });

  test('dotted IDs and several edges', () => {
    expect(one('- [ ] ISC-60.12: Enter navigates. (after: ISC-60, ISC-60.1)')).toMatchObject({
      id: 'ISC-60.12',
      after: ['ISC-60', 'ISC-60.1'],
      text: 'Enter navigates.',
    });
  });

  test('an edge followed by a trailing mark: both are read, neither stays in the text', () => {
    const claim = one('- [ ] ISC-9: The version prints. (after: ISC-8) ⟨?: which flag, --version or -v⟩');
    expect(claim.after).toEqual(['ISC-8']);
    expect(claim.marks).toEqual(['⟨?: which flag, --version or -v⟩']);
    expect(claim.text).toBe('The version prints.');
  });

  test('a mark before the edge, and a resolved mark', () => {
    const claim = one('- [ ] ISC-9: Prints it ⟨resolved: stdout⟩ (after: ISC-8).');
    expect(claim.after).toEqual(['ISC-8']);
    expect(claim.marks).toEqual(['⟨resolved: stdout⟩']);
    expect(claim.text).toBe('Prints it');
  });

  test('an edge quoted inside a code span is not an edge', () => {
    const claim = one('- [ ] ISC-4: Edges ride in a trailing `(after: ISC-1)`');
    expect(claim.after).toEqual([]);
    expect(claim.text).toBe('Edges ride in a trailing `(after: ISC-1)`');
  });

  test('a tombstone anywhere in the text drops the claim; a leading one is lifted into droppedNote', () => {
    expect(one('- [ ] ISC-5: [DROPPED — merged into ISC-6] Anti: old text.')).toMatchObject({
      dropped: true,
      droppedNote: 'merged into ISC-6',
      kind: 'anti',
      text: 'old text.',
    });
    expect(one('- [ ] ISC-5: [DROPPED 2026-03-04] old text')).toMatchObject({ dropped: true, droppedNote: '2026-03-04', text: 'old text' });
    expect(one('- [ ] ISC-5: [DROPPED] old text')).toMatchObject({ dropped: true, droppedNote: null, text: 'old text' });
    expect(one('- [ ] ISC-5: old text [DROPPED: superseded]')).toMatchObject({ dropped: true, droppedNote: null });
  });

  test('nested leaves keep their indent; other ID forms parse', () => {
    const parsed = doc(['- [ ] ISC-1: parent', '  - [x] ISC-1.1: leaf', '- [ ] H-AVAIL: domain id', '- [ ] C4 — short id']).claims;
    expect(parsed.map((c) => [c.id, c.indent, c.checked])).toEqual([
      ['ISC-1', 0, false],
      ['ISC-1.1', 2, true],
      ['H-AVAIL', 0, false],
      ['C4', 0, false],
    ]);
    expect(parsed[3]?.text).toBe('short id');
  });

  test('feature blocks: heading, name, Why line, the claims under each', () => {
    const d = doc([
      '### F3 · Config loader rewrite',
      'Why: one loader for all.',
      '',
      '- [ ] ISC-70: loads',
      '',
      '### F4 · Retention',
      '- [x] ISC-80: prunes',
    ]);
    expect(d.features).toEqual([
      { id: 'F3', name: 'Config loader rewrite', why: 'one loader for all.', line: 5, claims: ['ISC-70'] },
      { id: 'F4', name: 'Retention', why: null, line: 10, claims: ['ISC-80'] },
    ]);
    expect(d.claims.map((c) => c.feature)).toEqual(['F3', 'F4']);
  });

  test('the claim section ends at the next level-two heading or a rule; fenced lines are not claims', () => {
    const d = parseClaims(
      ['## Claims', '- [ ] ISC-1: in', '```md', '- [ ] ISC-2: in a fence', '## Not a heading', '```', '- [ ] ISC-3: still in', '---', '- [ ] ISC-4: out'].join('\n'),
    );
    expect(d.claims.map((c) => c.id)).toEqual(['ISC-1', 'ISC-3']);
  });

  test('an ID-less checkbox in the section is counted and reported', () => {
    const d = doc(['- [ ] ISC-1: fine', '- [ ] a box with no ID']);
    expect(d.idlessBoxes).toBe(1);
    expect(d.diagnostics.map((x) => `${x.severity}:${x.code}@${x.line ?? '-'}`)).toEqual(['warning:claim-no-id@6']);
  });

  test('a file with both ## Claims and ## Features parses only the first and says so', () => {
    const d = parseClaims(['## Claims', '- [ ] ISC-1: a', '## Features', '- [ ] ISC-2: b'].join('\n'));
    expect(d.claims.map((c) => c.id)).toEqual(['ISC-1']);
    expect(d.diagnostics.map((x) => x.code)).toEqual(['claims-both-headings']);
  });

  test('a file without a claim section has no claims and no diagnostic', () => {
    const d = parseClaims('# Plan\n\n## Approach\n\n- [ ] not a claim\n');
    expect(d.section).toBeNull();
    expect(d.claims).toEqual([]);
    expect(d.counted).toEqual({ closed: 0, total: 0 });
    expect(d.diagnostics).toEqual([]);
  });
});

describe('fog and Test Strategy', () => {
  test('fog lines only under ## Not yet specified, trailing marks lifted', () => {
    const d = parseClaims(
      ['## Goal', '- fog: not here', '## Not yet specified', '', '- fog: which format ⟨?: TOML⟩', '-   fog:   spaced out', '- not fog'].join('\n'),
    );
    expect(d.fog).toEqual([
      { text: 'which format', marks: ['⟨?: TOML⟩'], line: 5 },
      { text: 'spaced out', marks: [], line: 6 },
    ]);
  });

  test('a short row fills the missing columns with empty strings and reports its cell count', () => {
    const d = parseClaims(['## Test Strategy', '', '| isc | type | check |', '|---|---|---|', '| ISC-1 | bash | exit 0 |', '| | | |'].join('\n'));
    expect(d.testStrategy).toEqual([
      { isc: 'ISC-1', type: 'bash', check: 'exit 0', threshold: '', tool: '', anchorsTo: '', severity: '', cells: 3, line: 5 },
    ]);
  });
});

describe('validateEdges', () => {
  test('duplicates, self edges, unknown IDs and a cycle', () => {
    const d = parseClaims(
      ['## Claims', '- [ ] ISC-1: a (after: ISC-2)', '- [ ] ISC-2: b (after: ISC-1)', '- [ ] ISC-3: c (after: ISC-3, ISC-9)', '- [ ] ISC-3: d'].join('\n'),
    );
    expect(validateEdges(d.claims).map((x) => x.message)).toEqual([
      'duplicate claim ID: ISC-3',
      'ISC-3 blocks on itself',
      'ISC-3 blocks on unknown ID: ISC-9',
      'dependency cycle: ISC-1 → ISC-2 → ISC-1',
    ]);
  });

  test('every fixture edge resolves inside its master', () => {
    for (const rel of ['harbor/ISA.md', 'lantern/ISA.md', 'empty-master/ISA.md', 'spectant-001/ISA.md', 'leadgen/ISA.md']) {
      expect(validateEdges(parse(rel).claims)).toEqual([]);
    }
  });
});
