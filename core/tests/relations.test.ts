// The relation index of the planning tree (spec 026, T10, ISC-171): every milestone, feature, spec, claim and story by
// `<type>:<id>`, with its parents, children and blockers. `buildPlanning` always sets `PlanningModel.relations`, and the
// index rides inside each fixture's planning golden (`<tree>.planning.golden.json`, the body the planning route and the
// web stub serve), so the golden family stays one file per tree. Probes by name: "golden" (the index equals the
// golden's), "shape" (keys, no dangling ref, parents and children inverse), "progress" (the tree's counts), "cascade"
// and "blockers" on the fixtures and on inline inputs.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import * as core from '../src/index.ts';
import type { PlanningModel } from '../src/planning.ts';
import type { Relation, RelationIndex, RelationRef } from '../src/relations.ts';
import { specIdOf } from '../src/spec-ref.ts';
import { goldenPath } from './helpers/golden.ts';
import { planningOf } from './helpers/planning-model.ts';
import { fixtureTrees, readTree } from './helpers/read-tree.ts';

const indexOf = (model: PlanningModel): RelationIndex => {
  expect(model.relations).toBeDefined();
  return model.relations ?? {};
};
const entry = (index: RelationIndex, ref: string): Relation | undefined => index[ref as RelationRef];
const entries = (index: RelationIndex): Relation[] => Object.values(index);
const refsOf = (index: RelationIndex, type: Relation['type']): string[] => entries(index).filter((r) => r.type === type).map((r) => r.ref);

