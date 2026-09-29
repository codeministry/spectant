// Seam test for T1 (spec 002): the file kinds a spec folder holds, their paths, and the model stubs the fill-in
// tasks T12–T25 replace. Evidence for the seam only; ISC-68 closes on core/tests/golden.test.ts (T9).
import { describe, expect, test } from 'bun:test';

import { FILE_KINDS, specFilePath, type FileKind } from '../src/files.ts';

const EXPECTED: Record<FileKind, string> = {
  spec: 'spec.md',
  plan: 'plan.md',
  tasks: 'tasks.md',
  context: 'context.md',
  design: 'design.md',
  constitution: '../constitution.md',
  rounds: 'rounds.jsonl',
  events: 'events.jsonl',
  gateReviewed: '.gates/reviewed.json',
  gateCodeReviewed: '.gates/code-reviewed.json',
  artifacts: 'artifacts/',
  evidence: '.evidence/',
  master: '../../ISA.md',
};

describe('FILE_KINDS', () => {
  test('holds exactly the 13 kinds with their paths inside a spec folder', () => {
    const actual = Object.fromEntries(Object.entries(FILE_KINDS).map(([kind, info]) => [kind, info.path]));
    expect(Object.keys(FILE_KINDS)).toHaveLength(13);
    expect(actual).toEqual(EXPECTED);
  });

  test('every kind carries a description, and only spec.md is required', () => {
    for (const [kind, info] of Object.entries(FILE_KINDS)) {
      expect(info.description.length).toBeGreaterThan(0);
      expect(info.required).toBe(kind === 'spec');
    }
  });

  test('directory kinds are exactly the ones whose path ends in a slash', () => {
    for (const info of Object.values(FILE_KINDS)) {
      expect(info.directory).toBe(info.path.endsWith('/'));
    }
  });
});

describe('specFilePath', () => {
  test('joins a file kind onto the spec folder', () => {
    expect(specFilePath('repo/specs/002-web-console', 'spec')).toBe('repo/specs/002-web-console/spec.md');
    expect(specFilePath('repo/specs/002-web-console/', 'gateReviewed')).toBe(
      'repo/specs/002-web-console/.gates/reviewed.json',
    );
  });

  test('resolves the parent-relative kinds', () => {
    expect(specFilePath('/srv/repo/specs/002-web-console', 'constitution')).toBe('/srv/repo/specs/constitution.md');
    expect(specFilePath('/srv/repo/specs/002-web-console', 'master')).toBe('/srv/repo/ISA.md');
    expect(specFilePath('specs/002-web-console', 'master')).toBe('ISA.md');
  });

  test('returns a directory kind without its trailing slash', () => {
    expect(specFilePath('/srv/repo/specs/002-web-console', 'artifacts')).toBe('/srv/repo/specs/002-web-console/artifacts');
    expect(specFilePath('specs/002-web-console', 'evidence')).toBe('specs/002-web-console/.evidence');
  });
});

describe('model stubs', () => {
  // Each fill-in task replaces its stub without touching this file: the test pins the exported name, and while the
  // stub stands, its message. An implemented function called without arguments may throw anything else, or nothing.
  const stubs: Array<[string, () => Promise<unknown>]> = [
    ['buildSpecPage', async () => (await import('../src/spec.ts')).buildSpecPage],
    ['buildTimeline', async () => (await import('../src/timeline.ts')).buildTimeline],
    ['deriveStages', async () => (await import('../src/derived-stages.ts')).deriveStages],
    ['validateEventLine', async () => (await import('../src/events.ts')).validateEventLine],
    ['buildFrames', async () => (await import('../src/frames.ts')).buildFrames],
    ['detectRecut', async () => (await import('../src/recut.ts')).detectRecut],
    ['buildMatrix', async () => (await import('../src/matrix.ts')).buildMatrix],
    ['readLockSources', async () => (await import('../src/locks.ts')).readLockSources],
    ['buildLiveFrame', async () => (await import('../src/live.ts')).buildLiveFrame],
    ['buildClaimViews', async () => (await import('../src/claim-view.ts')).buildClaimViews],
    ['parseTaskLines', async () => (await import('../src/tasks.ts')).parseTaskLines],
    ['listEvidence', async () => (await import('../src/evidence.ts')).listEvidence],
    ['renderDocsMarkdown', async () => (await import('../src/markdown-docs.ts')).renderDocsMarkdown],
  ];

  test.each(stubs)('%s is exported, and a stub names itself', async (name, load) => {
    const fn = (await load()) as (...args: never[]) => unknown;
    expect(typeof fn).toBe('function');
    let message = '';
    try {
      const result = fn();
      if (result instanceof Promise) await result.catch(() => undefined);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    if (message.startsWith('not implemented')) expect(message).toBe(`not implemented: ${name}`);
  });
});
