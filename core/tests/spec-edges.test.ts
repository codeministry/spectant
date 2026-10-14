// Spec edges (spec 025): a three-digit number in the `(after: …)` of a task in tasks.md or of a claim in spec.md is
// an edge on the whole spec with that number, active or archived, and may share its group with task or claim edges.
//
// The tree is `core/fixtures/edges/` (see its README): 003 mixes spec edges with claim and task edges and waits on
// the active 002 and the archived 001, 004 waits on 002 through a claim, 005 and 006 form a cycle, 007 names the
// unknown 042. `-t parse` (ISC-162) pins what the parsers read, `-t resolve` (ISC-162.1) when an edge is met against a
// merge state built by hand (the server reads it from git later), `-t diagnostics` (ISC-162.4) the unknown number and
// the cycle; holding, the stage and the overlap come with their own blocks.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildClaimViews } from '../src/claim-view.ts';
import type { ClaimView, MergeState, SpecEdge, SpecFiles, SpecWait, TaskRow } from '../src/files.ts';
import { edgeMet, resolveEdges } from '../src/spec-edges.ts';
import { specIdOf } from '../src/spec-ref.ts';
import { parseTaskLines } from '../src/tasks.ts';
import { FIXTURES, readTreeAt } from './helpers/read-tree.ts';

const ROOT = join(FIXTURES, 'edges');
const TREE = readTreeAt(ROOT);
const CONSTITUTION = TREE.constitution ?? '';

/** Every spec of the tree, active and archived, by its number. */
const SPECS = new Map<string, { files: SpecFiles; archived: boolean }>([
  ...TREE.specs.map((files) => [specIdOf(files.folder) ?? '', { files, archived: false }] as const),
  ...TREE.archived.map((files) => [specIdOf(files.folder) ?? '', { files, archived: true }] as const),
]);

function spec(num: string): SpecFiles {
  const found = SPECS.get(num);
  if (!found) throw new Error(`no spec ${num} in the edges tree`);
  return found.files;
}

function tasksOf(num: string): ReturnType<typeof parseTaskLines> {
  return parseTaskLines({ tasks: spec(num).texts.tasks ?? '', constitution: CONSTITUTION });
}

function task(num: string, id: string): TaskRow {
  const row = tasksOf(num).tasks.find((t) => t.id === id);
  if (!row) throw new Error(`no task ${id} in spec ${num}`);
  return row;
}

function claim(num: string, id: string): ClaimView {
  const view = buildClaimViews({ files: spec(num) }).claims.find((c) => c.id === id);
  if (!view) throw new Error(`no claim ${id} in spec ${num}`);
  return view;
}

/** Where a spec edge points: the folder with that number and whether it is archived; null for an unknown number. */
function target(num: string): { folder: string; archived: boolean } | null {
  const found = SPECS.get(num);
  return found ? { folder: found.files.folder, archived: found.archived } : null;
}

const THREE_DIGITS = /^\d{3}$/;

