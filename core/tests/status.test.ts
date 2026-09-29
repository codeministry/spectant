// Claim partition and drift classes (spec 001 T34, fill-in for ISC-6). Port of the old SpecStatus tool: the partition
// is IsaFrontier's computeFrontier, the audit is computeDrift with its seven classes as SpecFormat.md § "The status
// contract" defines them. Measured on the fixture trees; the partition numbers for spectant-001 are the ones the old
// tool printed for spec 001 on 2026-09-29, and the harbor/lantern/leadgen numbers are the old frontier's own output
// on the same files. Every drift class also gets one synthetic case, built by mutating a parsed copy.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseClaims, type Claim, type ClaimsDocument } from '../src/claims.ts';
import type { ClaimLock } from '../src/files.ts';
import { parseFrontmatter, type FrontmatterResult } from '../src/frontmatter.ts';
import { reviewedGate } from '../src/gates.ts';
import {
  driftReport,
  hasDrift,
  masterProgressMismatch,
  partitionClaims,
  type DriftClass,
  type DriftInput,
  type DriftReport,
} from '../src/status.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

interface Parsed {
  readonly frontmatter: FrontmatterResult;
  readonly doc: ClaimsDocument;
}

function load(rel: string): Parsed {
  const text = readFileSync(join(FIXTURES, rel), 'utf8');
  return { frontmatter: parseFrontmatter(text), doc: parseClaims(text) };
}

/** `specs/NNN-*` and `specs/archive/NNN-*` folders of a fixture tree that hold a spec.md, relative to the tree. */
function specFolders(tree: string): string[] {
  const out: string[] = [];
  for (const prefix of ['specs', join('specs', 'archive')]) {
    const base = join(FIXTURES, tree, prefix);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      if (/^\d{3}-/.test(name) && existsSync(join(base, name, 'spec.md'))) out.push(join(prefix, name));
    }
  }
  return out;
}

/** The claim IDs every other spec folder of the tree holds, as the old tool's allSpecIds map did. */
function heldElsewhere(tree: string, folder: string): Set<string> {
  const ids = new Set<string>();
  for (const other of specFolders(tree)) {
    if (other === folder) continue;
    for (const c of load(join(tree, other, 'spec.md')).doc.claims) ids.add(c.id);
  }
  return ids;
}

function driftFor(tree: string, folder: string): DriftReport {
  const spec = load(join(tree, folder, 'spec.md'));
  const master = load(join(tree, 'ISA.md'));
  return driftReport({ frontmatter: spec.frontmatter, spec: spec.doc, master: master.doc, heldElsewhere: heldElsewhere(tree, folder) });
}