describe('relations', () => {
  // The index of every fixture equals the one its planning golden carries, entry by entry (a readable failure names
  // the ref); the byte-for-byte check of the whole golden stays in golden.test.ts and planning.test.ts.
  test.each(fixtureTrees())('golden: %s equals the relations of its planning golden', (tree) => {
    const path = goldenPath(tree, 'planning');
    expect(existsSync(path)).toBe(true);
    const golden = (JSON.parse(readFileSync(path, 'utf8')) as PlanningModel).relations;
    expect(golden).toBeDefined();
    const built = indexOf(planningOf(tree));
    expect(Object.keys(built)).toEqual(Object.keys(golden ?? {}));
    for (const [ref, relation] of Object.entries(built)) expect({ ref, relation: golden?.[ref as RelationRef] }).toEqual({ ref, relation });
  });

  test.each(fixtureTrees())('shape: %s keys every entry by its ref, no list holds a dangling or doubled ref, parents and children are inverse', (tree) => {
    const index = indexOf(planningOf(tree));
    for (const [key, r] of Object.entries(index)) {
      expect({ key, ref: r.ref, composed: `${r.type}:${r.id}` }).toEqual({ key, ref: key as RelationRef, composed: key });
      for (const list of [r.parents, r.children, r.blockers]) {
        expect({ key, dangling: list.filter((ref) => !(ref in index)) }).toEqual({ key, dangling: [] });
        expect({ key, doubled: list.length - new Set(list).size }).toEqual({ key, doubled: 0 });
        expect({ key, self: list.includes(r.ref) }).toEqual({ key, self: false });
      }
      for (const parent of r.parents) expect({ key, parent, lists: entry(index, parent)?.children.includes(r.ref) }).toEqual({ key, parent, lists: true });
      for (const child of r.children) expect({ key, child, lists: entry(index, child)?.parents.includes(r.ref) }).toEqual({ key, child, lists: true });
      // `stage` only on an active spec, `archived` only where true.
      expect({ key, stage: 'stage' in r }).toEqual({ key, stage: r.type === 'spec' && r.archived !== true });
      if ('archived' in r) expect({ key, archived: r.archived }).toEqual({ key, archived: true });
    }
  });

  test.each(fixtureTrees())('progress: %s counts as the tree counts, every object of the tree has an entry', (tree) => {
    const model = planningOf(tree);
    const index = indexOf(model);
    for (const m of model.milestones) {
      expect(entry(index, `milestone:${m.slug}`)).toMatchObject({ type: 'milestone', id: m.slug, title: m.name, closed: m.closed, total: m.total, parents: [], blockers: [] });
    }
    for (const f of model.features) {
      expect(entry(index, `feature:${f.id}`)).toMatchObject({ type: 'feature', id: f.id, title: f.name, closed: f.closed, total: f.total, blockers: [] });
      for (const c of f.claims) {
        const [closed, total] = c.dropped ? [0, 0] : c.closed ? [1, 1] : [0, 1];
        expect(entry(index, `claim:${c.id}`)).toMatchObject({ type: 'claim', id: c.id, title: c.text, closed, total, children: [] });
      }
      for (const h of f.holders) expect(entry(index, `spec:${h.id}`)).toMatchObject({ type: 'spec', id: h.id, title: h.title });
    }
    for (const idea of model.ideas) expect(entry(index, `idea:${idea.slug}`)).toMatchObject({ type: 'idea', id: idea.slug, title: idea.title, closed: 0, total: 0, children: [], blockers: [] });
    // A spec counts the live claims it holds, closed over total.
    for (const s of entries(index).filter((r) => r.type === 'spec')) {
      const held = s.children.map((ref) => entry(index, ref)).filter((c): c is Relation => c !== undefined && c.total > 0);
      expect({ spec: s.ref, closed: s.closed, total: s.total }).toEqual({ spec: s.ref, closed: held.filter((c) => c.closed === 1).length, total: held.length });
      expect(s.blockers).toEqual([]);
    }
    // Every spec folder of the tree has an entry, with or without held claims.
    const input = readTree(tree);
    const folders = [...input.specs, ...input.archived].filter((f) => f.texts.spec !== undefined).map((f) => `spec:${specIdOf(f.folder) ?? f.folder}`);
    expect(folders.filter((ref) => !(ref in index))).toEqual([]);
    // Nothing else: the index holds exactly the tree's objects.
    expect(refsOf(index, 'milestone')).toEqual(model.milestones.map((m) => `milestone:${m.slug}`));
    expect(refsOf(index, 'feature')).toEqual(model.features.map((f) => `feature:${f.id}`));
    expect(refsOf(index, 'idea')).toEqual(model.ideas.map((i) => `idea:${i.slug}`));
    expect(refsOf(index, 'spec').toSorted()).toEqual([...new Set(folders)].toSorted());
  });

  test('cascade: milestone-lines hangs features under their line, specs under their features (main first), claims under their spec', () => {
    const index = indexOf(planningOf('milestone-lines'));
    expect(entry(index, 'milestone:beacon-0-5')?.children).toEqual(['feature:F1']);
    expect(entry(index, 'milestone:beacon-1-0')?.children).toEqual(['feature:F2']);
    expect(entry(index, 'feature:F1')?.parents).toEqual(['milestone:beacon-0-5']);
    expect(entry(index, 'feature:F2')?.parents).toEqual(['milestone:beacon-1-0']);
    // F0 has no line and F3 names an unknown milestone: no parent.
    expect(entry(index, 'feature:F0')?.parents).toEqual([]);
    expect(entry(index, 'feature:F3')?.parents).toEqual([]);
    // 002 holds claims of F2 (its main feature) and F0: main first.
    expect(entry(index, 'spec:002')?.parents).toEqual(['feature:F2', 'feature:F0']);
    expect(entry(index, 'feature:F1')?.children).toEqual(['spec:001', 'claim:ISC-3', 'claim:ISC-4', 'claim:ISC-5']);
    expect(entry(index, 'spec:001')).toMatchObject({ children: ['claim:ISC-3', 'claim:ISC-4', 'claim:ISC-5'], closed: 3, total: 3 });
    expect(typeof entry(index, 'spec:001')?.stage).toBe('string');
    expect(entry(index, 'claim:ISC-3')?.parents).toEqual(['spec:001', 'feature:F1']);
  });

  test('blockers: a claim lists its open (after: …) claims only', () => {
    const index = indexOf(planningOf('milestone-lines'));
    expect(entry(index, 'claim:ISC-7')?.blockers).toEqual(['claim:ISC-6']);
    expect(entry(index, 'claim:ISC-10')?.blockers).toEqual(['claim:ISC-9']);
    // ISC-5 waits on ISC-3, which is closed.
    expect(entry(index, 'claim:ISC-5')?.blockers).toEqual([]);
  });

  test('cascade: harbor marks the archived spec and its claims, carries active stages and hangs the stories under feature and milestone', () => {
    const index = indexOf(planningOf('harbor'));
    const archived = entry(index, 'spec:001');
    expect(archived).toMatchObject({ archived: true, parents: ['feature:F1'] });
    expect(archived && 'stage' in archived).toBe(false);
    expect(archived?.children.every((ref) => entry(index, ref)?.archived === true)).toBe(true);
    expect(entry(index, 'spec:002')).toMatchObject({ stage: 'build' });
    expect(entry(index, 'spec:002') && 'archived' in (entry(index, 'spec:002') as Relation)).toBe(false);
    // registry-webhooks names F7 and Harbor 1.0; console-audit-log names F2 and the unknown Harbor 2.0.
    expect(entry(index, 'idea:registry-webhooks')?.parents).toEqual(['feature:F7', 'milestone:harbor-1-0']);
    expect(entry(index, 'idea:console-audit-log')?.parents).toEqual(['feature:F2']);
    expect(entry(index, 'feature:F7')?.children).toEqual(['idea:registry-webhooks']);
    expect(entry(index, 'milestone:harbor-1-0')?.children.at(-1)).toBe('idea:registry-webhooks');
    // Without lines a milestone's features are the blocks its specs touch.
    expect(entry(index, 'milestone:harbor-1-0')?.children.filter((ref) => ref.startsWith('feature:'))).toEqual(['feature:F1', 'feature:F2', 'feature:F4']);
  });

  test('empty: no master, no stories, no folder is the empty index', () => {
    expect(core.buildPlanning({ master: null, specs: [], archived: [] }).relations).toEqual({});
    expect(indexOf(planningOf('empty-master'))['feature:F0' as RelationRef]).toBeDefined();
  });
});