describe('spec edges: parse (ISC-162)', () => {
  test('the tree loads: six active specs and the archived 001, each with spec.md and tasks.md', () => {
    expect(TREE.specs.map((s) => s.folder)).toEqual([
      '002-stop-search',
      '003-route-map',
      '004-fare-table',
      '005-night-service',
      '006-holiday-calendar',
      '007-ticket-scan',
    ]);
    expect(TREE.archived.map((s) => s.folder)).toEqual(['001-timetable-import']);
    for (const { files } of SPECS.values()) {
      expect(files.texts.spec).toBeString();
      expect(files.texts.tasks).toBeString();
    }
  });

  test('task: a spec edge beside a task edge in one group is read apart from it', () => {
    const t2 = task('003', 'T2');
    expect(t2.afterSpecs).toEqual(['002']);
    expect(t2.edges).toEqual(['T1']);
  });

  test('task: a spec edge alone in its group names the archived spec', () => {
    const t3 = task('003', 'T3');
    expect(t3.afterSpecs).toEqual(['001']);
    expect(t3.edges).toEqual([]);
  });

  test('task: the cycle edge and the unknown number are read as spec edges', () => {
    expect(task('006', 'T1').afterSpecs).toEqual(['005']);
    expect(task('007', 'T2').afterSpecs).toEqual(['042']);
  });

  test('task: T… edges stay ordinary, a task without a spec edge carries none, a code span is no edge', () => {
    expect(task('003', 'T1').afterSpecs).toEqual([]);
    expect(task('003', 'T4').afterSpecs).toEqual([]);
    expect(task('003', 'T4').edges).toEqual(['T1']);
    expect(task('004', 'T3').afterSpecs).toEqual([]);
    expect(task('004', 'T3').edges).toEqual(['T2']);
    expect(task('002', 'T2').afterSpecs).toEqual([]);
    expect(task('002', 'T2').edges).toEqual(['T1']);
  });

  test('task: a spec number in a group is no malformed task edge', () => {
    for (const num of SPECS.keys()) {
      const codes = tasksOf(num).diagnostics.map((d) => d.code);
      expect({ spec: num, codes: codes.filter((c) => c === 'task-edge-not-task' || c === 'task-edge-unknown') }).toEqual({ spec: num, codes: [] });
    }
  });

  test('claim: a spec edge beside a claim edge in one group is read apart from it', () => {
    const c = claim('003', 'ISC-6');
    expect(c.afterSpecs).toEqual(['002']);
    expect(c.edges).toEqual(['ISC-5']);
  });

  test('claim: a spec edge alone in its group, on the archived and on the active spec', () => {
    expect(claim('003', 'ISC-7').afterSpecs).toEqual(['001']);
    expect(claim('003', 'ISC-7').edges).toEqual([]);
    expect(claim('004', 'ISC-9').afterSpecs).toEqual(['002']);
    expect(claim('004', 'ISC-9').edges).toEqual([]);
    expect(claim('005', 'ISC-10').afterSpecs).toEqual(['006']);
  });

  test('claim: ISC-… edges stay ordinary and no spec number blocks a claim as a claim edge', () => {
    expect(claim('002', 'ISC-4').afterSpecs).toEqual([]);
    expect(claim('002', 'ISC-4').edges).toEqual(['ISC-3']);
    expect(claim('003', 'ISC-5').afterSpecs).toEqual([]);
    for (const num of SPECS.keys()) {
      for (const c of buildClaimViews({ files: spec(num) }).claims) {
        expect({ claim: `${num}/${c.id}`, specs: [...c.edges, ...c.blockedBy].filter((id) => THREE_DIGITS.test(id)) }).toEqual({ claim: `${num}/${c.id}`, specs: [] });
      }
    }
  });

  test('reference: every spec edge names the spec with that number, active or archived; 042 names none', () => {
    const read: Record<string, readonly string[]> = {
      '003/T2': task('003', 'T2').afterSpecs ?? [],
      '003/T3': task('003', 'T3').afterSpecs ?? [],
      '003/ISC-6': claim('003', 'ISC-6').afterSpecs ?? [],
      '003/ISC-7': claim('003', 'ISC-7').afterSpecs ?? [],
      '004/ISC-9': claim('004', 'ISC-9').afterSpecs ?? [],
    };
    const resolved = Object.fromEntries(Object.entries(read).map(([from, nums]) => [from, nums.map(target)]));
    expect(resolved).toEqual({
      '003/T2': [{ folder: '002-stop-search', archived: false }],
      '003/T3': [{ folder: '001-timetable-import', archived: true }],
      '003/ISC-6': [{ folder: '002-stop-search', archived: false }],
      '003/ISC-7': [{ folder: '001-timetable-import', archived: true }],
      '004/ISC-9': [{ folder: '002-stop-search', archived: false }],
    });
    expect((task('007', 'T2').afterSpecs ?? []).map(target)).toEqual([null]);
  });
});

// ─── resolve (ISC-162.1) ─────────────────────────────────────────────────────────────────────────────────────────

/** A merge-state row as the server will build it from git; every case below builds its own. */
function state(spec: string, over: Partial<Omit<MergeState, 'spec'>> = {}): MergeState {
  return { spec, branch: null, merged: false, complete: false, archived: false, ...over };
}

const ARCHIVED_001 = state('001', { complete: true, archived: true });

/** 002 with an unmerged branch, the archived 001 as the archive reads it: the tree as it stands. */
const BASE: readonly MergeState[] = [ARCHIVED_001, state('002', { branch: 'feature/002-stop-search' })];

const MERGED_002: readonly MergeState[] = [ARCHIVED_001, state('002', { branch: 'feature/002-stop-search', merged: true })];

