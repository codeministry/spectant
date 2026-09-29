// The claim view model (spec 002 T22, ISC-81): glyph state, kind, edges, probe row, verification line, feature
// headings, the fog list and the filter counts of the Claims tab. Measured on the fixture trees, harbor 002 with and
// without the lock its `.spectant/activity.jsonl` holds, plus one synthetic spec for the cases no fixture carries in
// one file (a checked tombstone, an edge to an unknown ID, a short Test Strategy row, a fog line with a round).
// The counts equal the dashboard row's claim numbers for every fixture spec (ISC-72: one source for every counter).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildClaimViews } from '../src/claim-view.ts';
import { buildDashboard } from '../src/dashboard.ts';
import type { ClaimGlyphState, ClaimLock, ClaimView, ClaimViewModel, LockReading, SpecFiles } from '../src/files.ts';
import { hashForGate } from '../src/gates.ts';
import { readLockSources } from '../src/locks.ts';
import { buildSpecPage } from '../src/spec.ts';
import { FIXTURES, fixtureTrees, folders, readTree } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');

function specFiles(tree: string, folder: string, archived = false): SpecFiles {
  const base = archived ? join(FIXTURES, tree, 'specs', 'archive') : join(FIXTURES, tree, 'specs');
  const hit = folders(base).find((f) => f.folder === folder);
  if (!hit) throw new Error(`no fixture folder ${tree}/${folder}`);
  return hit;
}

const harbor002 = (): SpecFiles => specFiles('harbor', '002-web-console');
const byId = (model: ClaimViewModel, id: string): ClaimView => {
  const hit = model.claims.find((c) => c.id === id);
  if (!hit) throw new Error(`no claim ${id}`);
  return hit;
};
const idsIn = (model: ClaimViewModel, state: ClaimGlyphState): string[] => model.claims.filter((c) => c.state === state).map((c) => c.id);

const reading = (locks: ClaimLock[]): LockReading => ({ source: locks.length > 0 ? 'activity' : 'none', sources: locks.length > 0 ? ['activity'] : [], locks });

