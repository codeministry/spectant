// Spec edges (spec 025): a three-digit number in the `(after: …)` of a task in tasks.md or of a claim in spec.md is
// an edge on the whole spec with that number, active or archived, and may share its group with task or claim edges.
//
// The tree is `core/fixtures/edges/` (see its README): 003 mixes spec edges with claim and task edges and waits on
// the active 002 and the archived 001, 004 waits on 002 through a claim, 005 and 006 form a cycle, 007 names the
// unknown 042. `-t parse` (ISC-162) pins what the parsers read; resolving, holding, the stage, the diagnostics and the
// overlap come with their own blocks.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildClaimViews } from '../src/claim-view.ts';
import type { ClaimView, SpecFiles, TaskRow } from '../src/files.ts';
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
