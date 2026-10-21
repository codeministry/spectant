import harbor from '../../../../../core/fixtures/harbor.golden.json';
import type { SpecOverlap, SpecWarning } from '../../../../../core/src/files';
import { edgeDiagnostic, edgeFor, overlapLines, overlapOf, overlapsIn, pathSuffixes } from './overlap';

// Spec 025 T28/T29 (ISC-164.1): the overlap pieces the Warnings list, the spec head and the spec context share.

const PAIR: SpecOverlap = { specs: ['002', '004'], paths: ['web/src/app/retention/'], waiting: '002', edge: '(after: 004)' };

describe('overlap helpers (T28, T29, ISC-164.1)', () => {
  it('cuts each path to its shortest unique suffix in whole segments, a directory keeping its slash', () => {
    expect(pathSuffixes(['web/src/app/retention/'])).toEqual(['retention/']);
    expect(pathSuffixes(['web/src/app/layout/shell/areas.ts', 'web/src/app/layout/shell/index.ts', 'web/src/app/board/index.ts'])).toEqual([
      'areas.ts',
      'shell/index.ts',
      'board/index.ts',
    ]);
    expect(pathSuffixes(['a/x/index.ts', 'b/x/index.ts'])).toEqual(['a/x/index.ts', 'b/x/index.ts']);
    expect(pathSuffixes(['same.ts', 'same.ts'])).toEqual(['same.ts', 'same.ts']);
    expect(pathSuffixes([])).toEqual([]);
  });

  it('reads every pair once from the dashboard rows and skips anything not shaped like core', () => {
    expect(overlapsIn(harbor)).toEqual([PAIR]);
    const body = { specs: [{ warnings: [{ kind: 'spec-overlap', overlap: PAIR }] }, { warnings: [{ kind: 'spec-overlap', overlap: PAIR }, { kind: 'spec-overlap', overlap: { specs: ['1'] } }] }] };
    expect(overlapsIn(body)).toEqual([PAIR]);
    expect(overlapsIn(null)).toEqual([]);
    expect(overlapsIn({ specs: 'no' })).toEqual([]);
  });

  it('gives each spec of a pair its own edge: core\'s on the waiting spec, the reverse on the other', () => {
    expect(edgeFor(PAIR, '002')).toBe('(after: 004)');
    expect(edgeFor(PAIR, '004')).toBe('(after: 002)');
    expect(overlapLines([PAIR], '002')).toEqual([{ other: '004', paths: PAIR.paths, edge: '(after: 004)', waiting: true }]);
    expect(overlapLines([PAIR], '004')).toEqual([{ other: '002', paths: PAIR.paths, edge: '(after: 002)', waiting: false }]);
    expect(overlapLines([PAIR], '009')).toEqual([]);
  });

  it('reads the pair off a spec-overlap warning only, and the two spec-edge diagnostics off core\'s message', () => {
    const overlap: SpecWarning = { kind: 'spec-overlap', text: 'shares 1 file with 004, no edge', overlap: PAIR };
    expect(overlapOf(overlap)).toBe(PAIR);
    expect(overlapOf({ kind: 'review', text: 'x' })).toBeNull();
    const unknown: SpecWarning = { kind: 'spec-edge', text: 'The spec edge (after: 042) on T1 names no spec, active or archived; it stays open.', ref: 'tasks.md' };
    expect(edgeDiagnostic(unknown)).toEqual({ kind: 'unknown', id: '042', from: 'T1' });
    const cycle: SpecWarning = { kind: 'spec-edge', text: 'Spec edges form the cycle 017 → 024 → 017; every edge in it stays open.' };
    expect(edgeDiagnostic(cycle)).toEqual({ kind: 'cycle', path: '017 → 024 → 017' });
    expect(edgeDiagnostic({ kind: 'spec-edge', text: 'something else' })).toBeNull();
    expect(edgeDiagnostic(overlap)).toBeNull();
  });
});