describe('harbor 002, the richest spec', () => {
  test('without locks: 25 closed, 4 takeable, 1 blocked, in file order', () => {
    const model = buildClaimViews({ files: harbor002() });
    expect(model.claims).toHaveLength(30);
    expect(model.claims[0]?.id).toBe('ISC-51');
    expect(model.claims[29]?.id).toBe('ISC-78');
    expect(model.counts).toEqual({ all: 30, open: 5, takeable: 4, taken: 0, blocked: 1, closed: 25, dropped: 0, normal: 30, anti: 0, antecedent: 0 });
    expect(idsIn(model, 'takeable')).toEqual(['ISC-74', 'ISC-75', 'ISC-76', 'ISC-77']);
    expect(idsIn(model, 'blocked')).toEqual(['ISC-78']);
    expect(idsIn(model, 'taken')).toEqual([]);
    expect(idsIn(model, 'open')).toEqual([]);
    expect(model.claims.every((c) => c.lock === null && c.dropped === null && c.noteCount === 0)).toBe(true);
  });

  test('with the lock of its activity log: ISC-74 is taken, with session, since and source', async () => {
    const locks = await readLockSources({ repoRoot: HARBOR });
    expect(locks.source).toBe('activity');
    const model = buildClaimViews({ files: harbor002(), locks });
    expect(model.counts).toEqual({ all: 30, open: 5, takeable: 3, taken: 1, blocked: 1, closed: 25, dropped: 0, normal: 30, anti: 0, antecedent: 0 });
    expect(idsIn(model, 'taken')).toEqual(['ISC-74']);
    expect(idsIn(model, 'takeable')).toEqual(['ISC-75', 'ISC-76', 'ISC-77']);
    expect(byId(model, 'ISC-74').lock).toEqual({ source: 'activity', session: 'spec-002-ISC-74', since: '2026-03-08T14:06:00Z' });
    // ISC-72 was claimed and released: closed, no lock.
    expect(byId(model, 'ISC-72')).toMatchObject({ state: 'closed', lock: null });
  });

  test('edges and blockedBy: a closed edge blocks nothing, an open one blocks', () => {
    const model = buildClaimViews({ files: harbor002() });
    expect(byId(model, 'ISC-60.1')).toMatchObject({ state: 'closed', edges: ['ISC-60'], blockedBy: [] });
    expect(byId(model, 'ISC-66')).toMatchObject({ state: 'closed', edges: ['ISC-65'], blockedBy: [] });
    expect(byId(model, 'ISC-78')).toMatchObject({ state: 'blocked', edges: ['ISC-77'], blockedBy: ['ISC-77'] });
    expect(byId(model, 'ISC-74')).toMatchObject({ state: 'takeable', edges: [], blockedBy: [] });
  });

  test('the probe row is positional: every column in its place, an empty severity stays empty', () => {
    const model = buildClaimViews({ files: harbor002() });
    expect(byId(model, 'ISC-51').probe).toEqual({
      isc: 'ISC-51',
      type: 'e2e',
      check: 'registry-list: renders',
      threshold: '0 console errors',
      tool: '`bun run e2e -- registry-list -g render`',
      anchorsTo: 'derived: console-usable',
      severity: 'high',
    });
    expect(byId(model, 'ISC-52').probe?.severity).toBe('');
    expect(byId(model, 'ISC-60.1').probe).toMatchObject({ type: 'e2e', threshold: '2 cases', anchorsTo: 'literal' });
    expect(byId(model, 'ISC-77').probe).toMatchObject({ type: 'manual', tool: 'transcript in `.evidence/`' });
    expect(model.claims.every((c) => c.probe?.isc === c.id)).toBe(true);
  });

  test('the verification line is looked up by claim ID; an open claim has none', () => {
    const model = buildClaimViews({ files: harbor002() });
    expect(byId(model, 'ISC-51').verification).toBe('`bun run e2e -- registry-list -g render` passed, 2026-03-08');
    expect(byId(model, 'ISC-60.2').verification).toBe('`bun run e2e -- theme-switch -g persist` passed, 2026-03-08; routes in `artifacts/T13-routes.md`');
    expect(byId(model, 'ISC-74').verification).toBeNull();
    expect(model.claims.filter((c) => c.verification !== null)).toHaveLength(25);
  });

  test('one feature heading with its Why: line; every card sits under it', () => {
    const model = buildClaimViews({ files: harbor002() });
    expect(model.features).toHaveLength(1);
    expect(model.features[0]).toMatchObject({ id: 'F2', title: 'Web console', why: 'a teammate who never touches the CLI can see what was mirrored, when, and what failed.' });
    expect(model.features[0]?.claims).toHaveLength(30);
    expect(model.claims.every((c) => c.feature === 'F2')).toBe(true);
    expect(model.fog).toEqual([]);
  });

  test('note counts come from the input, zero otherwise', () => {
    const model = buildClaimViews({ files: harbor002(), noteCounts: { 'ISC-74': 2, 'ISC-51': 1 } });
    expect(byId(model, 'ISC-74').noteCount).toBe(2);
    expect(byId(model, 'ISC-51').noteCount).toBe(1);
    expect(byId(model, 'ISC-75').noteCount).toBe(0);
  });
});