/** Locks from a `.spectant/activity.jsonl`: a `claim` line without a later `release` for the same claim. */
function activityLocks(rel: string): ClaimLock[] {
  const open = new Map<string, ClaimLock>();
  for (const line of readFileSync(join(FIXTURES, rel), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const e = JSON.parse(line) as { ts: string; event: string; claim: string; session: string };
    if (e.event === 'claim') open.set(e.claim, { source: 'activity', claim: e.claim, session: e.session, since: e.ts });
    else if (e.event === 'release') open.delete(e.claim);
  }
  return [...open.values()];
}

const CLEAN: DriftReport = {
  unknown_to_master: [],
  state_mismatch: [],
  progress_mismatch: null,
  closed_without_evidence: [],
  evidence_without_close: [],
  missing_in_spec: [],
  anchors_missing_at_complete: 0,
};

const HARBOR_002 = join('specs', '002-web-console');

describe('partitionClaims', () => {
  test('harbor 002: 25 of 30 closed, one claim blocked by an edge, the rest takeable', () => {
    const p = partitionClaims(load(join('harbor', HARBOR_002, 'spec.md')).doc.claims, [], 'fresh');
    expect(p.closed.length).toBe(25);
    expect(p.takeable.length).toBe(4);
    expect(p.blocked).toEqual([{ id: 'ISC-78', openBlockers: ['ISC-77'] }]);
    expect(p.taken).toEqual([]);
    expect(p.open.length).toBe(5);
    expect(p.dropped).toEqual([]);
    expect(p.diagnostics).toEqual([]);
  });

  test('harbor 002 with the activity lock: ISC-74 is taken, not takeable', () => {
    const locks = activityLocks(join('harbor', '.spectant', 'activity.jsonl'));
    expect(locks.map((l) => l.claim)).toEqual(['ISC-74']);
    const p = partitionClaims(load(join('harbor', HARBOR_002, 'spec.md')).doc.claims, locks, 'fresh');
    expect(p.taken).toEqual([{ id: 'ISC-74', session: 'spec-002-ISC-74', since: '2026-03-08T14:06:00Z' }]);
    expect(p.takeable).not.toContain('ISC-74');
    expect([p.closed.length, p.takeable.length, p.blocked.length, p.taken.length]).toEqual([25, 3, 1, 1]);
  });

  test('spectant-001: 14 closed, 29 takeable, 4 blocked (the old tool on 2026-09-29)', () => {
    const p = partitionClaims(load(join('spectant-001', 'specs', '001-app-skeleton', 'spec.md')).doc.claims, [], 'fresh');
    expect([p.closed.length, p.takeable.length, p.blocked.length, p.taken.length]).toEqual([14, 29, 4, 0]);
    expect(p.blocked.map((b) => `${b.id}<${b.openBlockers.join(',')}`)).toEqual([
      'ISC-60.1<ISC-60',
      'ISC-60.2<ISC-60',
      'ISC-61.1<ISC-61',
      'ISC-62.1<ISC-62',
    ]);
  });

  // [closed, takeable, blocked] as the old frontier computes them on the same files.
  const FRONTIER: Record<string, [number, number, number]> = {
    'harbor/specs/003-config-loader/spec.md': [0, 7, 6],
    'harbor/specs/004-retention-policies/spec.md': [30, 0, 0],
    'harbor/specs/005-config-format-choice/spec.md': [0, 1, 0],
    'harbor/specs/006-partial-push/spec.md': [0, 4, 0],
    'harbor/specs/archive/001-manifest-sync/spec.md': [46, 0, 0],
    'harbor/ISA.md': [101, 16, 7],
    'lantern/specs/001-reading-list/spec.md': [4, 2, 2],
    'lantern/ISA.md': [4, 6, 2],
    'leadgen/specs/012-pwa-install/spec.md': [9, 1, 0],
    'leadgen/specs/022-chat-turn-status-and-bulk-delete/spec.md': [8, 0, 0],
    'leadgen/specs/archive/013-tech-debt/spec.md': [15, 0, 0],
    'leadgen/ISA.md': [32, 1, 0],
  };
  for (const [rel, expected] of Object.entries(FRONTIER)) {
    test(`parity with the old frontier: ${rel}`, () => {
      const p = partitionClaims(load(rel).doc.claims, [], 'fresh');
      expect([p.closed.length, p.takeable.length, p.blocked.length]).toEqual(expected);
      expect(p.closed.length + p.open.length).toBe(load(rel).doc.claims.length);
    });
  }

  test('a tombstone is closed and listed as dropped; a dropped blocker frees its dependant', () => {
    const base = load(join('harbor', HARBOR_002, 'spec.md')).doc.claims;
    const claims: Claim[] = base.map((c) => (c.id === 'ISC-77' ? { ...c, dropped: true } : c));
    const p = partitionClaims(claims, [], 'fresh');
    expect(p.dropped).toEqual(['ISC-77']);
    expect(p.closed).toContain('ISC-77');
    expect(p.open).not.toContain('ISC-77');
    expect(p.blocked).toEqual([]);
    expect(p.takeable).toContain('ISC-78');
  });

  test('an edge to an unknown ID stays unmet and is reported as a diagnostic', () => {
    const base = load(join('harbor', HARBOR_002, 'spec.md')).doc.claims;
    const claims: Claim[] = base.map((c) => (c.id === 'ISC-74' ? { ...c, after: ['ISC-999'] } : c));
    const p = partitionClaims(claims, [], 'fresh');
    expect(p.blocked).toContainEqual({ id: 'ISC-74', openBlockers: ['ISC-999'] });
    expect(p.diagnostics).toHaveLength(1);
    expect(p.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'status-edge-unknown', line: claims.find((c) => c.id === 'ISC-74')?.line });
    expect(p.diagnostics[0]?.message).toContain('ISC-999');
  });

  test('a blocked claim stays blocked even while a lock names it; a lock on a closed claim changes nothing', () => {
    const claims = load(join('harbor', HARBOR_002, 'spec.md')).doc.claims;
    const closedId = claims.find((c) => c.checked)?.id ?? '';
    const locks: ClaimLock[] = [
      { source: 'frontier', claim: 'ISC-78', session: 's1', since: '2026-03-08T10:00:00Z' },
      { source: 'frontier', claim: closedId, session: 's2', since: '2026-03-08T10:00:00Z' },
    ];
    const p = partitionClaims(claims, locks, 'fresh');
    expect(p.blocked.map((b) => b.id)).toEqual(['ISC-78']);
    expect(p.taken).toEqual([]);
    expect(p.closed).toContain(closedId);
  });

  test('no claims: an empty partition', () => {
    const p = partitionClaims([], [], 'fresh');
    expect(p).toEqual({ closed: [], takeable: [], blocked: [], taken: [], open: [], dropped: [], gated: [], reviewed: 'fresh', diagnostics: [] });
  });
});