function edgesFrom(edges: readonly SpecEdge[], spec: string): string[] {
  return edges.filter((e) => e.fromSpec === spec).map((e) => `${e.fromKind} ${e.fromId} → ${e.toSpec} ${e.state}`);
}

function waitOf(waits: readonly SpecWait[], spec: string): SpecWait {
  const found = waits.find((w) => w.spec === spec);
  if (!found) throw new Error(`no wait row for ${spec}`);
  return found;
}

describe('spec edges: resolve (ISC-162.1)', () => {
  test('edgeMet: a branch decides alone; without one, phase complete or the archive meets the edge', () => {
    expect(edgeMet(state('002', { branch: 'feature/002-stop-search', merged: true }))).toBe(true);
    expect(edgeMet(state('002', { branch: 'fix/002-stop-search', complete: true, archived: true }))).toBe(false);
    expect(edgeMet(state('002', { complete: true }))).toBe(true);
    expect(edgeMet(state('002', { archived: true }))).toBe(true);
    expect(edgeMet(state('002'))).toBe(false);
  });

  test('unmerged branch: the edges on 002 are open, the edges on the archived 001 are met', () => {
    const { edges } = resolveEdges(TREE, BASE);
    expect(edgesFrom(edges, '003')).toEqual(['claim ISC-6 → 002 open', 'claim ISC-7 → 001 met', 'task T2 → 002 open', 'task T3 → 001 met']);
    expect(edgesFrom(edges, '004')).toEqual(['claim ISC-9 → 002 open']);
    expect(edgesFrom(edges, '002')).toEqual([]);
  });

  test('unmerged branch with phase complete: the branch wins, the edge stays open', () => {
    const { edges } = resolveEdges(TREE, [ARCHIVED_001, state('002', { branch: 'feature/002-stop-search', complete: true })]);
    expect(edgesFrom(edges, '004')).toEqual(['claim ISC-9 → 002 open']);
  });

  test('merged branch: every edge on 002 is met', () => {
    const { edges } = resolveEdges(TREE, MERGED_002);
    expect(edgesFrom(edges, '003')).toEqual(['claim ISC-6 → 002 met', 'claim ISC-7 → 001 met', 'task T2 → 002 met', 'task T3 → 001 met']);
    expect(edgesFrom(edges, '004')).toEqual(['claim ISC-9 → 002 met']);
  });

  test('no branch: met with phase complete, open without it', () => {
    expect(edgesFrom(resolveEdges(TREE, [ARCHIVED_001, state('002', { complete: true })]).edges, '004')).toEqual(['claim ISC-9 → 002 met']);
    expect(edgesFrom(resolveEdges(TREE, [ARCHIVED_001, state('002')]).edges, '004')).toEqual(['claim ISC-9 → 002 open']);
  });

  test('archived: met by the row, and met from the archive list when the rows leave the spec out', () => {
    expect(edgesFrom(resolveEdges(TREE, [state('001', { archived: true })]).edges, '003')).toContain('task T3 → 001 met');
    expect(edgesFrom(resolveEdges(TREE, []).edges, '003')).toContain('task T3 → 001 met');
    // Left out of the rows, 002 reads as no branch and `phase: building`: open.
    expect(edgesFrom(resolveEdges(TREE, []).edges, '004')).toEqual(['claim ISC-9 → 002 open']);
  });

  test('wait: 003 is held in part, 004 in full, 002 waits on nothing', () => {
    const { waits } = resolveEdges(TREE, BASE);
    expect(waits.map((w) => w.spec)).toEqual(['002', '003', '004', '005', '006', '007']);
    expect(waitOf(waits, '002')).toEqual({ spec: '002', blockers: [], heldTasks: 0, openTasks: 1, full: false });
    // T2 by its own edge, T4 by its claim ISC-6; T1 carries none, T3's edges on 001 are met.
    expect(waitOf(waits, '003')).toEqual({ spec: '003', blockers: ['002'], heldTasks: 2, openTasks: 4, full: false });
    expect(waitOf(waits, '004')).toEqual({ spec: '004', blockers: ['002'], heldTasks: 2, openTasks: 2, full: true });
  });

  test('wait: once 002 is merged nothing holds 003 or 004', () => {
    const { waits } = resolveEdges(TREE, MERGED_002);
    expect(waitOf(waits, '003')).toEqual({ spec: '003', blockers: [], heldTasks: 0, openTasks: 4, full: false });
    expect(waitOf(waits, '004')).toEqual({ spec: '004', blockers: [], heldTasks: 0, openTasks: 2, full: false });
  });
});