describe('kinds, tombstones and fog in the other fixtures', () => {
  test('Anti claims in harbor 003 are blocked on their open twin', () => {
    const model = buildClaimViews({ files: specFiles('harbor', '003-config-loader') });
    expect(model.counts).toEqual({ all: 13, open: 13, takeable: 0, taken: 0, blocked: 6, closed: 0, dropped: 0, normal: 7, anti: 6, antecedent: 0 });
    expect(byId(model, 'ISC-82')).toMatchObject({ kind: 'anti', state: 'blocked', blockedBy: ['ISC-81'], feature: null });
    // No reviewed mark: the seven claims that would be takeable are open (ISC-99).
    expect(model.claims.filter((c) => c.state === 'open')).toHaveLength(7);
    expect(byId(model, 'ISC-82').text).toBe('the project file produces a different effective config than before the rewrite.');
    expect(model.features).toEqual([]);
  });

  test('an Antecedent claim and two fog lines in harbor 005', () => {
    const model = buildClaimViews({ files: specFiles('harbor', '005-config-format-choice') });
    expect(byId(model, 'ISC-94')).toMatchObject({ kind: 'antecedent', state: 'open', text: 'the config format for version 2 is chosen and recorded as a decision.' });
    expect(model.counts).toMatchObject({ antecedent: 1, anti: 0, normal: 0, takeable: 0, open: 1 });
    expect(model.fog).toEqual([
      {
        text: 'whether includes are resolved relative to the including file or to the working directory',
        resolves: 'needs one real multi-repository config',
        sinceRound: null,
        marks: [],
        line: 33,
      },
      {
        text: 'whether a comment-preserving writer is required at all',
        resolves: 'depends on whether the console ever edits the config',
        sinceRound: null,
        marks: [],
        line: 34,
      },
    ]);
  });

  test('a dropped claim in the leadgen archive: struck with its note, out of the open set', () => {
    const model = buildClaimViews({ files: specFiles('leadgen', '013-tech-debt', true) });
    expect(byId(model, 'ISC-342')).toMatchObject({ state: 'dropped', dropped: { note: 'see Decisions 2026-09-24' }, edges: ['ISC-348'], blockedBy: [], lock: null });
    expect(model.counts).toMatchObject({ all: 15, dropped: 1, closed: 14, open: 0, anti: 1 });
    expect(idsIn(model, 'dropped')).toEqual(['ISC-342']);
  });

  test('spectant-001 mixes all three kinds', () => {
    const model = buildClaimViews({ files: specFiles('spectant-001', '001-app-skeleton') });
    expect(model.counts.anti).toBeGreaterThan(0);
    expect(model.counts.antecedent).toBeGreaterThan(0);
    expect(model.counts.normal + model.counts.anti + model.counts.antecedent).toBe(model.counts.all);
    expect(byId(model, 'ISC-18').kind).toBe('antecedent');
    expect(byId(model, 'ISC-1').kind).toBe('anti');
  });
});

const SYNTHETIC = `---
spec_type: feature
---
# 900 — Synthetic

## Not yet specified

- fog: which payload names the worktree — decides ISC-3's probe · since round 2 ⟨?: ask the hook author⟩
- fog: whether retries are needed at all
- fog: which cache key wins – the older one (since R4)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | a \\| b | 1 pass | \`bun test\` | literal | high |
| ISC-2 | manual | short row |
| ISC-2 | bun-test | second row for ISC-2 | x | y | z | low |

## Features

- [ ] ISC-0: Outside any block.

### F1 · First
Why: a reason.

- [x] ISC-1: Closed one.
- [ ] ISC-2: Anti: open after closed. (after: ISC-1)
- [ ] ISC-3: Antecedent: blocked on open. (after: ISC-2, ISC-99)
- [x] ISC-4: [DROPPED — see Decisions 2026-01-02] Checked and dropped.

### F2: Second

- [ ] ISC-5: [DROPPED] Unchecked tombstone with no note. (after: ISC-3)
- [ ] ISC-6: Locked while blocked. (after: ISC-3)

## Verification

- ISC-1: \`bun test\` passed, 2026-01-01
- ISC-1: a second line, ignored
- ISC-2 (partial): evidence for an open claim
`;

// A fresh reviewed mark over SYNTHETIC, so its claims are takeable; `unreviewed` is the same folder without it.
const FRESH_MARK = JSON.stringify({ gate: 'reviewed', at: '2026-01-03T09:00:00Z', files: { 'spec.md': hashForGate('spec.md', SYNTHETIC), 'plan.md': null, 'tasks.md': null } });
const synthetic = (): SpecFiles => ({ folder: '900-synthetic', texts: { spec: SYNTHETIC, gateReviewed: FRESH_MARK } });
const unreviewed = (): SpecFiles => ({ folder: '900-synthetic', texts: { spec: SYNTHETIC } });
const lock = (claim: string, session: string, source: 'activity' | 'frontier' = 'activity'): ClaimLock => ({ source, claim, session, since: '2026-01-03T10:00:00Z' });