describe('driftReport on the fixture trees', () => {
  const CLEAN_PAIRS: Array<[string, string]> = [
    ['harbor', join('specs', 'archive', '001-manifest-sync')],
    ['harbor', HARBOR_002],
    ['harbor', join('specs', '003-config-loader')],
    ['harbor', join('specs', '004-retention-policies')],
    ['harbor', join('specs', '005-config-format-choice')],
    ['lantern', join('specs', '001-reading-list')],
    ['lantern', join('specs', '002-duplicate-links')],
    ['spectant-001', join('specs', '001-app-skeleton')],
    ['leadgen', join('specs', '012-pwa-install')],
    ['leadgen', join('specs', '022-chat-turn-status-and-bulk-delete')],
    ['leadgen', join('specs', 'archive', '013-tech-debt')],
  ];
  for (const [tree, folder] of CLEAN_PAIRS) {
    test(`${tree}/${folder} against its master: no drift`, () => {
      const report = driftFor(tree, folder);
      expect(report).toEqual(CLEAN);
      expect(hasDrift(report)).toBe(false);
    });
  }

  test('harbor 006 carries the two findings the README plants: ISC-125 unknown to the master, ISC-4 not projected', () => {
    const report = driftFor('harbor', join('specs', '006-partial-push'));
    expect(report).toEqual({ ...CLEAN, unknown_to_master: ['ISC-125'], missing_in_spec: ['ISC-4'] });
    expect(hasDrift(report)).toBe(true);
  });

  test('master progress: only the leadgen master drifts (declared 31/33, recount 31/32), the expected finding', () => {
    const found: Record<string, unknown> = {};
    for (const tree of ['harbor', 'lantern', 'spectant-001', 'leadgen', 'empty-master']) {
      const master = load(join(tree, 'ISA.md'));
      const mismatch = masterProgressMismatch(master.frontmatter, master.doc);
      if (mismatch) found[tree] = mismatch;
    }
    expect(found).toEqual({ leadgen: { file: 'ISA.md', declared: '31/33', counted: '31/32' } });
  });

  test('without a master, ID and state drift are not checked', () => {
    const spec = load(join('harbor', 'specs', '006-partial-push', 'spec.md'));
    const report = driftReport({ frontmatter: spec.frontmatter, spec: spec.doc, master: null });
    expect(report).toEqual(CLEAN);
  });
});

