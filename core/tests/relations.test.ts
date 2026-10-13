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

// The matrix lens (spec 026, T18 and T20, ISC-169 and ISC-169.1): `planningMatrix` over the planning model, one lane
// per milestone plus the no-milestone lane, one column per feature holding a card. Probes by name: "matrix golden" (the
// matrix of the planning golden equals the one of the live tree, card by card and number by number), "matrix shape"
// (every spec with a feature exactly once, no empty column, order), "matrix" per fixture and "matrix multi" (a spec
// holding claims of several features: one card per lane, in its main feature's column, the others as chips).
const laneRefs = (matrix: core.MatrixLens): Array<string | null> => matrix.lanes.map((l) => l.ref);
const cellOf = (matrix: core.MatrixLens, lane: string | null, feature: string): string[] => {
  const l = matrix.lanes.find((x) => x.ref === lane);
  const i = matrix.columns.findIndex((c) => c.ref === feature);
  return l === undefined || i < 0 ? [] : (l.cells[i] ?? []).map((card) => card.ref);
};
const cardOf = (matrix: core.MatrixLens, spec: string): core.LensCard | undefined =>
  matrix.lanes.flatMap((l) => l.cells.flat()).find((card) => card.ref === spec);
const goldenModel = (tree: string): PlanningModel => JSON.parse(readFileSync(goldenPath(tree, 'planning'), 'utf8')) as PlanningModel;