// ─── diagnostics (ISC-162.4) ─────────────────────────────────────────────────────────────────────────────────────

/** A one-claim spec whose claim carries `(after: <after>)`. */
function edgeSpec(folder: string, after: string): SpecFiles {
  return { folder, texts: { spec: `# S\n\n## Claims\n\n- [ ] ISC-1: Something holds. (after: ${after})\n` } };
}

describe('spec edges: diagnostics (ISC-162.4)', () => {
  test('an edge on a number no spec carries: exactly one warning, on the line that names it', () => {
    const unknown = resolveEdges(TREE, BASE).diagnostics.filter((d) => d.diagnostic.code === 'spec-edge-unknown');
    expect(unknown.map((d) => [d.file, d.diagnostic.severity, d.diagnostic.line, d.diagnostic.subject])).toEqual([
      ['specs/007-ticket-scan/tasks.md', 'warning', 12, '042'],
    ]);
  });

  test('the cycle 005 → 006 → 005: exactly one warning, carried by the lowest number, 005', () => {
    const cycle = resolveEdges(TREE, BASE).diagnostics.filter((d) => d.diagnostic.code === 'spec-edge-cycle');
    expect(cycle.map((d) => [d.file, d.diagnostic.severity, d.diagnostic.line, d.diagnostic.subject])).toEqual([
      ['specs/005-night-service/spec.md', 'warning', 22, '005 → 006 → 005'],
    ]);
  });

  test('the tree yields these two warnings and nothing else, each of level warning', () => {
    const { diagnostics } = resolveEdges(TREE, BASE);
    expect(diagnostics.map((d) => [d.diagnostic.severity, d.diagnostic.code])).toEqual([
      ['warning', 'spec-edge-unknown'],
      ['warning', 'spec-edge-cycle'],
    ]);
  });

  test('a cycle edge stays open even when the merge state would meet it', () => {
    const met = [...BASE, state('005', { branch: 'feature/005-night-service', merged: true }), state('006', { complete: true })];
    const { edges, waits } = resolveEdges(TREE, met);
    expect(edgesFrom(edges, '005')).toEqual(['claim ISC-10 → 006 open']);
    expect(edgesFrom(edges, '006')).toEqual(['task T1 → 005 open']);
    expect(waitOf(waits, '005')).toEqual({ spec: '005', blockers: ['006'], heldTasks: 1, openTasks: 1, full: true });
    expect(waitOf(waits, '006')).toEqual({ spec: '006', blockers: ['005'], heldTasks: 1, openTasks: 1, full: true });
  });

  test('parsing runs on: the unknown edge stays open and the edges beside it still resolve', () => {
    const { edges, waits } = resolveEdges(TREE, BASE);
    expect(edgesFrom(edges, '007')).toEqual(['task T2 → 042 open']);
    expect(waitOf(waits, '007')).toEqual({ spec: '007', blockers: ['042'], heldTasks: 1, openTasks: 2, full: false });
    expect(edgesFrom(edges, '003')).toContain('task T3 → 001 met');
  });

  test('a self edge is a cycle of one; a cycle of three gives one warning, not three', () => {
    const self = resolveEdges({ specs: [edgeSpec('010-self', '010')], archived: [] }, []);
    expect(self.diagnostics.map((d) => [d.file, d.diagnostic.code, d.diagnostic.subject])).toEqual([['specs/010-self/spec.md', 'spec-edge-cycle', '010 → 010']]);
    expect(self.edges.map((e) => e.state)).toEqual(['open']);
    const ring = resolveEdges({ specs: [edgeSpec('020-a', '021'), edgeSpec('021-b', '022'), edgeSpec('022-c', '020')], archived: [] }, [state('021', { complete: true })]);
    expect(ring.diagnostics.map((d) => [d.file, d.diagnostic.code, d.diagnostic.subject])).toEqual([['specs/020-a/spec.md', 'spec-edge-cycle', '020 → 021 → 022 → 020']]);
    expect(ring.edges.map((e) => e.state)).toEqual(['open', 'open', 'open']);
  });
});