describe('driftReport: one synthetic case per class', () => {
  const spec = load(join('harbor', HARBOR_002, 'spec.md'));
  const master = load(join('harbor', 'ISA.md'));
  const base: DriftInput = {
    frontmatter: spec.frontmatter,
    spec: spec.doc,
    master: master.doc,
    heldElsewhere: heldElsewhere('harbor', HARBOR_002),
  };
  const firstClosed = spec.doc.claims.find((c) => c.checked && !c.dropped)?.id ?? '';
  const firstOpen = spec.doc.claims.find((c) => !c.checked && !c.dropped)?.id ?? '';

  /** Only the named classes are dirty. */
  function onlyDirty(report: DriftReport, ...classes: DriftClass[]): void {
    const dirty = (Object.keys(CLEAN) as DriftClass[]).filter((k) => JSON.stringify(report[k]) !== JSON.stringify(CLEAN[k]));
    expect(dirty.sort()).toEqual([...classes].sort());
    expect(hasDrift(report)).toBe(true);
  }

  test('the base pair is clean', () => {
    expect(driftReport(base)).toEqual(CLEAN);
    expect(firstClosed).not.toBe('');
    expect(firstOpen).not.toBe('');
  });

  test('unknown_to_master: the spec mints an ID', () => {
    const template = spec.doc.claims[0];
    if (!template) throw new Error('harbor 002 holds no claim');
    const minted: Claim = { ...template, id: 'ISC-900', checked: false };
    const report = driftReport({ ...base, spec: { ...spec.doc, claims: [...spec.doc.claims, minted] } });
    expect(report.unknown_to_master).toEqual(['ISC-900']);
    onlyDirty(report, 'unknown_to_master', 'progress_mismatch');
  });

  test('missing_in_spec: a claim of the F2 block the spec does not hold', () => {
    const f2 = master.doc.features.find((f) => f.id === 'F2');
    const target = f2?.claims.find((id) => spec.doc.claims.some((c) => c.id === id && !c.checked)) ?? '';
    const claims = spec.doc.claims.filter((c) => c.id !== target);
    const report = driftReport({ ...base, spec: { ...spec.doc, claims } });
    expect(report.missing_in_spec).toEqual([target]);
    onlyDirty(report, 'missing_in_spec', 'progress_mismatch');
  });

  test('missing_in_spec: a claim another spec folder holds is not missing, nor is a dropped master claim', () => {
    const target = master.doc.features.find((f) => f.id === 'F2')?.claims.find((id) => spec.doc.claims.some((c) => c.id === id && !c.checked)) ?? '';
    const claims = spec.doc.claims.filter((c) => c.id !== target);
    const withOwner = driftReport({ ...base, spec: { ...spec.doc, claims }, heldElsewhere: new Set([target]) });
    expect(withOwner.missing_in_spec).toEqual([]);
    const droppedMaster = master.doc.claims.map((c) => (c.id === target ? { ...c, dropped: true } : c));
    const withTomb = driftReport({ ...base, spec: { ...spec.doc, claims }, master: { ...master.doc, claims: droppedMaster } });
    expect(withTomb.missing_in_spec).toEqual([]);
  });

  test('missing_in_spec: claims from other master blocks in the spec are not drift', () => {
    const f0 = master.doc.claims.find((c) => c.feature === 'F0');
    if (!f0) throw new Error('the harbor master holds no F0 claim');
    const report = driftReport({ ...base, spec: { ...spec.doc, claims: [...spec.doc.claims, f0] } });
    expect(report.unknown_to_master).toEqual([]);
    expect(report.missing_in_spec).toEqual([]);
  });

  test('state_mismatch: closed in the master, open in the spec, with direction', () => {
    const claims = spec.doc.claims.map((c) => (c.id === firstClosed ? { ...c, checked: false } : c));
    const report = driftReport({ ...base, spec: { ...spec.doc, claims } });
    expect(report.state_mismatch).toEqual([{ id: firstClosed, spec: 'open', master: 'closed' }]);
    // the unchecked claim still has its Verification line, and the frontmatter still says 25/30
    onlyDirty(report, 'state_mismatch', 'evidence_without_close', 'progress_mismatch');
  });

  test('state_mismatch: dropped in the spec, open in the master', () => {
    const claims = spec.doc.claims.map((c) => (c.id === firstOpen ? { ...c, dropped: true } : c));
    const report = driftReport({ ...base, spec: { ...spec.doc, claims } });
    expect(report.state_mismatch).toEqual([{ id: firstOpen, spec: 'dropped', master: 'open' }]);
  });

  test('progress_mismatch: the declared fraction disagrees with the recount', () => {
    const frontmatter: FrontmatterResult = {
      ...spec.frontmatter,
      data: { ...spec.frontmatter.data, progress: { closed: 24, total: 30 } },
      values: { ...spec.frontmatter.values, progress: '24/30' },
    };
    const report = driftReport({ ...base, frontmatter });
    expect(report.progress_mismatch).toEqual({ file: 'spec.md', declared: '24/30', counted: '25/30' });
    onlyDirty(report, 'progress_mismatch');
  });

  test('progress_mismatch: a missing progress key is a mismatch with declared null', () => {
    const values = Object.fromEntries(Object.entries(spec.frontmatter.values).filter(([k]) => k !== 'progress'));
    const frontmatter: FrontmatterResult = { ...spec.frontmatter, data: { ...spec.frontmatter.data, progress: null }, values };
    expect(driftReport({ ...base, frontmatter }).progress_mismatch).toEqual({ file: 'spec.md', declared: null, counted: '25/30' });
  });

  test('closed_without_evidence: a closed claim loses its Verification line', () => {
    const verification = spec.doc.verification.filter((v) => v.id !== firstClosed);
    const report = driftReport({ ...base, spec: { ...spec.doc, verification } });
    expect(report.closed_without_evidence).toEqual([firstClosed]);
    onlyDirty(report, 'closed_without_evidence');
  });

  test('evidence_without_close: a Verification line for a claim still open', () => {
    const verification = [...spec.doc.verification, { id: firstOpen, text: 'probe green', line: 999 }];
    const report = driftReport({ ...base, spec: { ...spec.doc, verification } });
    expect(report.evidence_without_close).toEqual([firstOpen]);
    onlyDirty(report, 'evidence_without_close');
  });

  test('anchors_missing_at_complete: phase complete, a goal set, rows without anchors_to', () => {
    const frontmatter: FrontmatterResult = { ...spec.frontmatter, data: { ...spec.frontmatter.data, phase: 'complete' } };
    const rows = spec.doc.testStrategy;
    const testStrategy = rows.map((r, i) => (i === 0 ? { ...r, anchorsTo: '' } : i === 1 ? { ...r, cells: 5, anchorsTo: '' } : r));
    const doc = { ...spec.doc, testStrategy };
    const withGoal = { ...frontmatter, data: { ...frontmatter.data, principalStatedGoal: 'a goal' } };
    const report = driftReport({ ...base, frontmatter: withGoal, spec: doc });
    expect(report.anchors_missing_at_complete).toBe(2);
    onlyDirty(report, 'anchors_missing_at_complete');
    // without a goal, or before complete, the gate does not apply
    const noGoal = { ...frontmatter, data: { ...frontmatter.data, principalStatedGoal: null } };
    expect(driftReport({ ...base, frontmatter: noGoal, spec: doc }).anchors_missing_at_complete).toBe(0);
    expect(driftReport({ ...base, spec: doc }).anchors_missing_at_complete).toBe(0);
  });
});