describe('a synthetic spec: the edge cases in one file', () => {
  test('every glyph state but open, in file order', () => {
    const model = buildClaimViews({ files: synthetic() });
    expect(model.claims.map((c) => [c.id, c.state])).toEqual([
      ['ISC-0', 'takeable'],
      ['ISC-1', 'closed'],
      ['ISC-2', 'takeable'],
      ['ISC-3', 'blocked'],
      ['ISC-4', 'dropped'],
      ['ISC-5', 'dropped'],
      ['ISC-6', 'blocked'],
    ]);
    expect(model.counts).toEqual({ all: 7, open: 4, takeable: 2, taken: 0, blocked: 2, closed: 1, dropped: 2, normal: 5, anti: 1, antecedent: 1 });
  });

  test('without a fresh reviewed mark every would-be-takeable claim is open, the rest unchanged (ISC-99)', () => {
    const model = buildClaimViews({ files: unreviewed() });
    expect(model.claims.map((c) => [c.id, c.state])).toEqual([
      ['ISC-0', 'open'],
      ['ISC-1', 'closed'],
      ['ISC-2', 'open'],
      ['ISC-3', 'blocked'],
      ['ISC-4', 'dropped'],
      ['ISC-5', 'dropped'],
      ['ISC-6', 'blocked'],
    ]);
    expect(model.counts).toMatchObject({ open: 4, takeable: 0, taken: 0, blocked: 2 });
  });

  test('an edge to an unknown ID blocks; a tombstone blocks nothing and carries its note or null', () => {
    const model = buildClaimViews({ files: synthetic() });
    expect(byId(model, 'ISC-3')).toMatchObject({ kind: 'antecedent', blockedBy: ['ISC-2', 'ISC-99'], edges: ['ISC-2', 'ISC-99'] });
    expect(byId(model, 'ISC-4')).toMatchObject({ dropped: { note: 'see Decisions 2026-01-02' }, text: 'Checked and dropped.' });
    expect(byId(model, 'ISC-5')).toMatchObject({ dropped: { note: null }, blockedBy: [], edges: ['ISC-3'] });
    expect(byId(model, 'ISC-1').dropped).toBeNull();
  });

  test('a lock takes an open claim; a lock on a blocked or closed claim changes nothing; the later lock wins', () => {
    const locks = reading([lock('ISC-2', 'first'), lock('ISC-6', 'held-while-blocked'), lock('ISC-1', 'on-closed'), lock('ISC-2', 'second', 'frontier')]);
    const model = buildClaimViews({ files: synthetic(), locks });
    expect(byId(model, 'ISC-2')).toMatchObject({ state: 'taken', lock: { source: 'frontier', session: 'second', since: '2026-01-03T10:00:00Z' } });
    expect(byId(model, 'ISC-6')).toMatchObject({ state: 'blocked', lock: null });
    expect(byId(model, 'ISC-1')).toMatchObject({ state: 'closed', lock: null });
    expect(model.counts).toMatchObject({ open: 4, takeable: 1, taken: 1, blocked: 2 });
  });

  test('probe rows: escaped pipe, a short row reads its missing columns empty, the first row of an ID wins', () => {
    const model = buildClaimViews({ files: synthetic() });
    expect(byId(model, 'ISC-1').probe).toEqual({ isc: 'ISC-1', type: 'bun-test', check: 'a | b', threshold: '1 pass', tool: '`bun test`', anchorsTo: 'literal', severity: 'high' });
    expect(byId(model, 'ISC-2').probe).toEqual({ isc: 'ISC-2', type: 'manual', check: 'short row', threshold: '', tool: '', anchorsTo: '', severity: '' });
    expect(byId(model, 'ISC-3').probe).toBeNull();
  });

  test('verification: the first line of an ID wins, a parenthesis after the ID is allowed', () => {
    const model = buildClaimViews({ files: synthetic() });
    expect(byId(model, 'ISC-1').verification).toBe('`bun test` passed, 2026-01-01');
    expect(byId(model, 'ISC-2').verification).toBe('evidence for an open claim');
    expect(byId(model, 'ISC-0').verification).toBeNull();
  });

  test('feature headings: a claim before the first block has none; a block without Why: has null', () => {
    const model = buildClaimViews({ files: synthetic() });
    expect(byId(model, 'ISC-0').feature).toBeNull();
    expect(byId(model, 'ISC-6').feature).toBe('F2');
    expect(model.features).toEqual([
      { id: 'F1', title: 'First', why: 'a reason.', claims: ['ISC-1', 'ISC-2', 'ISC-3', 'ISC-4'] },
      { id: 'F2', title: 'Second', why: null, claims: ['ISC-5', 'ISC-6'] },
    ]);
  });

  test('fog: question, what resolves it, the round it names, marks lifted', () => {
    const model = buildClaimViews({ files: synthetic() });
    expect(model.fog).toEqual([
      { text: 'which payload names the worktree', resolves: "decides ISC-3's probe", sinceRound: 2, marks: ['⟨?: ask the hook author⟩'], line: 8 },
      { text: 'whether retries are needed at all', resolves: null, sinceRound: null, marks: [], line: 9 },
      { text: 'which cache key wins', resolves: 'the older one', sinceRound: 4, marks: [], line: 10 },
    ]);
  });

  test('a spec without spec.md, or with no claim section, yields an empty model', () => {
    const empty = { claims: [], features: [], fog: [], counts: { all: 0, open: 0, takeable: 0, taken: 0, blocked: 0, closed: 0, dropped: 0, normal: 0, anti: 0, antecedent: 0 } };
    expect(buildClaimViews({ files: { folder: '901-none', texts: {} } })).toEqual(empty);
    expect(buildClaimViews({ files: { folder: '902-bare', texts: { spec: '# 902 — Bare\n\n## Goal\n\nNothing yet.\n' } } })).toEqual(empty);
  });
});

