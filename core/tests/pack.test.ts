// The context pack of one task (spec 010, T1–T3, ISC-333): fixed keys in a fixed order, the goal, the task row, the
// claim and its Test Strategy row verbatim, and the lane profile from the constitution's `## Lanes` table.
//
// An inline fixture: one spec with two tasks and a constitution with a lane table. The plugin's golden over a fixture
// repository (plugin/tests/pack.test.ts) pins the CLI output; this file pins the core model it prints.
import { describe, expect, test } from 'bun:test';

import { buildPack, decisionRows, mentions, PACK_LIMIT, PackError, type PackInput } from '../src/pack.ts';
import { laneProfileOf } from '../src/tasks.ts';

const SPEC = `---
stage: implement
---
# 900 · Pack fixture

## Goal

Every builder gets a small pack of its task
instead of the whole \`spec.md\`.

## Claims

- [ ] ISC-1: The pack holds the goal verbatim, \`a | b\` kept.
- [ ] ISC-2: The pack names the lane profile. (after: ISC-1)
- [ ] ISC-3: Anti: the pack reads an Anti claim as its opposite. (after: ISC-2)
- [ ] ISC-4: Antecedent: the lane table is written.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | pack: one task | equal to the golden | \`bun test core/ -t "pack"\` | derived: task-context | high |
| ISC-2 | bun-test | lane row | equal | \`bun test core/\` | derived: lanes | medium |
`;

const TASKS = `# Tasks

- [ ] T1 · ISC-1 · [seam] · core — Pack type with fixed keys · \`core/src/pack.ts\`
- [ ] T2 · ISC-2 · [P] · server — Lane profile next to lanesOf (after: T1) · \`core/src/tasks.ts\`, \`core/src/index.ts\`
- [ ] T3 · ISC-3 · core — Kind prefix kept in the claim text · \`core/src/pack.ts\`
- [ ] T4 · ISC-4 · core — Lane table first · \`specs/constitution.md\`
`;

const CONSTITUTION = `# Constitution

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| core | \`core/\`, \`FORMAT.md\` | \`FORMAT.md\`, \`core/CLAUDE.md\` | \`bun test core/\` |
| server | \`server/\` | \`server/CLAUDE.md\` | \`bun test tests/\` |
| repo | root files | root \`CLAUDE.md\` | |

## Next
`;

const input = (task: string, over: Partial<PackInput> = {}): PackInput => ({
  slug: '900-pack-fixture',
  spec: SPEC,
  tasks: TASKS,
  plan: null,
  constitution: CONSTITUTION,
  task,
  ...over,
});

describe('laneProfileOf', () => {
  test('the context files and the lane probe of one lane row, backticks stripped', () => {
    expect(laneProfileOf(CONSTITUTION, 'core')).toEqual({ name: 'core', context: ['FORMAT.md', 'core/CLAUDE.md'], probe: 'bun test core/' });
    expect(laneProfileOf(CONSTITUTION, 'server')).toEqual({ name: 'server', context: ['server/CLAUDE.md'], probe: 'bun test tests/' });
  });

  test('an empty probe cell is null; an unknown lane or a missing table is null', () => {
    expect(laneProfileOf(CONSTITUTION, 'repo')).toEqual({ name: 'repo', context: ['root CLAUDE.md'], probe: null });
    expect(laneProfileOf(CONSTITUTION, 'web')).toBeNull();
    expect(laneProfileOf('# Constitution\n\nNo table.\n', 'core')).toBeNull();
  });
});

describe('buildPack', () => {
  test('fixed keys in a fixed order, the goal, task, claim and Test Strategy row verbatim', () => {
    const pack = buildPack(input('T1'));
    expect(Object.keys(pack)).toEqual(['spec', 'goal', 'task', 'claim', 'probe', 'lane', 'decisions', 'truncated']);
    expect(Object.keys(pack.task)).toEqual(['id', 'lane', 'text', 'paths']);
    expect(Object.keys(pack.claim)).toEqual(['id', 'text', 'after']);
    expect(Object.keys(pack.probe ?? {})).toEqual(['type', 'check', 'threshold', 'tool']);
    expect(Object.keys(pack.lane ?? {})).toEqual(['name', 'context', 'probe']);
    expect(pack).toEqual({
      spec: '900-pack-fixture',
      goal: 'Every builder gets a small pack of its task\ninstead of the whole `spec.md`.',
      task: { id: 'T1', lane: 'core', text: 'Pack type with fixed keys', paths: ['core/src/pack.ts'] },
      claim: { id: 'ISC-1', text: 'The pack holds the goal verbatim, `a | b` kept.', after: [] },
      probe: { type: 'bun-test', check: 'pack: one task', threshold: 'equal to the golden', tool: '`bun test core/ -t "pack"`' },
      lane: { name: 'core', context: ['FORMAT.md', 'core/CLAUDE.md'], probe: 'bun test core/' },
      decisions: [],
      truncated: 0,
    });
  });

  test('the second task: its claim edge, its paths, its own lane profile', () => {
    const pack = buildPack(input('T2'));
    expect(pack.task).toEqual({ id: 'T2', lane: 'server', text: 'Lane profile next to lanesOf', paths: ['core/src/tasks.ts', 'core/src/index.ts'] });
    expect(pack.claim).toEqual({ id: 'ISC-2', text: 'The pack names the lane profile.', after: ['ISC-1'] });
    expect(pack.lane).toEqual({ name: 'server', context: ['server/CLAUDE.md'], probe: 'bun test tests/' });
  });

  test('an Anti: or Antecedent: claim keeps its kind prefix, so a builder never reads it as its opposite', () => {
    expect(buildPack(input('T3')).claim).toEqual({ id: 'ISC-3', text: 'Anti: the pack reads an Anti claim as its opposite.', after: ['ISC-2'] });
    expect(buildPack(input('T4')).claim).toEqual({ id: 'ISC-4', text: 'Antecedent: the lane table is written.', after: [] });
  });

  test('without a constitution the lane profile is null; without a Test Strategy row the probe is null', () => {
    const spec = SPEC.replace(/^\| ISC-2 .*\n/m, '');
    const pack = buildPack(input('T2', { constitution: null, spec }));
    expect(pack.lane).toBeNull();
    expect(pack.probe).toBeNull();
    expect(pack.task.lane).toBe('server');
  });

  test('an unknown task and a task whose claim is not in spec.md throw a PackError with its code', () => {
    expect(() => buildPack(input('T9'))).toThrow(PackError);
    try {
      buildPack(input('T9'));
    } catch (e) {
      expect((e as PackError).code).toBe('unknown-task');
    }
    try {
      buildPack(input('T1', { spec: SPEC.replace('ISC-1:', 'ISC-7:') }));
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PackError);
      expect((e as PackError).code).toBe('no-claim');
    }
  });

  test('the pack of the fixture is far under the limit', () => {
    expect(PACK_LIMIT).toBe(8192);
    expect(new TextEncoder().encode(JSON.stringify(buildPack(input('T1')))).length).toBeLessThan(PACK_LIMIT);
  });
});