describe('hasDrift', () => {
  test('clean is false, each class alone is true', () => {
    expect(hasDrift(CLEAN)).toBe(false);
    const dirty: DriftReport[] = [
      { ...CLEAN, unknown_to_master: ['ISC-1'] },
      { ...CLEAN, state_mismatch: [{ id: 'ISC-1', spec: 'open', master: 'closed' }] },
      { ...CLEAN, progress_mismatch: { file: 'spec.md', declared: '1/2', counted: '0/2' } },
      { ...CLEAN, closed_without_evidence: ['ISC-1'] },
      { ...CLEAN, evidence_without_close: ['ISC-1'] },
      { ...CLEAN, missing_in_spec: ['ISC-1'] },
      { ...CLEAN, anchors_missing_at_complete: 1 },
    ];
    expect(dirty.map(hasDrift)).toEqual([true, true, true, true, true, true, true]);
  });
});

// ISC-99: a claim is takeable only while the spec's reviewed mark is fresh; before that every would-be-takeable claim
// is `open`, held by the gate, with one diagnostic naming the reason. Blocked and taken claims keep their state.
describe('review gate', () => {
  const HARBOR_003 = join('harbor', 'specs', '003-config-loader');
  const folderTexts = (rel: string): Record<string, string> => {
    const read = (name: string) => (existsSync(join(FIXTURES, rel, name)) ? readFileSync(join(FIXTURES, rel, name), 'utf8') : undefined);
    const texts = { spec: read('spec.md'), plan: read('plan.md'), tasks: read('tasks.md'), gateReviewed: read(join('.gates', 'reviewed.json')) };
    return Object.fromEntries(Object.entries(texts).filter((e): e is [string, string] => e[1] !== undefined));
  };

  test('no mark: 0 takeable, every would-be-takeable claim open and gated, with the diagnostic', () => {
    const claims = load(join(HARBOR_003, 'spec.md')).doc.claims;
    const before = partitionClaims(claims, [], 'fresh');
    const p = partitionClaims(claims, [], 'missing');
    expect(before.takeable.length).toBe(7);
    expect(p.takeable).toEqual([]);
    expect(p.gated).toEqual(before.takeable);
    expect(p.reviewed).toBe('missing');
    expect([p.open, p.blocked, p.taken, p.closed, p.dropped]).toEqual([before.open, before.blocked, before.taken, before.closed, before.dropped]);
    const gate = p.diagnostics.filter((d) => d.code === 'status-review-gate');
    expect(gate).toHaveLength(1);
    expect(gate[0]?.message).toContain('reviewed mark is missing');
    expect(gate[0]?.message).toContain('7 claims');
  });

  test('stale mark: the same hold, with the stale wording', () => {
    const claims = load(join(HARBOR_003, 'spec.md')).doc.claims;
    const p = partitionClaims(claims, [], 'stale');
    expect(p.takeable).toEqual([]);
    expect(p.gated).toHaveLength(7);
    const gate = p.diagnostics.find((d) => d.code === 'status-review-gate');
    expect(gate?.message).toContain('reviewed mark is stale');
  });

  test('fresh mark: the partition is the one computed before the gate existed', () => {
    const p = partitionClaims(load(join('harbor', HARBOR_002, 'spec.md')).doc.claims, [], 'fresh');
    expect([p.closed.length, p.takeable.length, p.blocked.length, p.taken.length, p.open.length]).toEqual([25, 4, 1, 0, 5]);
    expect(p.gated).toEqual([]);
    expect(p.diagnostics).toEqual([]);
  });

  test('a gated spec with nothing takeable carries no gate diagnostic', () => {
    const claims = load(join('harbor', HARBOR_002, 'spec.md')).doc.claims.map((c) => ({ ...c, checked: true }));
    expect(partitionClaims(claims, [], 'missing').diagnostics).toEqual([]);
  });

  test('read from the folders: harbor 003 (no mark) has 0 takeable, harbor 002 (fresh mark) is unchanged', () => {
    const g003 = reviewedGate(folderTexts(HARBOR_003));
    const g002 = reviewedGate(folderTexts(join('harbor', HARBOR_002)));
    expect(g003.check.state).toBe('missing');
    expect(g002.check.state).toBe('fresh');
    expect(partitionClaims(load(join(HARBOR_003, 'spec.md')).doc.claims, [], g003.check.state).takeable).toHaveLength(0);
    expect(partitionClaims(load(join('harbor', HARBOR_002, 'spec.md')).doc.claims, [], g002.check.state).takeable).toHaveLength(4);
  });
});