describe('the counts equal the dashboard row (ISC-72)', () => {
  const trees = fixtureTrees();

  const check = (tree: string, locks: LockReading | undefined) => {
    const input = readTree(tree);
    const dashboard = buildDashboard(locks ? { ...input, locks } : input);
    expect(dashboard.specs.length).toBeGreaterThan(0);
    for (const row of dashboard.specs) {
      const files = input.specs.find((f) => f.folder === row.slug) as SpecFiles;
      const model = buildClaimViews(locks ? { files, locks } : { files });
      const got = {
        spec: row.slug,
        closed: model.counts.closed,
        total: model.counts.all - model.counts.dropped,
        open: model.counts.open,
        takeable: idsIn(model, 'takeable'),
        fog: model.fog.length,
        sum: model.claims.filter((c) => c.state === 'open').length + model.counts.takeable + model.counts.taken + model.counts.blocked + model.counts.closed + model.counts.dropped,
      };
      expect(got).toEqual({
        spec: row.slug,
        closed: row.progress.closed,
        total: row.progress.total,
        open: row.progress.total - row.progress.closed,
        takeable: [...row.takeable],
        fog: row.fog,
        sum: model.claims.length,
      });
      // The spec page's key numbers come from the same row; the tab agrees with them too.
      const page = buildSpecPage(locks ? { files, locks } : { files });
      expect({ spec: row.slug, ...page.keyNumbers.claims }).toEqual({
        spec: row.slug,
        closed: model.counts.closed,
        total: model.counts.all - model.counts.dropped,
        open: model.counts.open,
        takeable: model.counts.takeable,
      });
    }
  };

  test.each(trees.filter((t) => readTree(t).specs.length > 0))('%s: every row, no locks', (tree) => check(tree, undefined));

  test('harbor with its activity lock: every row', async () => {
    check('harbor', await readLockSources({ repoRoot: HARBOR }));
  });
});

describe('purity', () => {
  test('same input, same output; the input is not mutated', () => {
    const files = harbor002();
    const locks = reading([lock('ISC-75', 's')]);
    const before = JSON.stringify({ files, locks });
    const a = buildClaimViews({ files, locks, noteCounts: { 'ISC-51': 3 } });
    const b = buildClaimViews({ files, locks, noteCounts: { 'ISC-51': 3 } });
    expect(a).toEqual(b);
    expect(JSON.stringify({ files, locks })).toBe(before);
  });

  test('the module uses no Bun API, no node: import and no clock', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'claim-view.ts'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    expect(source).toContain('export function buildClaimViews');
    expect(source).not.toMatch(/\bBun\b|from ['"](?:node:|bun:)|\bDate\b|Math\.random/);
  });
});