// T15, ISC-337: the Decisions rows with their continuation lines, and the ID as a whole token.
describe('pack decisions', () => {
  const DECISIONS = `# 900

## Decisions

Some prose before the first bullet is no row.

- 2026-03-01: ISC-12 keeps the title.
- 2026-03-02: ISC-12.1 splits it
  over two lines, as written.
  - a nested bullet continues the row
- 2026-03-03: ISC-120 is another claim.

  An indented paragraph still belongs to ISC-120's row.

Unindented prose after a blank line closes the row.
* 2026-03-04: T3 reads no file.
+ 2026-03-05: T30 and T3x are other tasks; XISC-12 and ISC-1 are no hit for ISC-12.

## Verification

- ISC-12 under another heading is no row.
`;

  test('decisionRows: the bullets under ## Decisions, continuation lines joined as written, prose left out', () => {
    expect(decisionRows(DECISIONS)).toEqual([
      '2026-03-01: ISC-12 keeps the title.',
      '2026-03-02: ISC-12.1 splits it\n  over two lines, as written.\n  - a nested bullet continues the row',
      "2026-03-03: ISC-120 is another claim.\n  An indented paragraph still belongs to ISC-120's row.",
      '2026-03-04: T3 reads no file.',
      '2026-03-05: T30 and T3x are other tasks; XISC-12 and ISC-1 are no hit for ISC-12.',
    ]);
    expect(decisionRows('# 900\n\n## Goal\n\n- not a decision\n')).toEqual([]);
  });

  test('mentions: ISC-12 hits ISC-12 and ISC-12.1, never ISC-120; T3 hits T3, never T30 or T3x', () => {
    expect(mentions('ISC-12 keeps the title.', 'ISC-12', 'T9')).toBe(true);
    expect(mentions('(ISC-12) at the end: ISC-12.', 'ISC-12', 'T9')).toBe(true);
    expect(mentions('ISC-12.1 splits it', 'ISC-12', 'T9')).toBe(true);
    expect(mentions('ISC-120 is another claim', 'ISC-12', 'T9')).toBe(false);
    expect(mentions('ISC-12 only', 'ISC-1', 'T9')).toBe(false);
    expect(mentions('XISC-12 and SISC-12', 'ISC-12', 'T9')).toBe(false);
    expect(mentions('T3 reads no file.', 'ISC-12', 'T3')).toBe(true);
    expect(mentions('`T3`, then T4', 'ISC-12', 'T3')).toBe(true);
    expect(mentions('T30 and T3x and ST3', 'ISC-12', 'T3')).toBe(false);
    expect(mentions('no reference at all', 'ISC-12', 'T3')).toBe(false);
  });

  test('buildPack: exactly the hits, spec.md first, then plan.md, in file order; no plan, no plan rows', () => {
    const spec = `${SPEC}\n## Decisions\n\n- 2026-03-01: ISC-3 is an Anti claim.\n- 2026-03-02: ISC-30 and T30 are others.\n- 2026-03-03: No reference.\n`;
    const plan = '# Plan\n\n## Decisions\n\n- 2026-03-04: T3 strips nothing\n  from the prefix.\n- 2026-03-05: ISC-3.1 is a sub-claim.\n- 2026-03-06: T1 is another task.\n';
    expect(buildPack(input('T3', { spec, plan })).decisions).toEqual([
      { source: 'spec.md', text: '2026-03-01: ISC-3 is an Anti claim.' },
      { source: 'plan.md', text: '2026-03-04: T3 strips nothing\n  from the prefix.' },
      { source: 'plan.md', text: '2026-03-05: ISC-3.1 is a sub-claim.' },
    ]);
    expect(buildPack(input('T3', { spec })).decisions).toEqual([{ source: 'spec.md', text: '2026-03-01: ISC-3 is an Anti claim.' }]);
  });
});
