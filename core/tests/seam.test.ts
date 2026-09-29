// Seam test for spec 001 T33: the module skeleton the fill-ins T34, T36–T39 replace, and the `core/src/index.ts`
// barrel. Evidence for the seam only; ISC-6 closes on the golden test (T40).
import { describe, expect, test } from 'bun:test';

import * as core from '../src/index.ts';

describe('module stubs', () => {
  // Each fill-in replaces its stub without touching this file: the test pins the exported name, and while the stub
  // stands, its message. An implemented function called without arguments may throw anything else, or nothing.
  const stubs: Array<[string, () => Promise<unknown>]> = [
    ['partitionClaims', async () => (await import('../src/status.ts')).partitionClaims],
    ['driftReport', async () => (await import('../src/status.ts')).driftReport],
    ['hasDrift', async () => (await import('../src/status.ts')).hasDrift],
    ['readGateMark', async () => (await import('../src/gates.ts')).readGateMark],
    ['gateState', async () => (await import('../src/gates.ts')).gateState],
    ['normalizeForGate', async () => (await import('../src/gates.ts')).normalizeForGate],
    ['hashForGate', async () => (await import('../src/gates.ts')).hashForGate],
    ['stageOf', async () => (await import('../src/stage.ts')).stageOf],
    ['nextCommand', async () => (await import('../src/stage.ts')).nextCommand],
    ['takeableSet', async () => (await import('../src/takeable.ts')).takeableSet],
    ['diagramVerdict', async () => (await import('../src/diagrams.ts')).diagramVerdict],
    ['parseTldr', async () => (await import('../src/tldr.ts')).parseTldr],
    ['tldrState', async () => (await import('../src/tldr.ts')).tldrState],
    ['renderMarkdown', async () => (await import('../src/markdown.ts')).renderMarkdown],
    ['listArchive', async () => (await import('../src/archive.ts')).listArchive],
    ['buildDashboard', async () => (await import('../src/dashboard.ts')).buildDashboard],
  ];

  test.each(stubs)('%s is exported, and a stub names itself', async (name, load) => {
    const fn = (await load()) as (...args: never[]) => unknown;
    expect(typeof fn).toBe('function');
    let message = '';
    try {
      fn();
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    if (message.startsWith('not implemented')) expect(message).toBe(`not implemented: ${name}`);
  });
});

describe('index barrel', () => {
  test('exports the parsers, the file contract and the pure model functions', () => {
    for (const name of ['parseFrontmatter', 'parseProgress', 'parseClaims', 'countProgress', 'formatProgress', 'validateEdges', 'FILE_KINDS', 'specFilePath', 'stageOf', 'nextCommand', 'renderMarkdown', 'TLDR_SECTIONS']) {
      expect(name in core).toBe(true);
    }
  });

  test('keeps gates and dashboard functions out, so the browser bundle never pulls them in', () => {
    for (const name of ['hashForGate', 'gateState', 'buildDashboard', 'buildSpecPage']) {
      expect(name in core).toBe(false);
    }
  });

  test('parses a spec through the barrel', () => {
    const text = '---\nslug: 001-x\nprogress: 1/2\n---\n\n## Claims\n\n- [x] ISC-1: a\n- [ ] ISC-2: b (after: ISC-1)\n';
    expect(core.parseFrontmatter(text).data.progress).toEqual(core.parseClaims(text).counted);
  });
});
