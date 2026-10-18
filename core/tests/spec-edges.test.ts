// Spec edges (spec 025): a three-digit number in the `(after: …)` of a task in tasks.md or of a claim in spec.md is
// an edge on the whole spec with that number, active or archived, and may share its group with task or claim edges.
//
// The tree is `core/fixtures/edges/` (see its README): 003 mixes spec edges with claim and task edges and waits on
// the active 002 and the archived 001, 004 waits on 002 through a claim, 005 and 006 form a cycle, 007 names the
// unknown 042. `-t parse` (ISC-162) pins what the parsers read, `-t resolve` (ISC-162.1) when an edge is met against a
// merge state built by hand (the server reads it from git later), `-t diagnostics` (ISC-162.4) the unknown number and
// the cycle; holding, the stage and the overlap come with their own blocks. `-t overlap` (ISC-164): 002 and 007 share
// `src/app/stops/index.ts` with no edge, 002 and 003 share `search.ts` joined by 003's edges, the archived 001 counts
// for nothing, and 004 and 005 share only `src/i18n/en.json`, which the constitution's `shared_files:` names.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildClaimViews } from '../src/claim-view.ts';
import type { ClaimView, MergeState, SpecEdge, SpecFiles, SpecWait, TaskRow } from '../src/files.ts';
import { parseClaims } from '../src/claims.ts';
import { affectedPaths, buildDashboard, sharedFilesOf, specOverlaps } from '../src/dashboard.ts';
import { buildLiveFrame } from '../src/live.ts';
import { buildPlanning } from '../src/planning.ts';
import { type GraphLens, planningGraph } from '../src/relations.ts';
import { buildSpecPage } from '../src/spec.ts';
import type { DashboardInput, OverlapSpec } from '../src/dashboard.ts';
import { hashForGate } from '../src/gates.ts';
import { edgeMet, resolveEdges } from '../src/spec-edges.ts';
import { specIdOf } from '../src/spec-ref.ts';
import { nextCommandWithReason, reasonOf, stageOf } from '../src/stage.ts';
import type { StageInput } from '../src/stage.ts';
import { partitionClaims } from '../src/status.ts';
import { takeableSet } from '../src/takeable.ts';
import type { TakeableEntry, TakeableSet } from '../src/takeable.ts';
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
    expect(waitOf(waits, '002')).toEqual({ spec: '002', blockers: [], heldTasks: 0, readyTasks: 1, openTasks: 1, full: false });
    // T2 by its own edge, T4 by its claim ISC-6; T1 carries none, T3's edges on 001 are met.
    expect(waitOf(waits, '003')).toEqual({ spec: '003', blockers: ['002'], heldTasks: 2, readyTasks: 2, openTasks: 4, full: false });
    expect(waitOf(waits, '004')).toEqual({ spec: '004', blockers: ['002'], heldTasks: 2, readyTasks: 0, openTasks: 2, full: true });
  });

  test('wait: once 002 is merged nothing holds 003 or 004', () => {
    const { waits } = resolveEdges(TREE, MERGED_002);
    expect(waitOf(waits, '003')).toEqual({ spec: '003', blockers: [], heldTasks: 0, readyTasks: 4, openTasks: 4, full: false });
    expect(waitOf(waits, '004')).toEqual({ spec: '004', blockers: [], heldTasks: 0, readyTasks: 2, openTasks: 2, full: false });
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
    expect(waitOf(waits, '005')).toEqual({ spec: '005', blockers: ['006'], heldTasks: 1, readyTasks: 0, openTasks: 1, full: true });
    expect(waitOf(waits, '006')).toEqual({ spec: '006', blockers: ['005'], heldTasks: 1, readyTasks: 0, openTasks: 1, full: true });
  });

  test('parsing runs on: the unknown edge stays open and the edges beside it still resolve', () => {
    const { edges, waits } = resolveEdges(TREE, BASE);
    expect(edgesFrom(edges, '007')).toEqual(['task T2 → 042 open']);
    expect(waitOf(waits, '007')).toEqual({ spec: '007', blockers: ['042'], unknownBlockers: ['042'], heldTasks: 1, readyTasks: 1, openTasks: 2, full: false });
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

// ─── takeable (ISC-162.2) ────────────────────────────────────────────────────────────────────────────────────────

/** The spec edges of one spec resolved against `rows`, as `takeableSet` takes them. */
function edgesOf(num: string, rows: readonly MergeState[]): SpecEdge[] {
  return resolveEdges(TREE, rows).edges.filter((e) => e.fromSpec === num);
}

/** The next round of `num` with a fresh reviewed mark, its spec edges resolved against `rows`; no tasks.md if asked. */
function roundOf(num: string, rows: readonly MergeState[], withTasks = true): TakeableSet {
  return takeableSet({
    specType: 'feature',
    claims: parseClaims(spec(num).texts.spec ?? '').claims,
    tasks: withTasks ? { tasks: tasksOf(num).tasks, probeMapping: [] } : null,
    reviewed: 'fresh',
    specEdges: edgesOf(num, rows),
  });
}

const entries = (list: readonly TakeableEntry[]): string[] => list.map((e) => `${e.task} ${e.claim}: ${e.reason}`);

describe('spec edges: takeable (ISC-162.2)', () => {
  test('a task with an open spec edge is held as waits on 002; T1 beside it is dispatched', () => {
    const round = roundOf('003', BASE);
    expect(entries(round.dispatch)).toEqual(['T1 ISC-5: claim takeable, edges closed']);
    // T2 by its own edge, T4 by the edge on its claim ISC-6, ahead of ISC-6's claim edge; T3's edge on 001 is met.
    expect(entries(round.held)).toEqual(['T2 ISC-5: waits on 002', 'T3 ISC-7: not [P] — runs alone, next round', 'T4 ISC-6: waits on 002']);
  });

  test('an open spec edge on a claim holds the claim and every task of it; nothing is left to dispatch', () => {
    const round = roundOf('004', BASE);
    expect(round.claims).toEqual([]);
    expect(round.dispatch).toEqual([]);
    expect(entries(round.held)).toEqual(['T2 ISC-9: waits on 002', 'T3 ISC-9: waits on 002']);
    expect(round.exhausted).toBe(true);
  });

  test('without tasks.md the claim unit is held the same', () => {
    expect(entries(roundOf('004', BASE, false).held)).toEqual(['C1 ISC-9: waits on 002']);
  });

  test('once the edge is met the work is takeable, unless something else holds it', () => {
    const fare = roundOf('004', MERGED_002);
    expect(fare.claims).toEqual(['ISC-9']);
    expect(entries(fare.dispatch)).toEqual(['T2 ISC-9: claim takeable, edges closed']);
    expect(entries(fare.held)).toEqual(['T3 ISC-9: after T2 still open']);
    const map = entries(roundOf('003', MERGED_002).held);
    expect(map).toContain('T2 ISC-5: after T1 still open');
    expect(map).toContain('T4 ISC-6: claim blocked by ISC-5');
  });

  test('the tasks tab: a task held by its own edge or by its claim edge reads held, waits on 002; met, the box decides', () => {
    const rows = (num: string, merge: readonly MergeState[]) =>
      parseTaskLines({ tasks: spec(num).texts.tasks ?? '', constitution: CONSTITUTION, specEdges: edgesOf(num, merge) }).tasks.map((t) => `${t.id} ${t.status}: ${String(t.reason)}`);
    // 003: T2 by its own edge, T4 by the edge on its claim ISC-6; T3's edge on the archived 001 is met.
    expect(rows('003', BASE)).toEqual(['T1 open: null', 'T2 held: waits on 002', 'T3 open: null', 'T4 held: waits on 002']);
    // 004: only the claim ISC-9 carries the edge, and it holds both of its open tasks; the landed T1 stays done.
    expect(rows('004', BASE)).toEqual(['T1 done: null', 'T2 held: waits on 002', 'T3 held: waits on 002']);
    expect(rows('004', MERGED_002)).toEqual(['T1 done: null', 'T2 open: null', 'T3 open: null']);
    expect(rows('007', BASE)).toContain('T2 held: waits on 042');
  });

  test('an edge on a number no spec carries holds too: waits on 042', () => {
    expect(entries(roundOf('007', BASE).held)).toContain('T2 ISC-13: waits on 042');
  });

  test('takeable on the row: the dashboard row partition equals the claim view partition, 003 and 004, base and merged', () => {
    const viewFiles = (num: string): SpecFiles => {
      const files = reviewedTree().specs.find((f) => specIdOf(f.folder) === num);
      if (!files) throw new Error(`no spec ${num}`);
      return files;
    };
    const both = (rows: readonly MergeState[], num: string) => {
      const row = buildDashboard({ ...reviewedTree(), mergeState: rows }).specs.find((r) => r.id === num);
      if (!row) throw new Error(`no row ${num}`);
      const view = buildClaimViews({ files: viewFiles(num), specEdges: edgesOf(num, rows) });
      return { row: row.takeable, view: view.claims.filter((c) => c.state === 'takeable').map((c) => c.id), count: view.counts.takeable };
    };
    for (const rows of [BASE, MERGED_002]) {
      for (const num of ['003', '004']) {
        const { row, view, count } = both(rows, num);
        expect({ num, row }).toEqual({ num, row: view });
        expect(row.length).toBe(count);
      }
    }
    // 004's ISC-9 waits on 002: blocked in the tab, so not takeable on the row; merged, it is takeable on both.
    expect(both(BASE, '004').row).toEqual([]);
    expect(both(MERGED_002, '004').row).toEqual(['ISC-9']);
    expect(both(BASE, '003').row).toEqual(['ISC-5', 'ISC-7']);
  });

  test('takeable on the row: a partial hold whose only takeable claim waits on a spec stands on blocked with waits on', () => {
    const text = (after: string) =>
      [
        '---',
        'slug: 060-partial',
        'spec_type: bug',
        'phase: building',
        'progress: 0/2',
        '---',
        '',
        '# 060 — partial',
        '',
        '## Claims',
        '',
        `- [ ] ISC-1: The first holds.${after}`,
        '- [ ] ISC-2: The second holds. (after: ISC-1)',
        '',
      ].join('\n');
    const rowOf = (after: string) => {
      const t = text(after);
      const mark = { gate: 'reviewed', at: '2026-03-09T09:00:00Z', files: { 'spec.md': hashForGate('spec.md', t), 'plan.md': null, 'tasks.md': null } };
      const files: SpecFiles = { folder: '060-partial', texts: { spec: t, gateReviewed: JSON.stringify(mark) } };
      const row = buildDashboard({ master: null, constitution: null, tldr: null, specs: [files], archived: [] }).specs[0];
      if (!row) throw new Error('no row 060');
      const tab = buildClaimViews({ files, specEdges: resolveEdges({ specs: [files], archived: [] }, []).edges }).counts.takeable;
      return { takeable: row.takeable, stage: row.stage, reason: row.nextReason, full: row.waits?.full ?? null, tab };
    };
    // ISC-2 is held by its claim edge, not by a spec edge: the hold is partial, yet nothing else is takeable.
    expect(rowOf(' (after: 042)')).toEqual({ takeable: [], stage: 'blocked', reason: 'waits on 042', full: false, tab: 0 });
    expect(rowOf('')).toEqual({ takeable: ['ISC-1'], stage: 'build', reason: 'ISC-1 is takeable', full: null, tab: 1 });
  });

  test('without spec edges the set is as before', () => {
    const round = takeableSet({ specType: 'feature', claims: parseClaims(spec('004').texts.spec ?? '').claims, tasks: { tasks: tasksOf('004').tasks, probeMapping: [] }, reviewed: 'fresh' });
    expect(entries(round.dispatch)).toEqual(['T2 ISC-9: claim takeable, edges closed']);
  });
});

// ─── stage (ISC-162.3) ───────────────────────────────────────────────────────────────────────────────────────────

/** The stage input of a spec as the dashboard builds it, reviewed fresh, with its wait (none when `waits` is null). */
function stageInputOf(num: string, text: string, waits: SpecWait | null): StageInput {
  const doc = parseClaims(text);
  const p = partitionClaims(doc.claims, [], 'fresh');
  return {
    number: num,
    type: 'feature',
    phase: 'building',
    hasPlan: true,
    hasTasks: true,
    claims: doc.counted,
    reviewed: 'fresh',
    codeReviewed: 'missing',
    takeable: p.takeable,
    partition: { takeable: p.takeable.length, open: p.open.length - p.takeable.length, closed: p.closed.length - p.dropped.length, dropped: p.dropped.length },
    explicitStage: null,
    lastEventTo: null,
    lastEventFrom: null,
    codeReview: 'spec',
    mainFeature: null,
    featureSiblingsOpen: [],
    ...(waits === null ? {} : { waits }),
  };
}

function stepFor(input: StageInput): { stage: string; command: string | null; reason: string } {
  const next = nextCommandWithReason(input);
  return { stage: stageOf(input), command: next.command, reason: reasonOf(next) };
}

/** The step of a spec of the tree, its wait resolved against `rows`; null passes no wait. */
const stepOf = (num: string, rows: readonly MergeState[] | null) =>
  stepFor(stageInputOf(num, spec(num).texts.spec ?? '', rows === null ? null : waitOf(resolveEdges(TREE, rows).waits, num)));

/** The edges tree with a fresh reviewed mark on every active spec, so the dashboard's stage reaches the edge rule. */
function reviewedTree(): DashboardInput {
  const hash = (f: 'spec.md' | 'plan.md' | 'tasks.md', text: string | undefined) => (text === undefined ? null : hashForGate(f, text));
  const specs = TREE.specs.map((files): SpecFiles => {
    const t = files.texts;
    const mark = { gate: 'reviewed', at: '2026-03-09T09:00:00Z', files: { 'spec.md': hash('spec.md', t.spec), 'plan.md': hash('plan.md', t.plan), 'tasks.md': hash('tasks.md', t.tasks) } };
    return { folder: files.folder, texts: { ...t, gateReviewed: JSON.stringify(mark) } };
  });
  return { ...TREE, specs };
}

describe('spec edges: stage (ISC-162.3)', () => {
  test('full hold: every open piece of work waits on 002, so the stage is blocked with that reason', () => {
    expect(stepOf('004', BASE)).toEqual({ stage: 'blocked', command: '/spec-status 004', reason: 'waits on 002' });
  });

  test('partial hold: 003 has takeable work beside the held, so it stays on build', () => {
    expect(stepOf('003', BASE)).toEqual({ stage: 'build', command: '/spec-implement 003', reason: 'ISC-5 and ISC-7 are takeable' });
    expect(stepOf('007', BASE).stage).toBe('build');
  });

  test('the edge met, or no wait passed: the stage is the one before', () => {
    expect(stepOf('004', MERGED_002)).toEqual({ stage: 'build', command: '/spec-implement 004', reason: 'ISC-9 is takeable' });
    expect(stepOf('004', null)).toEqual({ stage: 'build', command: '/spec-implement 004', reason: 'ISC-9 is takeable' });
  });

  test('an unknown number holds like any open edge, and several blockers are named in order', () => {
    const lone = edgeSpec('050-lone', '042');
    const one = waitOf(resolveEdges({ specs: [lone], archived: [] }, []).waits, '050');
    expect(stepFor(stageInputOf('050', lone.texts.spec ?? '', one)).reason).toBe('waits on 042');
    const two = edgeSpec('051-two', '043, 042');
    const both = waitOf(resolveEdges({ specs: [two], archived: [] }, []).waits, '051');
    expect(stepFor(stageInputOf('051', two.texts.spec ?? '', both))).toEqual({ stage: 'blocked', command: '/spec-status 051', reason: 'waits on 042, 043' });
  });

  test('the dashboard reads the merge state beside its input: 004 blocked, 003 on build; merged, 004 on build', () => {
    const rowsAt = (rows?: readonly MergeState[]) =>
      buildDashboard(rows === undefined ? reviewedTree() : { ...reviewedTree(), mergeState: rows }).specs.map((r) => `${r.slug} ${r.stage}: ${r.nextReason}`);
    expect(rowsAt(BASE)).toContain('004-fare-table blocked: waits on 002');
    expect(rowsAt(BASE)).toContain('003-route-map build: ISC-5 and ISC-7 are takeable');
    expect(rowsAt(MERGED_002)).toContain('004-fare-table build: ISC-9 is takeable');
    // Without rows, 002 is read from its frontmatter (`phase: building`, no branch): the edge stays open.
    expect(rowsAt()).toContain('004-fare-table blocked: waits on 002');
  });
});

/** The `spec-overlap` warnings of a dashboard: the row that carries each and its pair. */
function overlapsOf(input: DashboardInput): Array<{ at: string; specs: readonly string[]; paths: readonly string[]; waiting: string; edge: string }> {
  return buildDashboard(input).specs.flatMap((r) =>
    r.warnings.flatMap((w) => (w.kind === 'spec-overlap' && w.overlap !== undefined ? [{ at: r.id, ...w.overlap }] : [])),
  );
}

/** The tree with the spec.md and tasks.md of spec `num` changed by `edit`. */
function editSpec(input: DashboardInput, num: string, edit: (text: string) => string): DashboardInput {
  const specs = input.specs.map((files): SpecFiles => {
    if (specIdOf(files.folder) !== num) return files;
    const t = files.texts;
    return { folder: files.folder, texts: { ...t, ...(t.spec === undefined ? {} : { spec: edit(t.spec) }), ...(t.tasks === undefined ? {} : { tasks: edit(t.tasks) }) } };
  });
  return { ...input, specs };
}

const overlapSpec = (num: string, paths: readonly string[], stage: OverlapSpec['stage'] = 'build', closed = 0, total = 2): OverlapSpec => ({
  num,
  stage,
  progress: { closed, total },
  paths,
});

describe('spec edges: overlap (ISC-164)', () => {
  test('two open specs share a file and no edge joins them: exactly one spec-overlap, on the spec that waits', () => {
    // 002 and 007 both stand on build; 007 has closed 0 of 2 claims, 002 one of 2, so 007 waits on 002.
    expect(overlapsOf({ ...reviewedTree(), mergeState: BASE })).toEqual([
      { at: '007', specs: ['002', '007'], paths: ['src/app/stops/index.ts'], waiting: '007', edge: '(after: 002)' },
    ]);
    const model = buildDashboard({ ...reviewedTree(), mergeState: BASE });
    const row = model.specs.find((r) => r.id === '007');
    expect(row?.warnings.find((w) => w.kind === 'spec-overlap')?.text).toBe('shares 1 file with 002, no edge');
    expect(model.warningGroups.find((g) => g.kind === 'spec-overlap')?.items.map((i) => i.spec)).toEqual(['007']);
  });

  test('an edge in one direction joins the pair: 002 and 003 share search.ts and give none, without the edge one', () => {
    expect(overlapsOf(TREE).some((o) => o.specs.includes('003'))).toBe(false);
    const unjoined = editSpec(TREE, '003', (text) => text.replace(/, 002\)/g, ')'));
    expect(overlapsOf(unjoined).filter((o) => o.specs.includes('003'))).toEqual([
      { at: '003', specs: ['002', '003'], paths: ['src/app/stops/search.ts'], waiting: '003', edge: '(after: 002)' },
    ]);
  });

  test('a closed spec counts for none: the archived 001 never, and 002 once complete leaves 007 without a warning', () => {
    expect(overlapsOf(TREE).some((o) => o.specs.includes('001'))).toBe(false);
    expect(overlapsOf(editSpec(TREE, '002', (text) => text.replace('phase: building', 'phase: complete')))).toEqual([]);
  });

  test('only a shared_files: path in common gives none; without the key every path counts', () => {
    expect(overlapsOf(TREE).map((o) => o.specs.join('+'))).toEqual(['002+007']);
    const bare = { ...TREE, constitution: CONSTITUTION.replace(/^shared_files:.*\n/m, '') };
    expect(overlapsOf(bare).map((o) => `${o.specs.join('+')} ${o.paths.join(', ')}`).sort()).toEqual([
      '002+005 src/i18n/en.json',
      '002+007 src/app/stops/index.ts',
      '004+005 src/i18n/en.json',
    ]);
    expect(sharedFilesOf(CONSTITUTION)).toEqual(['src/i18n/*.json', 'bun.lock']);
    expect(sharedFilesOf('---\nrepo: x\n---\n')).toEqual([]);
  });

  test('paths: the plan table and the task path column, a folder covers what lies under it, a * is a glob', () => {
    expect(affectedPaths(spec('002').texts.plan ?? '')).toEqual(['src/app/stops/search.ts', 'src/app/stops/index.ts', 'src/i18n/en.json']);
    const pairs = specOverlaps(
      [
        overlapSpec('010', ['src/app/', 'web/tasks-tab.*', './lib/one.ts']),
        overlapSpec('011', ['src/app/a/b.ts', 'web/tasks-tab.html', 'lib/one.ts', 'web/x/tasks-tab.ts']),
        overlapSpec('012', ['src/i18n/de.json', 'docs/**/*.md']),
        overlapSpec('013', ['src/i18n/de.json', 'docs/a/b/c.md', 'bun.lock']),
      ],
      [],
      ['src/i18n/*.json', 'bun.lock'],
    );
    expect(pairs.map((o) => `${o.specs.join('+')} ${o.paths.join(', ')}`)).toEqual(['010+011 lib/one.ts, src/app/a/b.ts, web/tasks-tab.html', '012+013 docs/a/b/c.md']);
  });

  test('who waits: the earlier stage, then the lower claim progress, then the higher number; an edge either way joins', () => {
    const one = (a: OverlapSpec, b: OverlapSpec) => specOverlaps([a, b], [], [])[0];
    expect(one(overlapSpec('020', ['f.ts'], 'build'), overlapSpec('021', ['f.ts'], 'plan'))).toMatchObject({ waiting: '021', edge: '(after: 020)' });
    expect(one(overlapSpec('020', ['f.ts'], 'tasks'), overlapSpec('021', ['f.ts'], 'code-review'))).toMatchObject({ waiting: '020', edge: '(after: 021)' });
    expect(one(overlapSpec('020', ['f.ts'], 'build', 0, 4), overlapSpec('021', ['f.ts'], 'blocked', 3, 4))).toMatchObject({ waiting: '020' });
    expect(one(overlapSpec('020', ['f.ts'], 'build', 1, 2), overlapSpec('021', ['f.ts'], 'build', 2, 4))).toMatchObject({ waiting: '021', edge: '(after: 020)' });
    const pair = [overlapSpec('020', ['f.ts']), overlapSpec('021', ['f.ts'])];
    expect(specOverlaps(pair, [{ fromSpec: '020', toSpec: '021' }], [])).toEqual([]);
    expect(specOverlaps(pair, [{ fromSpec: '021', toSpec: '020' }], [])).toEqual([]);
  });

  test('the edge diagnostics join the dashboard as spec-edge warnings, on the spec that carries the edge', () => {
    const model = buildDashboard({ ...reviewedTree(), mergeState: BASE });
    const edgeWarnings = model.specs.flatMap((r) => r.warnings.filter((w) => w.kind === 'spec-edge').map((w) => `${r.id} ${w.ref ?? ''}: ${w.text}`));
    expect(edgeWarnings.sort()).toEqual([
      '005 spec.md: Spec edges form the cycle 005 → 006 → 005; every edge in it stays open.',
      '007 tasks.md: The spec edge (after: 042) on T2 names no spec, active or archived; it stays open.',
    ]);
    expect(model.warningGroups.find((g) => g.kind === 'spec-edge')?.items.map((i) => i.spec).sort()).toEqual(['005', '007']);
  });
});

// ISC-163 (T17): the model data the web renders as „waits on NNN": the dashboard row, the board card (planning holder),
// the spec head, the live board's held task and the Claims tab's held claim. Once the edge is met, nothing waits.
describe('spec edges: waits (ISC-163)', () => {
  const NO_LOCKS = { source: 'none', sources: [], locks: [] } as const;
  const rowsOf = (rows: readonly MergeState[]) => buildDashboard({ ...reviewedTree(), mergeState: rows }).specs;
  const rowWaits = (rows: readonly MergeState[], num: string): SpecWait | null => {
    const row = rowsOf(rows).find((r) => r.id === num);
    if (!row) throw new Error(`no row ${num}`);
    return row.waits;
  };
  const reviewed = (num: string): SpecFiles => {
    const files = reviewedTree().specs.find((f) => specIdOf(f.folder) === num);
    if (!files) throw new Error(`no spec ${num}`);
    return files;
  };

  test('waits: the dashboard row carries the wait while an edge is open, null once it is met or never was', () => {
    expect(rowWaits(BASE, '004')).toEqual({ spec: '004', blockers: ['002'], heldTasks: 2, readyTasks: 0, openTasks: 2, full: true });
    expect(rowWaits(BASE, '003')).toEqual({ spec: '003', blockers: ['002'], heldTasks: 2, readyTasks: 2, openTasks: 4, full: false });
    expect(rowWaits(BASE, '002')).toBeNull();
    expect(rowWaits(MERGED_002, '004')).toBeNull();
    expect(rowWaits(MERGED_002, '003')).toBeNull();
  });

  test('waits: a number no spec carries is a blocker without a target, marked unknown so it renders without a link', () => {
    expect(rowWaits(BASE, '007')).toEqual({ spec: '007', blockers: ['042'], unknownBlockers: ['042'], heldTasks: 1, readyTasks: 1, openTasks: 2, full: false });
    expect(rowWaits(BASE, '004')?.unknownBlockers).toBeUndefined();
  });

  test('waits: the board card (planning holder) carries the row wait; met, it is null', () => {
    const master = ['# Master', '', '## Features', '', '### F1 · Fares', 'Why: fares matter.', '', '- [ ] ISC-8: a.', '- [ ] ISC-9: b.', ''].join('\n');
    const holderAt = (rows: readonly MergeState[]) => {
      const specStates = rowsOf(rows).map((r) => ({ slug: r.slug, stage: r.stage, stageSource: r.stageSource, waits: r.waits }));
      const model = buildPlanning({ master, specs: TREE.specs, archived: TREE.archived, specStates });
      const holder = model.features[0]?.holders.find((h) => h.id === '004');
      if (!holder) throw new Error('004 holds no claim of F1');
      return holder;
    };
    expect(holderAt(BASE).waits).toEqual({ spec: '004', blockers: ['002'], heldTasks: 2, readyTasks: 0, openTasks: 2, full: true });
    expect(holderAt(MERGED_002).waits).toBeNull();
  });

  test('waits: the spec head carries the row wait from the merge state beside the page input', () => {
    const files = reviewed('004');
    const others = [...reviewedTree().specs.filter((f) => specIdOf(f.folder) !== '004'), ...TREE.archived];
    const headAt = (rows: readonly MergeState[]) => buildSpecPage({ files, others, mergeState: rows }).head;
    expect(headAt(BASE).waits).toEqual({ spec: '004', blockers: ['002'], heldTasks: 2, readyTasks: 0, openTasks: 2, full: true });
    expect(headAt(BASE).stage).toBe('blocked');
    expect(headAt(MERGED_002).waits).toBeNull();
  });

  test('waits: a held task on the live board reads waits on 002; met, the reason is gone', () => {
    const files = { ...reviewed('004'), texts: { ...reviewed('004').texts, constitution: CONSTITUTION } };
    const open = new Set(tasksOf('004').tasks.filter((t) => t.state === 'open').map((t) => t.id));
    const reasonsAt = (rows: readonly MergeState[]) =>
      buildLiveFrame({ files, locks: NO_LOCKS, now: new Date('2026-03-10T09:00:00Z'), specEdges: edgesOf('004', rows) })
        .cards.filter((c) => open.has(c.task))
        .map((c) => `${c.task} ${c.reason ?? '-'}`);
    expect(open.size).toBeGreaterThan(0);
    expect(reasonsAt(BASE)).toEqual([...open].map((id) => `${id} waits on 002`));
    expect(reasonsAt(MERGED_002).some((r) => r.includes('waits on'))).toBe(false);
  });

  test('waits: a task carried from a round reads waits on 002 over the round reason; met, the round card is back', () => {
    // The round left T2 held and T3 dispatched; an open spec edge on 002 holds their claim ISC-9 since.
    const text = (id: string): string => task('004', id).text;
    const card = (id: string, claim: string, state: string, reason: string) => ({ id, claim, lane: 'web', seam: false, parallel: false, text: text(id), paths: [], state, reason });
    const line = {
      v: 1,
      round: 1,
      ts: '2026-03-09T10:00:00Z',
      mode: 'agent',
      width: 1,
      dispatched: ['T3'],
      tasks: [card('T1', 'ISC-8', 'done', 'claim takeable, edges closed'), card('T2', 'ISC-9', 'held', 'width 1 reached'), card('T3', 'ISC-9', 'dispatched', 'claim takeable, edges closed')],
    };
    const base = reviewed('004');
    const files = { ...base, texts: { ...base.texts, constitution: CONSTITUTION, rounds: `${JSON.stringify(line)}\n` } };
    const cardsAt = (rows: readonly MergeState[]) =>
      buildLiveFrame({ files, locks: NO_LOCKS, now: new Date('2026-03-10T09:00:00Z'), specEdges: edgesOf('004', rows) }).cards.map((c) => `${c.task} ${c.state} ${c.reason ?? '-'}`);
    expect(cardsAt(BASE)).toEqual(['T1 done claim takeable, edges closed', 'T2 waiting waits on 002', 'T3 waiting waits on 002']);
    expect(cardsAt(MERGED_002)).toEqual(['T1 done claim takeable, edges closed', 'T2 waiting width 1 reached', 'T3 dispatched claim takeable, edges closed']);
  });

  test('waits: a claim held by an open spec edge is blocked, not takeable, and names its blockers; met, it is free', () => {
    const viewAt = (rows: readonly MergeState[]) => buildClaimViews({ files: reviewed('004'), specEdges: edgesOf('004', rows) });
    const held = viewAt(BASE).claims.find((c) => c.id === 'ISC-9');
    expect(held?.state).toBe('blocked');
    expect(held?.waitsOn).toEqual(['002']);
    expect(viewAt(BASE).counts.takeable).toBe(0);
    const free = viewAt(MERGED_002).claims.find((c) => c.id === 'ISC-9');
    expect(free?.state).toBe('takeable');
    expect(free?.waitsOn).toBeUndefined();
  });
});

// ─── graph (ISC-170.1) ───────────────────────────────────────────────────────────────────────────────────────────

// The Diagram lens of spec 026 draws each spec pair joined by a spec edge as one `spec-edge` arrow from the waiting spec
// to its blocker, `open` or `met` as `resolveEdges` resolved the pair (open while any of its edges is open). The edges
// ride in the planning model (`PlanningModel.specEdges`, absent without any), so the view derives the arrows from the
// body the route serves. A master over the edges tree: F1 (001, 002) in Transit 1.0, F2 (003 to 007) in Transit 2.0.
describe('spec edges: graph (ISC-170.1)', () => {
  const MASTER = [
    '# Master',
    '',
    '## Features',
    '',
    '### F1 · Stops',
    'Why: riders start at a stop.',
    'Milestone: Transit 1.0',
    '',
    ...['- [x] ISC-1: a.', '- [x] ISC-2: b.', '- [x] ISC-3: c.', '- [ ] ISC-4: d.'],
    '',
    '### F2 · Routes',
    'Why: routes join the stops.',
    'Milestone: Transit 2.0',
    '',
    ...[5, 6, 7, 8, 9, 10, 11, 12, 13].map((n) => `- [${n === 8 ? 'x' : ' '}] ISC-${n}: claim ${n}.`),
    '',
    '## Milestones',
    '',
    '- Transit 1.0 · 2026-05-01 · Stops first.',
    '- Transit 2.0 · 2026-09-01 · Routes next.',
    '',
  ].join('\n');
  const planningAt = (rows?: readonly MergeState[]) =>
    buildPlanning({ master: MASTER, specs: TREE.specs, archived: TREE.archived, ...(rows === undefined ? {} : { specEdges: resolveEdges(TREE, rows).edges }) });
  const arrows = (graph: GraphLens): string[] => graph.edges.filter((e) => e.kind === 'spec-edge').map((e) => `${e.from} → ${e.to} ${e.state ?? '?'}`);
  const ALL_BASE = ['s_003 → s_002 open', 's_003 → s_001 met', 's_004 → s_002 open', 's_005 → s_006 open', 's_006 → s_005 open'];

  test('graph: an open and a met spec edge, one arrow per spec pair from the waiting spec to its blocker', () => {
    const graph = planningGraph(planningAt(BASE));
    // 003 waits on 002 (claim and task) and on the archived 001; 005 and 006 form a cycle, which stays open; 007's 042
    // names no spec and draws no arrow.
    expect(arrows(graph)).toEqual(ALL_BASE);
    const ids = graph.nodes.map((n) => n.id);
    for (const e of graph.edges) expect([ids.includes(e.from), ids.includes(e.to)]).toEqual([true, true]);
    expect(graph.nodes.some((n) => n.ghost === true || n.id === 's_042')).toBe(false);
    // The arrows add to the hierarchy and take nothing from it; a contains edge carries no state.
    const plain = planningGraph(planningAt());
    expect(graph.nodes).toEqual(plain.nodes);
    expect(graph.edges.filter((e) => e.kind === 'contains')).toEqual([...plain.edges]);
    expect(graph.edges.filter((e) => e.kind === 'contains').every((e) => e.state === undefined)).toBe(true);
    // 002 merged: both of its arrows are met.
    expect(arrows(planningGraph(planningAt(MERGED_002)))).toEqual(['s_003 → s_002 met', 's_003 → s_001 met', 's_004 → s_002 met', 's_005 → s_006 open', 's_006 → s_005 open']);
    // The served body carries the edges: the graph of the JSON round trip is the same.
    expect(planningGraph(JSON.parse(JSON.stringify(planningAt(BASE))) as ReturnType<typeof planningAt>)).toEqual(graph);
  });

  test('graph: a blocker outside the drawn lanes stands as a ghost node, once, in its own lane', () => {
    const model = planningAt(BASE);
    const routes = planningGraph(model, { milestone: 'milestone:transit-2-0' });
    expect(arrows(routes)).toEqual(ALL_BASE);
    expect(routes.nodes.filter((n) => n.ghost === true).map((n) => [n.id, n.kind, n.ref, n.lane, n.title, n.archived === true])).toEqual([
      ['s_002', 'spec', 'spec:002', 'milestone:transit-1-0', 'Find a stop by name as the rider types', false],
      ['s_001', 'spec', 'spec:001', 'milestone:transit-1-0', 'Import the published timetable once a day', true],
    ]);
    // Archived hidden: 001 is no card any more, so its met arrow ends at a ghost; 002 is drawn.
    const live = planningGraph(model, { archived: false });
    expect(live.nodes.filter((n) => n.ghost === true).map((n) => n.id)).toEqual(['s_001']);
    expect(arrows(live)).toContain('s_003 → s_001 met');
    // The stops lane alone draws no spec that waits: no arrow, no ghost.
    const stops = planningGraph(model, { milestone: 'milestone:transit-1-0' });
    expect([arrows(stops), stops.nodes.filter((n) => n.ghost === true)]).toEqual([[], []]);
  });

  test('graph: without spec edges the graph has no spec-edge arrow and the model carries no edges', () => {
    expect(planningAt().specEdges).toBeUndefined();
    expect(buildPlanning({ master: MASTER, specs: TREE.specs, archived: TREE.archived, specEdges: [] }).specEdges).toBeUndefined();
    expect(planningAt(BASE).specEdges).toEqual(resolveEdges(TREE, BASE).edges);
    expect(arrows(planningGraph(planningAt()))).toEqual([]);
  });
});