describe('relations: matrix', () => {
  test.each(fixtureTrees())('matrix golden: %s derives the same matrix from its planning golden as from the tree', (tree) => {
    expect(core.planningMatrix(goldenModel(tree))).toEqual(core.planningMatrix(planningOf(tree)));
  });

  test.each(fixtureTrees())('matrix shape: %s places every spec with a feature exactly once, every column holds a card, cards active first', (tree) => {
    const model = planningOf(tree);
    const index = indexOf(model);
    const matrix = core.planningMatrix(model);
    const cards = matrix.lanes.flatMap((l) => l.cells.flat());
    const placed = cards.map((c) => c.ref);
    expect(placed.length).toBe(new Set(placed).size);
    const withFeature: string[] = entries(index).filter((r) => r.type === 'spec' && r.parents.some((p) => p.startsWith('feature:'))).map((r) => r.ref);
    expect(placed.toSorted()).toEqual(withFeature.toSorted() as RelationRef[]);
    expect([...matrix.unplaced].toSorted()).toEqual(refsOf(index, 'spec').filter((ref) => !withFeature.includes(ref)).toSorted() as RelationRef[]);
    // Columns in master order, each with a card somewhere; every lane has one cell per column.
    const order = model.features.map((f): RelationRef => `feature:${f.id}`);
    expect(matrix.columns.map((c) => c.ref)).toEqual(order.filter((ref) => matrix.columns.some((c) => c.ref === ref)));
    matrix.columns.forEach((_, i) => expect(matrix.lanes.some((l) => (l.cells[i] ?? []).length > 0)).toBe(true));
    for (const lane of matrix.lanes) {
      expect(lane.cells.length).toBe(matrix.columns.length);
      expect(lane.specCount).toBe(lane.cells.flat().filter((c) => !c.archived).length);
      for (const cell of lane.cells) expect(cell.map((c) => Number(c.archived))).toEqual(cell.map((c) => Number(c.archived)).toSorted());
      // A bare feature has no card in this lane.
      for (const bare of lane.bare) expect(lane.cells[matrix.columns.findIndex((c) => c.ref === bare)] ?? []).toEqual([]);
    }
    // Lanes: milestones in target order, the no-milestone lane last.
    expect(laneRefs(matrix).filter((ref) => ref !== null)).toEqual(model.milestones.map((m) => `milestone:${m.slug}`));
    if (laneRefs(matrix).includes(null)) expect(laneRefs(matrix).at(-1)).toBeNull();
    // A card carries its spec entry's numbers, stage and archive flag; its column is its first feature parent.
    for (const card of cards) {
      const spec = entry(index, card.ref);
      const features = spec?.parents.filter((p) => p.startsWith('feature:')) ?? [];
      expect(card).toMatchObject({ id: spec?.id, title: spec?.title, closed: spec?.closed, total: spec?.total, archived: spec?.archived === true, stage: spec?.stage ?? null, otherFeatures: features.slice(1) });
      expect(matrix.columns.findIndex((c) => c.ref === features[0])).toBeGreaterThanOrEqual(0);
    }
  });

  test("matrix: milestone-lines puts each spec in its main feature line's lane, the line over the spec's own milestone", () => {
    const matrix = core.planningMatrix(planningOf('milestone-lines'));
    expect(laneRefs(matrix)).toEqual(['milestone:beacon-0-5', 'milestone:beacon-1-0', null]);
    expect(matrix.columns.map((c) => c.ref)).toEqual(['feature:F1', 'feature:F2', 'feature:F3']);
    expect(matrix.columns.map((c) => [c.id, c.closed, c.total, c.done])).toEqual([['F1', 3, 3, true], ['F2', 0, 3, false], ['F3', 0, 2, false]]);
    expect(cellOf(matrix, 'milestone:beacon-0-5', 'feature:F1')).toEqual(['spec:001']);
    // 002 names Beacon 0.5, its main feature F2 carries the line Beacon 1.0: the line wins.
    expect(cellOf(matrix, 'milestone:beacon-1-0', 'feature:F2')).toEqual(['spec:002']);
    expect(cellOf(matrix, null, 'feature:F3')).toEqual(['spec:003']);
    expect(matrix.lanes.map((l) => [l.name, l.target, l.closed, l.total, l.specCount, l.bare])).toEqual([
      ['Beacon 0.5', '2026-03-12', 3, 3, 1, []],
      ['Beacon 1.0', '2026-04-30', 0, 3, 1, []],
      [null, null, 0, 4, 1, ['feature:F0']],
    ]);
    expect(cardOf(matrix, 'spec:001')).toMatchObject({ id: '001', stage: 'done', closed: 3, total: 3, archived: false, blockers: [] });
    expect(matrix.unplaced).toEqual([]);
  });

  test("matrix: harbor without lines puts each spec in its own milestone's lane, marks the archived card and folds done columns", () => {
    const matrix = core.planningMatrix(planningOf('harbor'));
    expect(laneRefs(matrix)).toEqual(['milestone:harbor-0-9', 'milestone:harbor-1-0', null]);
    expect(matrix.columns.map((c) => c.id)).toEqual(['F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
    expect(matrix.columns.filter((c) => c.done).map((c) => c.id)).toEqual(['F1', 'F5']);
    expect(cellOf(matrix, 'milestone:harbor-0-9', 'feature:F3')).toEqual(['spec:003']);
    expect(cellOf(matrix, 'milestone:harbor-1-0', 'feature:F1')).toEqual(['spec:001']);
    expect(cellOf(matrix, null, 'feature:F3')).toEqual(['spec:005']);
    expect(cellOf(matrix, null, 'feature:F6')).toEqual(['spec:008', 'spec:009']);
    expect(cardOf(matrix, 'spec:001')).toMatchObject({ archived: true, stage: null, closed: 46, total: 46 });
    expect(cardOf(matrix, 'spec:002')).toMatchObject({ archived: false, stage: 'build', closed: 25, total: 30 });
    // Without lines the no-milestone lane counts the claims its specs hold, as a milestone does (ISC-102).
    expect(matrix.lanes.map((l) => [l.closed, l.total, l.specCount, l.bare])).toEqual([
      [0, 13, 1, []],
      [101, 106, 2, []],
      [5, 10, 5, ['feature:F7']],
    ]);
  });

  test('matrix: a tree without milestones is one no-milestone lane; no master, one empty lane', () => {
    const lantern = core.planningMatrix(planningOf('lantern'));
    expect(laneRefs(lantern)).toEqual([null]);
    expect(cellOf(lantern, null, 'feature:F1')).toEqual(['spec:001', 'spec:002']);
    expect(lantern.lanes[0]?.bare).toEqual(['feature:F0']);
    const empty = core.planningMatrix(planningOf('empty-master'));
    expect(empty.columns).toEqual([]);
    expect(empty.lanes).toEqual([{ ref: null, name: null, target: null, closed: 0, total: 3, specCount: 0, cells: [], bare: ['feature:F0', 'feature:F1'] }]);
    const none = core.planningMatrix(core.buildPlanning({ master: null, specs: [], archived: [] }));
    expect(none).toEqual({ lanes: [{ ref: null, name: null, target: null, closed: 0, total: 0, specCount: 0, cells: [], bare: [] }], columns: [], unplaced: [] });
  });

  test("matrix multi: a spec with claims in several features stands once per lane, in its main feature's column, the others as chips", () => {
    const lines = core.planningMatrix(planningOf('milestone-lines'));
    expect(cardOf(lines, 'spec:002')?.otherFeatures).toEqual(['feature:F0']);
    expect(lines.lanes.map((l) => l.cells.flat().filter((c) => c.ref === 'spec:002').length)).toEqual([0, 1, 0]);
    // F0 is held only as a side feature: no column, a bare feature of its lane.
    expect(lines.columns.some((c) => c.ref === 'feature:F0')).toBe(false);
    const own = core.planningMatrix(planningOf('spectant-001'));
    expect(own.columns.map((c) => c.ref)).toEqual(['feature:F1']);
    expect(cardOf(own, 'spec:001')?.otherFeatures).toEqual(['feature:F0']);
    // isa_feature names F1, the spec holds claims of F0 and F1: column F1 though F0 comes first in the master.
    const master = ['# Master', '', '## Features', '', '### F0 · A', '', '- [ ] ISC-1: One.', '', '### F1 · B', '', '- [ ] ISC-2: Two.', ''].join('\n');
    const spec = ['---', 'task: "Both"', 'isa_feature: F1 F0', '---', '', '# Spec', '', '## Criteria', '', '- [ ] ISC-1: One.', '- [ ] ISC-2: Two.', ''].join('\n');
    const both = core.planningMatrix(core.buildPlanning({ master, specs: [{ folder: '001-both', texts: { spec } }], archived: [] }));
    expect(both.columns.map((c) => c.ref)).toEqual(['feature:F1']);
    expect(cellOf(both, null, 'feature:F1')).toEqual(['spec:001']);
    expect(cardOf(both, 'spec:001')?.otherFeatures).toEqual(['feature:F0']);
  });
});

// The diagram lens (spec 026, T22, ISC-170): `planningGraph` over the planning model, milestone → feature → spec. The
// counted state is the default options: every lane (`Alle`), archived specs drawn, every bundle collapsed. Probes by
// name: "graph golden", "graph shape", "graph" per fixture and "graph options".
const kinds = (graph: core.GraphLens): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const n of graph.nodes) out[n.kind] = (out[n.kind] ?? 0) + 1;
  return out;
};

