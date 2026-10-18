// Spec 020, ISC-237: the core derives each workspace's guidance from the item-state model of ISC-221. "Waits on you"
// holds every `open` item whose next step lies with the principal (a spec in `review`, `code-review` or `close`, an open
// `manual` claim, an open `operator` task, a question of the newest round); "Next" every other `open` spec item. Both
// sort by priority (P1 first, a missing key reads P3), then by since (oldest first, null last), then spec id, item kind
// and ref. The `guidance` fixture tree (core/fixtures/guidance/generate.ts maps each spec to its case) holds every case;
// the expectations below are literal, order included.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { buildSpecPage } from '../src/spec.ts';
import type { GuidanceEntry, SpecFiles } from '../src/files.ts';
import { guidanceOf, withGuidance } from '../src/guidance.ts';
import { itemStates } from '../src/item-state.ts';
import { guidanceModel } from './helpers/guidance-model.ts';
import { FIXTURES, fixtureTrees, folders } from './helpers/read-tree.ts';
import { hasStateModel, stateInputAt } from './helpers/state-model.ts';

const ROOT = join(FIXTURES, 'guidance');

/** The fields every expectation compares; `title` is the entry's own text and is not pinned here. */
const shape = (e: GuidanceEntry) => ({
  spec: e.spec,
  item: e.item,
  ref: e.ref,
  command: e.command,
  priority: e.priority,
  since: e.since,
  key: e.reason.key,
  values: e.reason.values,
});
type Shape = ReturnType<typeof shape>;

const WAITS: Shape[] = [
  // P1: the only principal-stage P1 (009 is P1 in review too, but running).
  { spec: '001', item: 'spec', ref: null, command: '/spec-review 001', priority: 'P1', since: '2026-03-05T10:00:00Z', key: 'stage.review.0', values: { state: 'stale' } },
  // P2 by since: 003 into review 03-03, 005's manual claim and operator task at 005's since (into build 03-04), claim
  // before task; 002 into review 03-06; 005's question at its round's time 03-07.
  { spec: '003', item: 'spec', ref: null, command: '/spec-review 003', priority: 'P2', since: '2026-03-03T09:00:00Z', key: 'stage.review.0', values: { state: 'stale' } },
  { spec: '005', item: 'claim', ref: 'ISC-14', command: '/spec-implement 005', priority: 'P2', since: '2026-03-04T12:00:00Z', key: 'waiting.manual', values: { ref: 'ISC-14' } },
  { spec: '005', item: 'task', ref: 'T3', command: '/spec-implement 005', priority: 'P2', since: '2026-03-04T12:00:00Z', key: 'waiting.operator', values: { ref: 'T3' } },
  { spec: '002', item: 'spec', ref: null, command: '/spec-review 002', priority: 'P2', since: '2026-03-06T09:00:00Z', key: 'stage.review.0', values: { state: 'missing' } },
  { spec: '005', item: 'question', ref: 'T4', command: '/spec-implement 005', priority: 'P2', since: '2026-03-07T10:00:00Z', key: 'waiting.question', values: { ref: 'T4' } },
  // P3 (no key): 004 since its `updated:` (no events.jsonl), 010 with neither, so null and last.
  { spec: '004', item: 'spec', ref: null, command: '/spec-code-review 004', priority: 'P3', since: '2026-03-05T16:00:00Z', key: 'stage.code-review.0', values: { state: 'stale' } },
  { spec: '010', item: 'spec', ref: null, command: '/spec-complete 010', priority: 'P3', since: null, key: 'stage.close.1', values: {} },
];

const NEXT: Shape[] = [
  { spec: '007', item: 'spec', ref: null, command: '/spec-plan 007', priority: 'P1', since: '2026-03-06T09:00:00Z', key: 'stage.plan.0', values: { type: 'feature' } },
  { spec: '005', item: 'spec', ref: null, command: '/spec-implement 005', priority: 'P2', since: '2026-03-04T12:00:00Z', key: 'stage.build.0', values: { ids: 'ISC-13 and ISC-14', is: 'are' } },
  { spec: '008', item: 'spec', ref: null, command: '/spec-tasks 008', priority: 'P3', since: '2026-03-04T14:00:00Z', key: 'stage.tasks.0', values: { claims: '3 claims' } },
];