// Inline inputs (no fixture tree): dropped claims, unknown and closed edges, an unheld claim, a folder without claims.
describe('relations: inline', () => {
  const master = [
    '# Master',
    '',
    '## Features',
    '',
    '### F0 · A',
    'Why: A matters.',
    '',
    '- [x] ISC-1: One.',
    '- [ ] ISC-2: Two.',
    '- [ ] ISC-3: Three. (after: ISC-1, ISC-2, ISC-4, ISC-99)',
    '- [ ] ISC-4: [DROPPED gone] Four.',
    '- [ ] ISC-5: Five, unheld.',
    '',
  ].join('\n');
  const spec = (feature: string, ids: readonly number[]): string =>
    ['---', 'task: "A spec"', `isa_feature: ${feature}`, '---', '', '# Spec', '', '## Criteria', '', ...ids.map((n) => `- [ ] ISC-${n}: Claim ${n}.`), ''].join('\n');
  const model = core.buildPlanning({
    master,
    specs: [
      { folder: '001-a', texts: { spec: spec('F0', [1, 2, 3, 4]) } },
      { folder: '002-empty', texts: { spec: spec('F0', []) } },
    ],
    archived: [],
  });
  const index = model.relations ?? {};

  test('blockers: open entries only, a dropped, closed or unknown claim never blocks', () => {
    expect(entry(index, 'claim:ISC-3')?.blockers).toEqual(['claim:ISC-2']);
  });

  test('progress: a dropped claim counts in neither number, on the claim, the spec and the feature', () => {
    expect(entry(index, 'claim:ISC-4')).toMatchObject({ closed: 0, total: 0, parents: ['spec:001', 'feature:F0'] });
    expect(entry(index, 'spec:001')).toMatchObject({ closed: 1, total: 3, children: ['claim:ISC-1', 'claim:ISC-2', 'claim:ISC-3', 'claim:ISC-4'], stage: null });
    expect(entry(index, 'feature:F0')).toMatchObject({ closed: 1, total: 4 });
  });

  test('cascade: an unheld claim hangs under its feature alone, a folder without claims stands on its own', () => {
    expect(entry(index, 'claim:ISC-5')?.parents).toEqual(['feature:F0']);
    expect(entry(index, 'spec:002')).toMatchObject({ parents: [], children: [], closed: 0, total: 0 });
    expect(entry(index, 'feature:F0')?.children).toEqual(['spec:001', 'claim:ISC-1', 'claim:ISC-2', 'claim:ISC-3', 'claim:ISC-4', 'claim:ISC-5']);
  });

  test('the builder is exported and pure: the same tree builds the same index', () => {
    expect(typeof core.buildRelations).toBe('function');
    const tree = { features: model.features, milestones: model.milestones, ideas: model.ideas };
    const rebuilt = core.buildRelations(tree);
    expect(core.buildRelations(tree)).toEqual(rebuilt);
    expect(entry(rebuilt, 'feature:F0')?.ref).toBe('feature:F0');
    // Without the folder list and the edges, the index holds the specs the tree names and no blocker.
    expect(entry(rebuilt, 'spec:002')).toBeUndefined();
    expect(entry(rebuilt, 'claim:ISC-3')?.blockers).toEqual([]);
  });
});