describe('relations: graph', () => {
  test.each(fixtureTrees())('graph golden: %s derives the same graph from its planning golden as from the tree', (tree) => {
    expect(core.planningGraph(goldenModel(tree))).toEqual(core.planningGraph(planningOf(tree)));
  });

  test.each(fixtureTrees())('graph shape: %s has unique mermaid-safe ids, every edge joins two nodes, every node but a root has one parent', (tree) => {
    const model = planningOf(tree);
    const graph = core.planningGraph(model);
    const ids = graph.nodes.map((n) => n.id);
    expect(ids.length).toBe(new Set(ids).size);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    for (const e of graph.edges) expect([ids.includes(e.from), ids.includes(e.to), e.kind]).toEqual([true, true, 'contains']);
    const targets = graph.edges.map((e) => e.to);
    expect(targets.length).toBe(new Set(targets).size);
    const roots = graph.nodes.filter((n) => !targets.includes(n.id)).map((n) => n.kind);
    // Milestone nodes are the roots; without milestones features and bundles are.
    expect(roots.every((k) => (model.milestones.length > 0 ? k === 'milestone' : k === 'feature' || k === 'bundle'))).toBe(true);
    // Every spec node is a card of the matrix, every bundle holds a feature.
    const cards = core.planningMatrix(model).lanes.flatMap((l) => l.cells.flat()).map((c) => c.ref);
    for (const n of graph.nodes.filter((x) => x.kind === 'spec')) expect(cards).toContain(n.ref as RelationRef);
    for (const n of graph.nodes.filter((x) => x.kind === 'bundle')) expect(n.members?.length).toBeGreaterThan(0);
  });

  test('graph: harbor in the counted state, 19 nodes and 16 edges', () => {
    const graph = core.planningGraph(planningOf('harbor'));
    expect(kinds(graph)).toEqual({ milestone: 3, feature: 6, spec: 7, bundle: 3 });
    expect([graph.nodes.length, graph.edges.length]).toEqual([19, 16]);
    expect(graph.nodes.filter((n) => n.kind === 'bundle').map((n) => [n.id, n.bundle, n.lane, n.members])).toEqual([
      ['b_done_harbor_1_0', 'done', 'milestone:harbor-1-0', ['feature:F1']],
      ['b_done__none', 'done', null, ['feature:F5']],
      ['b_nospec__none', 'no-spec', null, ['feature:F7']],
    ]);
    // F3 stands in two lanes, once per lane; F4 is full but 004 is still open, so it is drawn.
    expect(graph.nodes.filter((n) => n.ref === 'feature:F3').map((n) => n.id)).toEqual(['f_harbor_0_9_F3', 'f__none_F3']);
    expect(graph.nodes.some((n) => n.ref === 'feature:F4')).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'm__none')).toMatchObject({ kind: 'milestone', ref: null, lane: null, title: null });
    expect(graph.edges).toContainEqual({ from: 'f_harbor_1_0_F2', to: 's_002', kind: 'contains' });
    expect(graph.nodes.find((n) => n.id === 's_002')).toMatchObject({ kind: 'spec', ref: 'spec:002', stage: 'build', closed: 25, total: 30 });
  });

  test('graph: milestone-lines in the counted state, 9 nodes and 6 edges', () => {
    const graph = core.planningGraph(planningOf('milestone-lines'));
    expect(kinds(graph)).toEqual({ milestone: 3, feature: 2, spec: 2, bundle: 2 });
    expect([graph.nodes.length, graph.edges.length]).toEqual([9, 6]);
    expect(graph.nodes.filter((n) => n.kind === 'bundle').map((n) => [n.bundle, n.members])).toEqual([['done', ['feature:F1']], ['no-spec', ['feature:F0']]]);
  });

  test('graph: without milestones two ranks, no milestone node', () => {
    const graph = core.planningGraph(planningOf('lantern'));
    expect(kinds(graph)).toEqual({ feature: 1, spec: 2, bundle: 1 });
    expect(graph.edges.length).toBe(2);
    expect(core.planningGraph(planningOf('empty-master'))).toMatchObject({ edges: [], nodes: [{ id: 'b_nospec__none', kind: 'bundle', bundle: 'no-spec', members: ['feature:F0', 'feature:F1'] }] });
    expect(core.planningGraph(core.buildPlanning({ master: null, specs: [], archived: [] }))).toEqual({ nodes: [], edges: [] });
  });

  test('graph options: one lane, archived hidden, a bundle expanded', () => {
    const model = planningOf('harbor');
    const one = core.planningGraph(model, { milestone: 'milestone:harbor-0-9' });
    expect(one.nodes.map((n) => n.id)).toEqual(['m_harbor_0_9', 'f_harbor_0_9_F3', 's_003']);
    expect(core.planningGraph(model, { milestone: null }).nodes.every((n) => n.lane === null)).toBe(true);
    expect(core.planningGraph(model, { milestone: 'milestone:nope' })).toEqual({ nodes: [], edges: [] });
    // Expanded, the done bundle draws F1 with its archived 001.
    const open = core.planningGraph(model, { expand: ['b_done_harbor_1_0'] });
    expect(open.nodes.some((n) => n.id === 'b_done_harbor_1_0')).toBe(false);
    expect(open.edges).toContainEqual({ from: 'f_harbor_1_0_F1', to: 's_001', kind: 'contains' });
    expect(open.nodes.find((n) => n.id === 's_001')).toMatchObject({ archived: true, stage: null });
    expect([open.nodes.length, open.edges.length]).toEqual([20, 17]);
    // Archived hidden: no archived spec node; F1 has no spec left but is full, so it stays in the done bundle.
    const live = core.planningGraph(model, { archived: false });
    expect(live.nodes.some((n) => n.ref === 'spec:001')).toBe(false);
    expect(live.nodes.find((n) => n.id === 'b_done_harbor_1_0')?.members).toEqual(['feature:F1']);
    // The spec-edge kind exists for spec 025 and is never drawn yet.
    expect(core.planningGraph(model).edges.filter((e) => e.kind === 'spec-edge')).toEqual([]);
  });
});