/** `[spec, item, ref]` per entry, in order. */
const triples = (list: readonly GuidanceEntry[]) => list.map((e) => [e.spec, e.item, e.ref]);

describe('guidance', () => {
  const guidance = guidanceModel(ROOT);

  test('waits on you: every principal step of the guidance tree, in order', () => {
    expect(triples(guidance.waits)).toEqual([
      ['001', 'spec', null],
      ['003', 'spec', null],
      ['005', 'claim', 'ISC-14'],
      ['005', 'task', 'T3'],
      ['002', 'spec', null],
      ['005', 'question', 'T4'],
      ['004', 'spec', null],
      ['010', 'spec', null],
    ]);
    expect(guidance.waits.map(shape)).toEqual(WAITS);
  });

  test('next: every other open spec item, in order', () => {
    expect(triples(guidance.next)).toEqual([
      ['007', 'spec', null],
      ['005', 'spec', null],
      ['008', 'spec', null],
    ]);
    expect(guidance.next.map(shape)).toEqual(NEXT);
  });

  test('neither list holds a waiting, running, done spec or an idea', () => {
    const specs = new Set([...guidance.waits, ...guidance.next].map((e) => e.spec));
    // 006 close-pending (waiting), 009 running, 011 done, 012 blocked (waiting); the story flag-templates has no spec.
    for (const id of ['006', '009', '011', '012']) expect(specs.has(id)).toBe(false);
    expect([...guidance.waits, ...guidance.next].every((e) => /^\d{3}$/.test(e.spec))).toBe(true);
  });

  test('a spec entry carries its item reason unchanged; a waiting entry its fixed English phrase', () => {
    const items = itemStates(stateInputAt(ROOT));
    for (const e of [...guidance.waits, ...guidance.next].filter((x) => x.item === 'spec')) {
      const item = items.find((i) => i.kind === 'spec' && i.id === e.spec);
      expect(e.reason.phrase).toBe(item?.reason as string);
    }
    const phrases = guidance.waits.filter((e) => e.item !== 'spec').map((e) => [e.reason.key, e.reason.phrase]);
    expect(phrases).toEqual([
      ['waiting.manual', 'ISC-14 needs your confirmation'],
      ['waiting.operator', 'T3 is your step'],
      ['waiting.question', 'the newest round asks about T4'],
    ]);
  });

  test('no entry of any fixture tree falls back to the key `phrase`', () => {
    const trees = fixtureTrees().map((tree) => join(FIXTURES, tree)).filter(hasStateModel);
    expect(trees).toContain(ROOT);
    for (const root of trees) {
      const { waits, next } = guidanceModel(root);
      const keys = [...waits, ...next].map((e) => e.reason.key);
      expect({ root, fallback: keys.filter((k) => k === 'phrase') }).toEqual({ root, fallback: [] });
      for (const key of keys) expect(key).toMatch(/^(stage\.[a-z-]+\.\d+|waiting\.(manual|operator|question))$/);
    }
  });

  test('withGuidance sets the guidance on a model and keeps every other field', () => {
    const input = stateInputAt(ROOT);
    const g = guidanceOf({ workspace: input.workspace, dashboard: input.dashboard, items: itemStates(input) });
    expect(g).toEqual(guidance);
    expect(withGuidance(input.dashboard, g)).toEqual({ ...input.dashboard, guidance: g });
  });

  test('the spec page keeps only its own spec\'s entries', () => {
    const all = folders(join(ROOT, 'specs'));
    const own = all.find((f) => f.folder === '005-sdk-rollout') as SpecFiles;
    const input = stateInputAt(ROOT);
    const page = buildSpecPage({
      files: { folder: own.folder, texts: { ...own.texts, ...(input.workspace.master === null ? {} : { master: input.workspace.master }) } },
      others: all.filter((f) => f !== own),
      ...(input.workspace.workflow ? { workflow: input.workspace.workflow } : {}),
      guidance,
    });
    expect(triples(page.guidance?.waits ?? [])).toEqual([
      ['005', 'claim', 'ISC-14'],
      ['005', 'task', 'T3'],
      ['005', 'question', 'T4'],
    ]);
    expect(triples(page.guidance?.next ?? [])).toEqual([['005', 'spec', null]]);
    expect(page.guidance).toEqual({ waits: guidance.waits.filter((e) => e.spec === '005'), next: guidance.next.filter((e) => e.spec === '005') });
  });
});
