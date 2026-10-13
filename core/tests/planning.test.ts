// The planning tree (spec 003): features of the master with their claims and holders, and the milestones across
// them. Probes by name, as spec 003's Test Strategy calls them: "tree" (ISC-100), "main feature" (ISC-100.1),
// "recount" (ISC-100.2), "archived" (ISC-100.3), "milestone format" (ISC-101), "unknown milestone" (ISC-101.1),
// "no milestone" (ISC-101.2), "milestones" (ISC-102). T7 lays the seam; T8 adds "tree", T11 onward the others.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as core from '../src/index.ts';
import type { PlanningInput, PlanningModel } from '../src/planning.ts';
import { DEFAULT_WORKFLOW, boardStages, parseWorkflow } from '../src/workflow.ts';
import { expectGolden, goldenPath, goldenText } from './helpers/golden.ts';
import { buildDashboard } from '../src/dashboard.ts';
import { specIdOf } from '../src/spec-ref.ts';
import type { DashboardInput, DashboardSpecRow } from '../src/dashboard.ts';
import { diagnosticsOf, EXPECTED_WARNINGS } from './helpers/expected-warnings.ts';
import { planningModel, planningOf } from './helpers/planning-model.ts';
import { FIXTURES, fixtureTrees, readTree } from './helpers/read-tree.ts';

const UPDATE_COMMAND = 'bun test core/tests/golden.test.ts';

describe('planning', () => {
  test('seam: buildPlanning returns the empty model for an empty input', () => {
    const workflow = { rows: core.DEFAULT_WORKFLOW, source: 'default' as const, diagnostics: [] };
    const stages = core.boardStages(workflow);
    const stageCounts = Object.fromEntries(stages.map((s) => [s, 0]));
    const empty: PlanningModel = { workflow, stages, stageCounts, features: [], milestones: [], unassignedFeatures: [], ideas: [], recount: null, diagnostics: [] };
    expect(core.buildPlanning({ master: null, specs: [], archived: [] })).toEqual(empty);

    // T18: PlanningInput repeats DashboardInput's fields instead of picking them (planning.ts types against no
    // dashboard.ts), so the two must not drift: `tsc` (check:static) fails here when a DashboardInput stops being a
    // PlanningInput, or when PlanningInput's three fields stop matching the dashboard's.
    const dashboard: DashboardInput = { master: null, constitution: null, tldr: null, specs: [], archived: [] };
    const input: PlanningInput = dashboard;
    const fields: Pick<DashboardInput, 'master' | 'specs' | 'archived'> = input;
    expect(core.buildPlanning(fields)).toEqual(empty);
  });

  // ISC-100: the tree of every fixture equals its committed golden, claim by claim first (a readable failure names
  // the feature and the claim), then byte for byte.
  test.each(fixtureTrees())('tree: %s equals its planning golden, claim by claim', (tree) => {
    const path = goldenPath(tree, 'planning');
    const built = planningOf(tree);
    if (process.env.UPDATE_GOLDEN !== '1') {
      expect(existsSync(path)).toBe(true);
      const golden = JSON.parse(readFileSync(path, 'utf8')) as PlanningModel;
      expect(built.features.map((f) => f.id)).toEqual(golden.features.map((f) => f.id));
      for (const [i, feature] of built.features.entries()) {
        const stored = golden.features[i];
        expect({ feature: feature.id, claims: feature.claims }).toEqual({ feature: stored?.id ?? '', claims: stored?.claims ?? [] });
      }
    }
    expectGolden(path, goldenText(built), UPDATE_COMMAND);
  });

  test('tree: harbor has an archived main holder, unheld claims and totals that add up to the master', () => {
    const model = planningOf('harbor');
    const byId = new Map(model.features.map((f) => [f.id, f]));
    expect(model.features.length).toBeGreaterThan(0);

    // F1 is held by the archived spec 001 alone, which names F1 as its main feature.
    const f1 = byId.get('F1');
    expect(f1?.holders.map((h) => ({ id: h.id, archived: h.archived, main: h.main, stage: h.stage }))).toEqual([
      { id: '001', archived: true, main: true, stage: null },
    ]);
    expect(f1?.claims.every((c) => c.holder === '001' || c.dropped)).toBe(true);

    // F0 carries claims no spec folder lists.
    const f0 = byId.get('F0');
    expect(f0?.unheld.length ?? 0).toBeGreaterThan(0);
    expect(f0?.unheld.every((id) => f0.claims.some((c) => c.id === id && c.holder === null && !c.dropped))).toBe(true);

    // The feature totals cover every live claim of the master, and the recount is the master's own.
    const master = core.parseClaims(readTree('harbor').master ?? '');
    const live = master.claims.filter((c) => !c.dropped);
    expect(model.features.reduce((n, f) => n + f.total, 0)).toBe(live.length);
    expect(model.features.reduce((n, f) => n + f.closed, 0)).toBe(live.filter((c) => c.checked).length);
    expect(model.recount).toEqual(master.counted);
  });

  test('tree: every claim resolves to one holder that lists it, and holders are ordered active first by id', () => {
    for (const tree of fixtureTrees()) {
      const input = readTree(tree);
      const listed = new Map<string, Set<string>>();
      for (const f of [...input.specs, ...input.archived]) {
        if (f.texts.spec !== undefined) listed.set(f.folder.slice(0, 3), new Set(core.parseClaims(f.texts.spec).claims.map((c) => c.id)));
      }
      for (const feature of planningOf(tree).features) {
        for (const claim of feature.claims) {
          if (claim.holder !== null) expect({ tree, claim: claim.id, listed: listed.get(claim.holder)?.has(claim.id) }).toEqual({ tree, claim: claim.id, listed: true });
        }
        const order = feature.holders.map((h) => `${h.archived ? 1 : 0}-${h.id}`);
        expect(order).toEqual([...order].sort());
        expect(feature.unheld).toEqual(feature.claims.filter((c) => c.holder === null && !c.dropped).map((c) => c.id));
        expect(feature.closed).toBe(feature.claims.filter((c) => c.closed && !c.dropped).length);
        expect(feature.total).toBe(feature.claims.filter((c) => !c.dropped).length);
      }
    }
  });
});

// ISC-100.1 and T8's winner rule, on inline inputs (no fixture tree): the master and the spec folders are built here.
const claimLine = (n: number): string => `- [ ] ISC-${n}: Claim ${n} holds.`;
const masterOf = (blocks: ReadonlyArray<{ id: string; name: string; claims: readonly number[] }>): string =>
  ['# Master', '', '## Features', '', ...blocks.flatMap((b) => [`### ${b.id} · ${b.name}`, `Why: ${b.name} matters.`, '', ...b.claims.map(claimLine), ''])].join('\n');
const specOf = (feature: string, claims: readonly number[]): string =>
  ['---', 'task: "A spec"', `isa_feature: ${feature}`, '---', '', '# Spec', '', '## Criteria', '', ...claims.map(claimLine), ''].join('\n');
const folderOf = (folder: string, feature: string, claims: readonly number[]): { folder: string; texts: { spec: string } } => ({
  folder,
  texts: { spec: specOf(feature, claims) },
});
const holdersOf = (model: PlanningModel, feature: string): PlanningModel['features'][number]['holders'] =>
  model.features.find((f) => f.id === feature)?.holders ?? [];

describe('planning: main feature', () => {
  // Shaped like spec 002: F7 plus one claim each of F0 and F2 (the real one also holds F3 and F5).
  const master = masterOf([
    { id: 'F0', name: 'Cross-cutting', claims: [1, 2] },
    { id: 'F2', name: 'Second', claims: [3, 4] },
    { id: 'F7', name: 'Shell', claims: [5, 6, 7] },
  ]);
  const build = (feature002: string): PlanningModel =>
    core.buildPlanning({
      master,
      specs: [folderOf('002-shell', feature002, [1, 3, 5, 6, 7]), folderOf('001-skeleton', 'F0', [2])],
      archived: [],
    });

  test('main feature: a spec holding claims of several blocks appears under each, main only under the first word of isa_feature', () => {
    const model = build('F7');
    for (const id of ['F0', 'F2', 'F7']) expect(holdersOf(model, id).some((h) => h.id === '002')).toBe(true);
    const mainOf = (feature: string, spec: string): boolean | undefined => holdersOf(model, feature).find((h) => h.id === spec)?.main;
    expect(mainOf('F7', '002')).toBe(true);
    expect(mainOf('F0', '002')).toBe(false);
    expect(mainOf('F2', '002')).toBe(false);
    expect(mainOf('F0', '001')).toBe(true);
    expect(holdersOf(model, 'F0').map((h) => [h.id, h.held])).toEqual([['001', 1], ['002', 1]]);
    expect(holdersOf(model, 'F2').map((h) => [h.id, h.held])).toEqual([['002', 1]]);
    expect(holdersOf(model, 'F7').map((h) => [h.id, h.held])).toEqual([['002', 3]]);
    expect(model.features.find((f) => f.id === 'F2')?.unheld).toEqual(['ISC-4']);
  });

  test.each(['F7 · plus F0', 'F7, F0', 'F7 F0'])('main feature: multi-word isa_feature "%s" names F7 alone', (value) => {
    const model = build(`"${value}"`);
    const mains = model.features.flatMap((f) => f.holders.filter((h) => h.id === '002' && h.main).map(() => f.id));
    expect(mains).toEqual(['F7']);
  });

  test('main feature: a claim listed by two folders resolves to the active folder, then the lower id', () => {
    const one = masterOf([{ id: 'F0', name: 'Only', claims: [1, 2] }]);
    // Archived and active both list ISC-1: the active folder wins although its id is higher.
    const active = core.buildPlanning({ master: one, specs: [folderOf('009-live', 'F0', [1])], archived: [folderOf('001-old', 'F0', [1, 2])] });
    expect(active.features[0]?.claims.map((c) => [c.id, c.holder])).toEqual([['ISC-1', '009'], ['ISC-2', '001']]);
    expect(holdersOf(active, 'F0').map((h) => [h.id, h.archived, h.held])).toEqual([['009', false, 1], ['001', true, 1]]);

    // Two active folders list ISC-1: the lower id wins and the loser's held does not count it.
    const twin = core.buildPlanning({ master: one, specs: [folderOf('005-later', 'F0', [1]), folderOf('003-earlier', 'F0', [1, 2])], archived: [] });
    expect(twin.features[0]?.claims.map((c) => [c.id, c.holder])).toEqual([['ISC-1', '003'], ['ISC-2', '003']]);
    expect(holdersOf(twin, 'F0').map((h) => [h.id, h.held])).toEqual([['003', 2]]);
  });
});

// ISC-100.2: the sum of closed and of total over all features equals the master's own recount. Both sides leave
// `[DROPPED …]` tombstones out (`countProgress` and the per-feature counts), so the equality holds as written on every
// fixture tree, leadgen's dropped claim included. It does not hold for a claim outside every feature block, which
// `recount` counts and no feature carries; the last test pins that boundary instead of hiding it.
describe('planning: recount', () => {
  const sum = (model: PlanningModel): { closed: number; total: number } => ({
    closed: model.features.reduce((n, f) => n + f.closed, 0),
    total: model.features.reduce((n, f) => n + f.total, 0),
  });

  test.each(fixtureTrees())('recount: %s, closed and total summed over features equal the master recount', (tree) => {
    const model = planningOf(tree);
    expect(model.recount).not.toBeNull();
    expect({ tree, ...sum(model) }).toEqual({ tree, ...(model.recount ?? { closed: -1, total: -1 }) });
  });

  test.each(fixtureTrees())("recount: %s equals a fresh count of the master's live claims (dropped excluded)", (tree) => {
    const live = core.parseClaims(readTree(tree).master ?? '').claims.filter((c) => !c.dropped);
    expect(planningOf(tree).recount).toEqual({ closed: live.filter((c) => c.checked).length, total: live.length });
  });

  test('recount: a dropped claim leaves both the feature and the recount', () => {
    const master = ['## Features', '', '### F0 · A', '', '- [x] ISC-1: One.', '- [ ] ISC-2: Two.', '- [ ] ISC-3: [DROPPED gone] Three.', ''].join('\n');
    const model = core.buildPlanning({ master, specs: [], archived: [] });
    expect(model.features[0]?.claims.map((c) => c.dropped)).toEqual([false, false, true]);
    expect(sum(model)).toEqual({ closed: 1, total: 2 });
    expect(model.recount).toEqual({ closed: 1, total: 2 });
  });

  test('recount: no master gives no features and a null recount', () => {
    expect(core.buildPlanning({ master: null, specs: [], archived: [] })).toMatchObject({ features: [], recount: null });
  });

  test("recount: a flat ## Claims master has no features and keeps the master's own count", () => {
    const master = ['# Master', '', '## Claims', '', '- [x] ISC-1: One.', '- [ ] ISC-2: Two.', ''].join('\n');
    const model = core.buildPlanning({ master, specs: [], archived: [] });
    expect(model.features).toEqual([]);
    expect(model.recount).toEqual({ closed: 1, total: 2 });
  });

  test('recount: a master without any claim section has no features and a recount of 0/0', () => {
    const model = core.buildPlanning({ master: '# Master\n\n## Notes\n\nNothing here.\n', specs: [], archived: [] });
    expect(model.features).toEqual([]);
    expect(model.recount).toEqual({ closed: 0, total: 0 });
  });

  test('recount: boundary, a claim outside every feature block counts in the recount and under no feature', () => {
    const master = ['## Features', '', '- [ ] ISC-9: Orphan.', '', '### F0 · A', '', '- [x] ISC-1: One.', ''].join('\n');
    const model = core.buildPlanning({ master, specs: [], archived: [] });
    expect(sum(model)).toEqual({ closed: 1, total: 1 });
    expect(model.recount).toEqual({ closed: 1, total: 2 });
  });
});

// ISC-100.3: an archived spec's claims count toward its feature, and the spec is listed under it as archived, with no
// next step and no warning. The numbers are the archive listing's own (`listArchive`), the dashboard's archive rows.
describe('planning: archived', () => {
  const harbor = readTree('harbor');
  const archivedHolder = (): PlanningModel['features'][number]['holders'][number] | undefined =>
    planningOf('harbor').features.find((f) => f.id === 'F1')?.holders.find((h) => h.id === '001');

  test('archived: harbor F1 counts the archived spec 001 as its only holder, equal to the archive listing', () => {
    const f1 = planningOf('harbor').features.find((f) => f.id === 'F1');
    const listed = core.listArchive(harbor.archived).find((a) => a.id === '001');
    expect(listed).toBeDefined();
    expect(f1?.holders).toHaveLength(1);
    expect(f1?.holders[0]).toMatchObject({ id: '001', slug: listed?.slug, title: listed?.title, archived: true, main: true, held: 46 });
    expect({ closed: f1?.closed, total: f1?.total }).toEqual(listed?.claims ?? { closed: -1, total: -1 });
    expect({ closed: f1?.closed, total: f1?.total }).toEqual({ closed: 46, total: 46 });
    expect(f1?.unheld).toEqual([]);
  });

  test('archived: the archived holder carries no next step and no stage', () => {
    const holder = archivedHolder();
    expect(holder?.stage).toBeNull();
    // The holder's whole shape is pinned: a next-command (or any other) field cannot sneak in silently.
    expect(Object.keys(holder ?? {}).sort()).toEqual(['archived', 'assignee', 'hash', 'held', 'id', 'main', 'priority', 'slug', 'stage', 'stageSource', 'title']);
    // An archived spec is assigned to nobody (T65), though 001's events.jsonl names who closed it.
    expect({ stageSource: holder?.stageSource, hash: holder?.hash, assignee: holder?.assignee }).toEqual({ stageSource: null, hash: null, assignee: null });
    for (const key of Object.keys(holder ?? {})) expect(key).not.toMatch(/next|command/i);
  });

  test('archived: no warning names the archived spec, in the planning diagnostics or the dashboard', () => {
    const model = planningOf('harbor');
    expect(model.diagnostics.filter((d) => d.file.startsWith('specs/archive/'))).toEqual([]);
    const dashboard = buildDashboard(harbor);
    expect(dashboard.warningGroups.flatMap((g) => g.items).filter((i) => i.spec === '001')).toEqual([]);
    expect(dashboard.specs.some((r) => r.id === '001')).toBe(false);
    expect(dashboard.diagnostics.filter((d) => d.file.startsWith('specs/archive/'))).toEqual([]);
    expect(dashboard.archive.map((a) => a.id)).toContain('001');
  });

  test('archived: claims held only by an archived folder are counted, listed as archived and not unheld', () => {
    // The master ticks ISC-1 and ISC-2 and the archived folder ticks the same two, as archiving a closed spec leaves them.
    const tick = (text: string): string => text.replace('- [ ] ISC-1:', '- [x] ISC-1:').replace('- [ ] ISC-2:', '- [x] ISC-2:');
    const master = tick(masterOf([{ id: 'F0', name: 'Only', claims: [1, 2, 3] }]));
    const archived = [{ folder: '001-old', texts: { spec: tick(specOf('F0', [1, 2, 3])) } }];
    const model = core.buildPlanning({ master, specs: [], archived });
    const feature = model.features[0];
    expect(feature?.holders).toEqual([
      { id: '001', slug: '001-old', title: 'A spec', archived: true, stage: null, stageSource: null, priority: 'P3', hash: null, assignee: null, main: true, held: 3 },
    ]);
    expect(feature?.unheld).toEqual([]);
    expect(feature?.claims.every((c) => c.holder === '001')).toBe(true);
    expect({ closed: feature?.closed, total: feature?.total }).toEqual({ closed: 2, total: 3 });
    expect(core.listArchive(archived)[0]?.claims).toEqual({ closed: feature?.closed ?? -1, total: feature?.total ?? -1 });
    expect(model.diagnostics).toEqual([]);
  });
});

// Review round 3, finding 6: every core site derives a folder's id and bare slug through `spec-ref.ts`, the definition
// `resolveSpec` uses, so the holder, the dashboard row and the archive listing agree for any prefix width. A folder
// without a numeric prefix keeps its whole name as id and title fallback.
describe('planning: spec id', () => {
  const untitled = (folder: string, claims: readonly number[]): { folder: string; texts: { spec: string } } => ({
    folder,
    texts: { spec: specOf('F0', claims).replace('task: "A spec"\n', '') },
  });

  test('spec id: a four-digit folder 1000-big is holder 1000, as specIdOf, the dashboard and the archive listing read it', () => {
    const master = masterOf([{ id: 'F0', name: 'Only', claims: [1, 2] }]);
    const specs = [untitled('1000-big', [1])];
    const archived = [untitled('1001-old', [2])];
    const model = core.buildPlanning({ master, specs, archived });
    expect(specIdOf('1000-big')).toBe('1000');
    expect(holdersOf(model, 'F0').map((h) => [h.id, h.slug, h.title, h.archived])).toEqual([
      ['1000', '1000-big', 'big', false],
      ['1001', '1001-old', 'old', true],
    ]);
    expect(model.features[0]?.claims.map((c) => c.holder)).toEqual(['1000', '1001']);
    const dashboard = buildDashboard({ master, constitution: null, tldr: null, specs, archived });
    expect(dashboard.specs.map((r) => [r.id, r.title])).toEqual([['1000', 'big']]);
    expect(core.listArchive(archived).map((a) => [a.id, a.title])).toEqual([['1001', 'old']]);
  });

  test('spec id: a folder without a numeric prefix keeps its whole name as id and title fallback', () => {
    const master = masterOf([{ id: 'F0', name: 'Only', claims: [1] }]);
    const model = core.buildPlanning({ master, specs: [untitled('notes', [1])], archived: [] });
    expect(holdersOf(model, 'F0').map((h) => [h.id, h.title])).toEqual([['notes', 'notes']]);
    expect(core.listArchive([untitled('notes', [1])]).map((a) => [a.id, a.title])).toEqual([['notes', 'notes']]);
  });
});

// ISC-101: `milestone:` in a spec's frontmatter and the master's `## Milestones` block are written in FORMAT.md and
// read by core/. The parsers landed in T2/T3, so these tests were green on first run: no red phase is possible.
describe('planning: milestone format', () => {
  const REPO_ROOT = new URL('../..', import.meta.url).pathname;
  const HARBOR_MILESTONES = [
    { name: 'Harbor 0.9', slug: 'harbor-0-9', target: '2026-03-15', description: 'Config through one loader, before the console ships.' },
    { name: 'Harbor 1.0', slug: 'harbor-1-0', target: '2026-05-14', description: 'First release a teammate can install.' },
  ];

  /** Every spec folder of a fixture tree, active and archived, with its frontmatter `milestone`. */
  const milestonesOfSpecs = (tree: string): Array<{ folder: string; milestone: string | null }> => {
    const { specs, archived } = readTree(tree);
    return [...specs, ...archived].map(({ folder, texts }) => ({
      folder,
      milestone: core.parseFrontmatter(texts.spec ?? '').data.milestone,
    }));
  };

  test('milestone format: harbor master parses to two milestones in file order with name, slug, target and description', () => {
    const doc = core.parseMilestones(readTree('harbor').master ?? '');
    expect(doc.milestones.map(({ name, slug, target, description }) => ({ name, slug, target, description }))).toEqual(HARBOR_MILESTONES);
    expect(doc.diagnostics).toEqual([]);
  });

  test('milestone format: the frontmatter key reads on the four harbor specs and yields null on every other spec', () => {
    const byFolder = new Map(milestonesOfSpecs('harbor').map((s) => [s.folder, s.milestone]));
    const carrying = ['001-manifest-sync', '002-web-console', '003-config-loader', '004-retention-policies'];
    expect(byFolder.get('001-manifest-sync')).toBe('Harbor 1.0');
    expect(byFolder.get('002-web-console')).toBe('Harbor 1.0');
    expect(byFolder.get('003-config-loader')).toBe('Harbor 0.9');
    expect(byFolder.get('004-retention-policies')).toBe('Harbor 1.0');
    const others = [...byFolder].filter(([folder]) => !carrying.includes(folder));
    expect(others.length).toBeGreaterThan(0);
    expect(others.every(([, milestone]) => milestone === null)).toBe(true);
  });

  test('milestone format: lantern has no milestone in any spec and no milestone in its master', () => {
    const specs = milestonesOfSpecs('lantern');
    expect(specs.length).toBeGreaterThan(0);
    expect(specs.every((s) => s.milestone === null)).toBe(true);
    expect(core.parseMilestones(readTree('lantern').master ?? '').milestones).toEqual([]);
  });

  test('milestone format: every milestone name a harbor spec carries exists in the master block', () => {
    const known = new Set(core.parseMilestones(readTree('harbor').master ?? '').milestones.map((m) => m.name));
    const carried = milestonesOfSpecs('harbor').flatMap((s) => (s.milestone === null ? [] : [s.milestone]));
    expect(carried.length).toBe(4);
    for (const name of carried) expect(known.has(name)).toBe(true);
  });

  test('milestone format: FORMAT.md documents the frontmatter key, the grammar and a verbatim harbor block', () => {
    const format = readFileSync(`${REPO_ROOT}FORMAT.md`, 'utf8');
    expect(format).toMatch(/^\| `milestone` \| text \|/m);
    expect(format).toContain('`## Milestones`');
    expect(format).toContain('- <name> · <YYYY-MM-DD> · <description?>');

    const marker = 'From `core/fixtures/harbor/ISA.md`:';
    // FORMAT.md quotes the harbor master more than once; the Milestones example is the block that opens with its heading.
    const blocks = format
      .split(marker)
      .slice(1)
      .map((rest) => /^\s*```markdown\n([\s\S]*?)\n```/.exec(rest)?.[1] ?? '');
    const block = blocks.find((b) => b.startsWith('## Milestones'));
    expect(block).toBeDefined();
    const quoted = (block ?? '').split('\n').filter((l) => l !== '');
    expect(quoted).toEqual(['## Milestones', ...HARBOR_MILESTONES.map((m) => `- ${m.name} · ${m.target} · ${m.description}`)]);

    // One substring check per quoted line, in order: the fixture carries them as written (check-format-doc does the rest).
    const fixture = readFileSync(`${REPO_ROOT}core/fixtures/harbor/ISA.md`, 'utf8');
    let from = 0;
    for (const line of quoted) {
      const found = fixture.indexOf(line, from);
      expect(found).toBeGreaterThanOrEqual(from);
      from = found + line.length;
    }
  });
});

// ISC-101.1: a `milestone:` naming no entry of the master's `## Milestones` block warns once and the spec still parses.
describe('planning: unknown milestone', () => {
  const withBlock = (names: readonly string[]): string =>
    [masterOf([{ id: 'F0', name: 'Only', claims: [1, 2] }]), '## Milestones', '', ...names.map((n) => `- ${n} · 2026-12-01 · A release`), ''].join('\n');
  const milestoneSpec = (milestone: string): { folder: string; texts: { spec: string } } => ({
    folder: '006-partial-push',
    texts: { spec: specOf('F0', [1, 2]).replace('isa_feature: F0', `isa_feature: F0\nmilestone: ${milestone}`) },
  });
  const unknown = (model: PlanningModel) => model.diagnostics.filter((d) => d.diagnostic.code === 'spec-milestone-unknown');

  test('unknown milestone: a name the block does not carry yields one warning and the spec still parses', () => {
    const model = core.buildPlanning({ master: withBlock(['Harbor 1.0']), specs: [milestoneSpec('Harbor 2.0')], archived: [] });
    const found = unknown(model);
    expect(found).toHaveLength(1);
    expect(found[0]?.file).toBe('specs/006-partial-push/spec.md');
    expect(found[0]?.diagnostic.severity).toBe('warning');
    expect(found[0]?.diagnostic.message).toBe('milestone "Harbor 2.0" is not in the master\'s ## Milestones block');
    expect(holdersOf(model, 'F0').map((h) => [h.id, h.held])).toEqual([['006', 2]]);
    expect(model.features[0]?.claims.map((c) => c.holder)).toEqual(['006', '006']);
  });

  test('unknown milestone: a master without a block warns for a named milestone', () => {
    const model = core.buildPlanning({ master: masterOf([{ id: 'F0', name: 'Only', claims: [1, 2] }]), specs: [milestoneSpec('X')], archived: [] });
    expect(unknown(model)).toHaveLength(1);
    expect(holdersOf(model, 'F0')).toHaveLength(1);
  });

  // Review round 2, finding 10: an archived spec is "listed, counted, but never given a stage, next step or warning"
  // (`PlanningHolder.archived`), so one naming a removed milestone stays silent while an active one still warns.
  test('unknown milestone: an archived spec naming a removed entry stays silent, the same active spec warns', () => {
    const archived = core.buildPlanning({ master: withBlock(['Harbor 1.0']), specs: [], archived: [milestoneSpec('Old Beta')] });
    expect(unknown(archived)).toEqual([]);
    expect(archived.diagnostics).toEqual([]);
    const active = core.buildPlanning({ master: withBlock(['Harbor 1.0']), specs: [milestoneSpec('Old Beta')], archived: [] });
    expect(unknown(active).map((d) => [d.file, d.diagnostic.subject])).toEqual([['specs/006-partial-push/spec.md', 'Old Beta']]);
  });

  // Review finding 8: the name travels as a field, so a consumer never scrapes it back out of the message.
  test('unknown milestone: the diagnostic carries the frontmatter value as subject, quotes included', () => {
    const plain = unknown(core.buildPlanning({ master: withBlock(['Harbor 1.0']), specs: [milestoneSpec('Harbor 2.0')], archived: [] }));
    expect(plain.map((d) => d.diagnostic.subject)).toEqual(['Harbor 2.0']);
    const quoted = unknown(core.buildPlanning({ master: withBlock(['Harbor 1.0']), specs: [milestoneSpec('Release "Q3"')], archived: [] }));
    expect(quoted.map((d) => d.diagnostic.subject)).toEqual(['Release "Q3"']);
    expect(quoted[0]?.diagnostic.message).toBe('milestone "Release "Q3"" is not in the master\'s ## Milestones block');
  });

  // Review finding 2: the Milestones parser's own warnings reach the planning tree, on the master's file.
  test('milestone format: a malformed milestone line warns master-milestone-line on ISA.md and the valid entry stands', () => {
    const master = [masterOf([{ id: 'F0', name: 'Only', claims: [1, 2] }]), '## Milestones', '', '- Harbor 1.0 · 2026-12-01 · A release', '- Harbor 2.0 · 2026-13-40', ''].join('\n');
    const line = master.split('\n').indexOf('- Harbor 2.0 · 2026-13-40') + 1;
    const model = core.buildPlanning({ master, specs: [], archived: [], now: '2026-03-20' });
    expect(model.milestones.map((m) => m.name)).toEqual(['Harbor 1.0']);
    const found = model.diagnostics.filter((d) => d.diagnostic.code === 'master-milestone-line');
    expect(found.map((d) => [d.file, d.diagnostic.severity, d.diagnostic.line])).toEqual([['ISA.md', 'warning', line]]);
  });

  test('unknown milestone: a known name, or none, yields no warning', () => {
    const known = core.buildPlanning({ master: withBlock(['Harbor 1.0']), specs: [milestoneSpec('Harbor 1.0')], archived: [] });
    expect(unknown(known)).toHaveLength(0);
    const none = core.buildPlanning({ master: withBlock(['Harbor 1.0']), specs: [folderOf('006-partial-push', 'F0', [1])], archived: [] });
    expect(unknown(none)).toHaveLength(0);
  });

  // Review round 3, finding 3: a name the master lists on a line `parseMilestones` skipped is known but unusable. The
  // master's own warning names the cause; the spec gets no second, spurious `spec-milestone-unknown` and joins no row.
  const codes = (model: PlanningModel) => model.diagnostics.map((d) => [d.file, d.diagnostic.code]);
  const skippedMaster = (lines: readonly string[]): string =>
    [masterOf([{ id: 'F0', name: 'Only', claims: [1, 2] }]), '## Milestones', '', ...lines, ''].join('\n');

  test('unknown milestone: a name on a skipped malformed line warns only on the master, and the spec joins no milestone', () => {
    const model = core.buildPlanning({ master: skippedMaster(['- Harbor 1.0 · 2026-13-01']), specs: [milestoneSpec('Harbor 1.0')], archived: [], now: '2026-03-20' });
    expect(codes(model)).toEqual([['ISA.md', 'master-milestone-line']]);
    expect(model.milestones).toEqual([]);
    expect(holdersOf(model, 'F0').map((h) => [h.id, h.held])).toEqual([['006', 2]]);
  });

  test('unknown milestone: a name on a skipped duplicate line warns only on the master, and the spec joins no milestone', () => {
    const model = core.buildPlanning({ master: skippedMaster(['- V1.0 · 2026-05-14', '- v1-0 · 2026-06-01']), specs: [milestoneSpec('v1-0')], archived: [], now: '2026-03-20' });
    expect(codes(model)).toEqual([['ISA.md', 'master-milestone-duplicate']]);
    expect(model.milestones.map((m) => [m.name, m.specs.map((s) => s.id)])).toEqual([['V1.0', []]]);
  });

  test('unknown milestone: an unrelated unknown name still warns beside a skipped line', () => {
    const model = core.buildPlanning({ master: skippedMaster(['- Harbor 1.0 · 2026-13-01']), specs: [milestoneSpec('Harbor 2.0')], archived: [], now: '2026-03-20' });
    expect(codes(model)).toEqual([
      ['ISA.md', 'master-milestone-line'],
      ['specs/006-partial-push/spec.md', 'spec-milestone-unknown'],
    ]);
  });

  test.each(fixtureTrees())('unknown milestone: fixture %s has none', (tree) => {
    expect(unknown(planningOf(tree))).toHaveLength(0);
  });
});

// ISC-101.2 (anti): a tree without milestones gains no diagnostic from the milestone parsers. Falsifiable three ways:
// the dashboard diagnostics of every fixture stay exactly `EXPECTED_WARNINGS` (the pin fixtures.test.ts also uses),
// the planning diagnostics of every fixture carry no milestone code, and inline trees with the key or the block
// absent (alone or in either combination) parse silently.
describe('planning: no milestone', () => {
  const MILESTONE_CODE = /^(spec|master)-milestone-/;
  const trees = fixtureTrees();
  const masterWithoutBlock = masterOf([{ id: 'F0', name: 'Only', claims: [1, 2] }]);
  const masterWithBlock = [masterWithoutBlock, '## Milestones', '', '- Harbor 1.0 · 2026-12-01 · A release', ''].join('\n');
  const codes = (model: PlanningModel): string[] => model.diagnostics.map((d) => d.diagnostic.code);

  test('no milestone: every fixture tree keeps exactly its pinned dashboard diagnostics, zero new', () => {
    expect(Object.keys(EXPECTED_WARNINGS).sort()).toEqual(trees);
    for (const tree of trees) {
      const m = buildDashboard(readTree(tree));
      expect({ tree, errors: diagnosticsOf(m, 'error') }).toEqual({ tree, errors: [] });
      expect({ tree, warnings: diagnosticsOf(m, 'warning') }).toEqual({ tree, warnings: EXPECTED_WARNINGS[tree] ?? [] });
      expect({ tree, milestone: m.diagnostics.map((d) => d.diagnostic.code).filter((c) => MILESTONE_CODE.test(c)) }).toEqual({ tree, milestone: [] });
    }
  });

  test.each(trees)('no milestone: fixture %s planning diagnostics carry no milestone code', (tree) => {
    expect(codes(planningOf(tree)).filter((c) => MILESTONE_CODE.test(c))).toEqual([]);
  });

  test('no milestone: a spec without the key under a master without a block yields no diagnostic from any parser', () => {
    const spec = specOf('F0', [1, 2]);
    expect(core.parseFrontmatter(spec).diagnostics).toEqual([]);
    expect(core.parseFrontmatter(spec).data.milestone).toBeNull();
    expect(core.parseMilestones(masterWithoutBlock).diagnostics).toEqual([]);
    expect(core.parseMilestones(masterWithoutBlock).milestones).toEqual([]);
    const model = core.buildPlanning({ master: masterWithoutBlock, specs: [folderOf('006-partial-push', 'F0', [1, 2])], archived: [] });
    // Nothing beyond the master's own claim diagnostics: none come from a spec file, none carry a milestone code.
    expect(model.diagnostics.filter((d) => d.file !== 'ISA.md')).toEqual([]);
    expect(codes(model).filter((c) => MILESTONE_CODE.test(c))).toEqual([]);
    expect(codes(model)).toEqual(core.parseClaims(masterWithoutBlock).diagnostics.map((d) => d.code));
  });

  test('no milestone: a master with a block and a spec without the key yields no diagnostic (absence is never a warning)', () => {
    const spec = specOf('F0', [1, 2]);
    expect(core.parseFrontmatter(spec).diagnostics).toEqual([]);
    expect(core.parseMilestones(masterWithBlock).diagnostics).toEqual([]);
    expect(core.parseMilestones(masterWithBlock).milestones.map((m) => m.name)).toEqual(['Harbor 1.0']);
    const model = core.buildPlanning({
      master: masterWithBlock,
      specs: [folderOf('006-partial-push', 'F0', [1])],
      archived: [folderOf('001-old', 'F0', [2])],
    });
    expect(model.diagnostics.filter((d) => d.file !== 'ISA.md')).toEqual([]);
    expect(codes(model).filter((c) => MILESTONE_CODE.test(c))).toEqual([]);
    expect(codes(model)).toEqual(core.parseClaims(masterWithBlock).diagnostics.map((d) => d.code));
  });
});

// ISC-102: the milestones of the tree. Each entry of the master's `## Milestones` block is one row, ordered by target
// date (ties keep block order); its specs are every folder whose `milestone:` names it, archived ones included and
// listed last; its progress is the live claims those specs hold, per feature block in master order and summed. The
// state is derived (design 003 § Milestone states): `complete` when every counted claim is closed, `late` when the
// target date lies before `now` otherwise, `upcoming` else. A row counting no claim (0/0) is never `complete`.
describe('planning: milestones', () => {
  /** An active holder's hash: a sha256 hex, its exact value pinned by the golden and by "planning: stages". */
  const SHA256 = expect.stringMatching(/^[0-9a-f]{64}$/) as unknown as string;
  const HARBOR_MILESTONES: PlanningModel['milestones'] = [
    {
      name: 'Harbor 0.9',
      slug: 'harbor-0-9',
      target: '2026-03-15',
      description: 'Config through one loader, before the console ships.',
      closed: 0,
      total: 13,
      state: 'late',
      // harbor's master carries no `Milestone:` line (spec 026): the explicit assignment is empty, the counts unchanged.
      featureIds: [],
      features: [{ id: 'F3', name: 'Config loader rewrite', closed: 0, total: 13 }],
      specs: [
        {
          id: '003',
          slug: '003-config-loader',
          title: 'Read the config through one loader in the CLI, the API and the console',
          archived: false,
          stage: 'tasks',
          stageSource: 'derived',
          priority: 'P3',
          hash: SHA256,
          assignee: null,
          main: false,
          held: 13,
        },
      ],
      ideas: [],
    },
    {
      name: 'Harbor 1.0',
      slug: 'harbor-1-0',
      target: '2026-05-14',
      description: 'First release a teammate can install.',
      closed: 101,
      total: 106,
      state: 'upcoming',
      featureIds: [],
      features: [
        { id: 'F1', name: 'Manifest sync', closed: 46, total: 46 },
        { id: 'F2', name: 'Web console', closed: 25, total: 30 },
        { id: 'F4', name: 'Retention policies', closed: 30, total: 30 },
      ],
      specs: [
        {
          id: '002',
          slug: '002-web-console',
          title: 'Show every sync run and its failures in a small web console',
          archived: false,
          stage: 'build',
          stageSource: 'explicit',
          priority: 'P2',
          hash: SHA256,
          // No lock reading in the planning golden: the last event's actor (T65).
          assignee: { raw: 'u:3f9c0a7d', kind: 'person', id: 'u:3f9c0a7d', legacy: false },
          main: false,
          held: 30,
        },
        {
          id: '004',
          slug: '004-retention-policies',
          title: 'Delete old manifests on a written schedule without touching referenced ones',
          archived: false,
          stage: 'code-review',
          stageSource: 'derived',
          priority: 'P3',
          hash: SHA256,
          assignee: null,
          main: false,
          held: 30,
        },
        {
          id: '001',
          slug: '001-manifest-sync',
          title: 'Mirror every listed manifest into the team registry with one command',
          archived: true,
          stage: null,
          stageSource: null,
          priority: 'P3',
          hash: null,
          assignee: null,
          main: false,
          held: 46,
        },
      ],
      // The story registry-webhooks (F7) names Harbor 1.0 and adds no claim to its 101/106 (spec 008, T55).
      ideas: [
        {
          slug: 'registry-webhooks',
          title: 'A push to an upstream repository triggers a sync of that repository within a minute, without waiting for the schedule.',
          type: 'feature',
          feature: 'F7',
          milestone: 'Harbor 1.0',
          priority: 'P2',
          path: 'specs/ideas/registry-webhooks.md',
        },
      ],
    },
  ];

  /** A master with the given feature blocks, the given claims ticked, and a `## Milestones` block of `name · date · description?` lines. */
  const masterWith = (
    blocks: Parameters<typeof masterOf>[0],
    entries: ReadonlyArray<readonly [string, string, string?]>,
    ticked: readonly number[] = [],
  ): string =>
    [
      ticked.reduce((text, n) => text.replace(`- [ ] ISC-${n}:`, `- [x] ISC-${n}:`), masterOf(blocks)),
      '## Milestones',
      '',
      ...entries.map(([name, date, description]) => (description === undefined ? `- ${name} · ${date}` : `- ${name} · ${date} · ${description}`)),
      '',
    ].join('\n');
  /** A spec folder naming `milestone`, holding `claims`, with `feature` as its isa_feature. */
  const milestoneFolder = (folder: string, milestone: string, feature: string, claims: readonly number[]): { folder: string; texts: { spec: string } } => ({
    folder,
    texts: { spec: specOf(feature, claims).replace(`isa_feature: ${feature}`, `isa_feature: ${feature}\nmilestone: ${milestone}`) },
  });
  const rowsOf = (model: PlanningModel): Array<[string, string, number, number]> => model.milestones.map((m) => [m.name, m.state, m.closed, m.total]);

  test('milestones: harbor has Harbor 0.9 late with 003 and Harbor 1.0 upcoming with 002, 004 and the archived 001', () => {
    expect(planningOf('harbor').milestones).toEqual(HARBOR_MILESTONES);
  });

  test.each(fixtureTrees())('milestones: %s equals the milestones of its planning golden', (tree) => {
    const golden = JSON.parse(readFileSync(goldenPath(tree, 'planning'), 'utf8')) as PlanningModel;
    expect(planningOf(tree).milestones).toEqual(golden.milestones);
    // milestone-lines (spec 026) pins its own milestones in "planning: feature-milestone".
    if (tree !== 'milestone-lines') expect(golden.milestones).toEqual(tree === 'harbor' ? HARBOR_MILESTONES : []);
  });

  test('milestones: lantern, with no block and no milestone key, has none', () => {
    expect(planningOf('lantern').milestones).toEqual([]);
  });

  test("milestones: a milestone's feature counts equal the claims its specs hold of that feature in the tree", () => {
    const model = planningOf('harbor');
    expect(model.milestones.length).toBeGreaterThan(0);
    for (const milestone of model.milestones) {
      const ids = new Set(milestone.specs.map((s) => s.id));
      for (const part of milestone.features) {
        const claims = model.features.find((f) => f.id === part.id)?.claims.filter((c) => !c.dropped && c.holder !== null && ids.has(c.holder)) ?? [];
        expect({ feature: part.id, closed: part.closed, total: part.total }).toEqual({ feature: part.id, closed: claims.filter((c) => c.closed).length, total: claims.length });
      }
      expect(milestone.closed).toBe(milestone.features.reduce((n, f) => n + f.closed, 0));
      expect(milestone.total).toBe(milestone.features.reduce((n, f) => n + f.total, 0));
      expect(milestone.total).toBe(milestone.specs.reduce((n, s) => n + s.held, 0));
    }
  });

  test('milestones: ordered by target date ascending whatever the block order, ties in block order', () => {
    const master = masterWith(
      [{ id: 'F0', name: 'Only', claims: [1] }],
      [
        ['Late one', '2026-12-01'],
        ['Early', '2026-01-10'],
        ['Tie B', '2026-06-01'],
        ['Tie A', '2026-06-01'],
      ],
    );
    const model = core.buildPlanning({ master, specs: [], archived: [], now: '2026-03-20' });
    expect(model.milestones.map((m) => [m.name, m.target])).toEqual([
      ['Early', '2026-01-10'],
      ['Tie B', '2026-06-01'],
      ['Tie A', '2026-06-01'],
      ['Late one', '2026-12-01'],
    ]);
  });

  test('milestones: an entry no spec names is a 0/0 row, late or upcoming by date, never complete', () => {
    const master = masterWith([{ id: 'F0', name: 'Only', claims: [1] }], [['Nobody', '2026-01-10', 'Passed, empty.'], ['Later', '2026-12-01']]);
    const model = core.buildPlanning({ master, specs: [], archived: [], now: '2026-03-20' });
    expect(model.milestones).toEqual([
      { name: 'Nobody', slug: 'nobody', target: '2026-01-10', description: 'Passed, empty.', closed: 0, total: 0, state: 'late', featureIds: [], features: [], specs: [], ideas: [] },
      { name: 'Later', slug: 'later', target: '2026-12-01', description: null, closed: 0, total: 0, state: 'upcoming', featureIds: [], features: [], specs: [], ideas: [] },
    ]);
  });

  test('milestones: complete when every claim of its specs is closed, also when every spec is archived and the date has passed', () => {
    const master = masterWith([{ id: 'F0', name: 'Only', claims: [1, 2, 3] }], [['R1', '2026-01-10']], [1, 2]);
    const archived = [milestoneFolder('001-old', 'R1', 'F0', [1]), milestoneFolder('002-older', 'R1', 'F0', [2])];
    const model = core.buildPlanning({ master, specs: [], archived, now: '2026-03-20' });
    expect(model.milestones[0]).toMatchObject({ closed: 2, total: 2, state: 'complete' });
    expect(model.milestones[0]?.specs.map((s) => [s.id, s.archived, s.main, s.held])).toEqual([
      ['001', true, false, 1],
      ['002', true, false, 1],
    ]);
    // One open claim held by a spec of the milestone turns it late (target passed) or upcoming (target ahead).
    const open = [...archived, milestoneFolder('003-open', 'R1', 'F0', [3])];
    expect(rowsOf(core.buildPlanning({ master, specs: [], archived: open, now: '2026-03-20' }))).toEqual([['R1', 'late', 2, 3]]);
    expect(rowsOf(core.buildPlanning({ master, specs: [], archived: open, now: '2026-01-01' }))).toEqual([['R1', 'upcoming', 2, 3]]);
  });

  test('milestones: late and upcoming flip with now, and on the target date itself it is still upcoming', () => {
    const master = masterWith([{ id: 'F0', name: 'Only', claims: [1, 2] }], [['R1', '2026-03-15']], [1]);
    const specs = [milestoneFolder('001-one', 'R1', 'F0', [1, 2])];
    const stateAt = (now: string): string | undefined => core.buildPlanning({ master, specs, archived: [], now }).milestones[0]?.state;
    expect(stateAt('2026-03-14')).toBe('upcoming');
    expect(stateAt('2026-03-15')).toBe('upcoming');
    expect(stateAt('2026-03-16')).toBe('late');
    expect(stateAt('2027-01-01')).toBe('late');
  });

  test("milestones: without now, the state compares with today's date", () => {
    const master = masterWith([{ id: 'F0', name: 'Only', claims: [1, 2] }], [['Past', '2000-01-01'], ['Future', '2999-12-31']]);
    const specs = [milestoneFolder('001-a', 'Past', 'F0', [1]), milestoneFolder('002-b', 'Future', 'F0', [2])];
    expect(rowsOf(core.buildPlanning({ master, specs, archived: [] }))).toEqual([
      ['Past', 'late', 0, 1],
      ['Future', 'upcoming', 0, 1],
    ]);
  });

  test('milestones: a spec naming an unknown milestone contributes to no row, and its warning stands', () => {
    const master = masterWith([{ id: 'F0', name: 'Only', claims: [1, 2] }], [['R1', '2026-12-01']]);
    const specs = [milestoneFolder('001-known', 'R1', 'F0', [1]), milestoneFolder('002-stray', 'R2', 'F0', [2])];
    const model = core.buildPlanning({ master, specs, archived: [], now: '2026-03-20' });
    expect(rowsOf(model)).toEqual([['R1', 'upcoming', 0, 1]]);
    expect(model.milestones.flatMap((m) => m.specs.map((s) => s.id))).toEqual(['001']);
    expect(model.diagnostics.filter((d) => d.diagnostic.code === 'spec-milestone-unknown').map((d) => d.file)).toEqual(['specs/002-stray/spec.md']);
  });

  test('milestones: progress spans features in master order, counts only live claims the specs win, held across features', () => {
    const blocks = [
      { id: 'F0', name: 'Cross', claims: [1, 2] },
      { id: 'F1', name: 'Untouched', claims: [3] },
      { id: 'F2', name: 'Second', claims: [4, 5, 6] },
    ];
    const master = masterWith(blocks, [['R1', '2026-12-01']], [1, 4]).replace('- [ ] ISC-6:', '- [ ] ISC-6: [DROPPED gone]');
    const specs = [
      // 002 names F2 first and holds live claims of F0 and F2 plus the dropped ISC-6; 003 lists ISC-5, which the lower
      // 001 (no milestone) also lists and therefore wins.
      milestoneFolder('002-multi', 'R1', 'F2', [1, 4, 6]),
      milestoneFolder('003-loser', 'R1', 'F2', [5]),
      folderOf('001-winner', 'F2', [2, 5]),
    ];
    const row = core.buildPlanning({ master, specs, archived: [], now: '2026-03-20' }).milestones[0];
    expect(row?.features).toEqual([
      { id: 'F0', name: 'Cross', closed: 1, total: 1 },
      { id: 'F2', name: 'Second', closed: 1, total: 1 },
    ]);
    expect(row?.specs.map((s) => [s.id, s.main, s.held])).toEqual([
      ['002', false, 2],
      ['003', false, 0],
    ]);
    expect({ closed: row?.closed, total: row?.total, state: row?.state }).toEqual({ closed: 2, total: 2, state: 'complete' });
  });
});

// Spec 008 T55 (ISC-124): the stories of `specs/ideas/` sit in the tree under their feature and their milestone, as
// `ideas` beside the claims and holders, counted apart so no fraction moves; a name the master does not carry is
// `unknown-feature` or `unknown-milestone`, keyed to the story file, and the story is listed under neither.
describe('planning: ideas', () => {
  const slugs = (ideas: ReadonlyArray<{ slug: string }> | undefined): string[] => (ideas ?? []).map((i) => i.slug);
  const codesOf = (model: PlanningModel, ...codes: string[]): string[] =>
    model.diagnostics.filter((d) => codes.includes(d.diagnostic.code)).map((d) => `${d.file}: ${d.diagnostic.code} ${d.diagnostic.subject ?? ''}`);

  test('ideas: harbor lists console-audit-log under F2 and registry-webhooks under F7 and Harbor 1.0', () => {
    const model = planningOf('harbor');
    expect(slugs(model.ideas)).toEqual(['console-audit-log', 'registry-webhooks']);
    const byId = new Map(model.features.map((f) => [f.id, f]));
    expect(slugs(byId.get('F2')?.ideas)).toEqual(['console-audit-log']);
    expect(slugs(byId.get('F7')?.ideas)).toEqual(['registry-webhooks']);
    expect(model.features.filter((f) => f.id !== 'F2' && f.id !== 'F7').every((f) => f.ideas.length === 0)).toBe(true);
    const byName = new Map(model.milestones.map((m) => [m.name, m]));
    expect(slugs(byName.get('Harbor 1.0')?.ideas)).toEqual(['registry-webhooks']);
    expect(slugs(byName.get('Harbor 0.9')?.ideas)).toEqual([]);
  });

  test('ideas: harbor console-audit-log names Harbor 2.0, one unknown-milestone on its file, and sits under no milestone', () => {
    const model = planningOf('harbor');
    expect(codesOf(model, 'unknown-milestone', 'unknown-feature')).toEqual(['specs/ideas/console-audit-log.md: unknown-milestone Harbor 2.0']);
    expect(model.milestones.some((m) => m.ideas.some((i) => i.slug === 'console-audit-log'))).toBe(false);
    // The reader's own finding rides along: registry-webhooks is missing from the index on purpose (T52).
    expect(codesOf(model, 'ideas-index')).toEqual(['specs/ideas/README.md: ideas-index registry-webhooks']);
  });

  test('ideas: stories change no fraction; the tree without ideas counts the same', () => {
    const { master, specs, archived } = readTree('harbor');
    const without = core.buildPlanning({ master, specs, archived, now: '2026-03-20' });
    const withIdeas = planningOf('harbor');
    const counts = (m: PlanningModel) => ({
      recount: m.recount,
      features: m.features.map((f) => [f.id, f.closed, f.total]),
      milestones: m.milestones.map((r) => [r.name, r.closed, r.total, r.state]),
    });
    expect(counts(withIdeas)).toEqual(counts(without));
    expect(without.ideas).toEqual([]);
    expect(without.features.every((f) => f.ideas.length === 0) && without.milestones.every((r) => r.ideas.length === 0)).toBe(true);
    // F7 has a block and no claim: 0/0 with or without its story.
    expect(withIdeas.features.find((f) => f.id === 'F7')).toMatchObject({ closed: 0, total: 0, claims: [] });
  });

  test('ideas: a feature without a block is unknown-feature on the story file; the story stays in the flat list', () => {
    const master = [masterOf([{ id: 'F0', name: 'Only', claims: [1] }]), '## Milestones', '', '- R1 · 2026-12-01 · A release', ''].join('\n');
    const ideas = {
      'README.md': '| Story | Milestone | Priority | Spec |\n|---|---|---|---|\n| stray | R1 | P3 | — |\n| none | — | P3 | — |\n',
      'stray.md': '---\nstatus: idea\ntype: feature\nfeature: F9\nmilestone: R1\n---\n## Goal\nA stray story.\n',
      'none.md': '---\nstatus: idea\ntype: chore\n---\n## Goal\nA story of no feature.\n',
    };
    const model = core.buildPlanning({ master, specs: [], archived: [], ideas, now: '2026-03-20' });
    expect(codesOf(model, 'unknown-feature', 'unknown-milestone')).toEqual(['specs/ideas/stray.md: unknown-feature F9']);
    expect(model.diagnostics.find((d) => d.diagnostic.code === 'unknown-feature')?.diagnostic.severity).toBe('warning');
    expect(slugs(model.ideas)).toEqual(['none', 'stray']);
    expect(model.features.every((f) => f.ideas.length === 0)).toBe(true);
    // The unknown feature does not hide the story from its known milestone.
    expect(slugs(model.milestones[0]?.ideas)).toEqual(['stray']);
  });

  test('ideas: a milestone the master lists on a skipped line is known: no warning, under no milestone', () => {
    const master = [masterOf([{ id: 'F0', name: 'Only', claims: [1] }]), '## Milestones', '', '- Later · someday · undated', ''].join('\n');
    const ideas = { 'README.md': '| Story |\n|---|\n| later |\n', 'later.md': '---\nstatus: idea\nfeature: F0\nmilestone: Later\n---\n' };
    const model = core.buildPlanning({ master, specs: [], archived: [], ideas });
    expect(codesOf(model, 'unknown-feature', 'unknown-milestone')).toEqual([]);
    expect(slugs(model.features[0]?.ideas)).toEqual(['later']);
  });

  test('ideas: without a master the stories are listed flat with the reader findings and no unknown-* warning', () => {
    const ideas = { 'lone.md': '---\nstatus: idea\nfeature: F1\nmilestone: M\n---\n' };
    const model = core.buildPlanning({ master: null, specs: [], archived: [], ideas });
    expect(slugs(model.ideas)).toEqual(['lone']);
    expect(codesOf(model, 'unknown-feature', 'unknown-milestone', 'ideas-index')).toEqual(['specs/ideas/README.md: ideas-index lone']);
  });

  test.each(['lantern', 'leadgen', 'spectant-001', 'empty-master'])('ideas: %s has no stories, so every ideas list is empty', (tree) => {
    const model = planningOf(tree);
    expect(model.ideas).toEqual([]);
    expect(model.features.every((f) => f.ideas.length === 0) && model.milestones.every((m) => m.ideas.length === 0)).toBe(true);
  });
});

// The board on the planning tree (spec 008, T64, ISC-129): the workflow, its board stages, the count per stage, and
// per holder the dashboard's stage and source, the priority and the raw sha256 of spec.md. `-t "planning: stages"`.
describe('planning: stages', () => {
  /** The dashboard golden's rows of a tree, by folder slug: the values the holders must carry. */
  type Row = Pick<DashboardSpecRow, 'stage' | 'stageSource' | 'priority'>;
  const dashboardRows = (tree: string): Map<string, Row> => {
    const golden = JSON.parse(readFileSync(goldenPath(tree, 'dashboard'), 'utf8')) as { specs: ReadonlyArray<Row & { slug: string }> };
    return new Map(golden.specs.map((r) => [r.slug, { stage: r.stage, stageSource: r.stageSource, priority: r.priority }]));
  };
  const holdersOfModel = (model: PlanningModel) => [...model.features.flatMap((f) => f.holders), ...model.milestones.flatMap((m) => m.specs)];
  const sum = (counts: Readonly<Partial<Record<string, number>>>): number => Object.values(counts).reduce<number>((n, c) => n + (c ?? 0), 0);

  test("stages: harbor's active holders carry the stage, source and priority the dashboard golden shows, archived ones none", () => {
    const model = planningOf('harbor');
    const rows = dashboardRows('harbor');
    const holders = holdersOfModel(model);
    expect(holders.some((h) => !h.archived)).toBe(true);
    for (const h of holders) {
      if (h.archived) {
        expect({ slug: h.slug, stage: h.stage, stageSource: h.stageSource, hash: h.hash }).toEqual({ slug: h.slug, stage: null, stageSource: null, hash: null });
        continue;
      }
      const row = rows.get(h.slug);
      expect({ slug: h.slug, known: row !== undefined }).toEqual({ slug: h.slug, known: true });
      expect({ slug: h.slug, stage: h.stage, stageSource: h.stageSource, priority: h.priority }).toEqual({
        slug: h.slug,
        stage: row?.stage ?? null,
        stageSource: row?.stageSource ?? null,
        priority: row?.priority ?? 'P3',
      });
    }
    // The explicit stage reaches the tree: harbor's 002 and 006 carry `stage:` (fixtures README).
    const explicit = new Set(holders.filter((h) => h.stageSource === 'explicit').map((h) => h.slug));
    expect(explicit.size).toBeGreaterThan(0);
    expect([...explicit].every((slug) => rows.get(slug)?.stageSource === 'explicit')).toBe(true);
  });

  test("stages: an active holder's hash is the raw sha256 hex of its spec.md bytes, as the server's writes compare it", () => {
    const holders = holdersOfModel(planningOf('harbor')).filter((h) => !h.archived);
    for (const h of holders) {
      const bytes = readFileSync(join(FIXTURES, 'harbor', 'specs', h.slug, 'spec.md'));
      expect({ slug: h.slug, hash: h.hash }).toEqual({ slug: h.slug, hash: createHash('sha256').update(bytes).digest('hex') });
    }
  });

  test('stages: harbor runs its workflow file, its board puts review before tasks, and the counts per stage add up', () => {
    const model = planningOf('harbor');
    expect(model.workflow).toEqual(readTree('harbor').workflow ?? parseWorkflow(null));
    expect(model.workflow.source).toBe('file');
    expect(model.stages).toEqual(boardStages(model.workflow));
    expect(Object.keys(model.stageCounts)).toEqual([...model.stages]);
    // Each active spec once, in its dashboard stage, and each story in idea.
    const rows = dashboardRows('harbor');
    expect(sum(model.stageCounts)).toBe(rows.size + model.ideas.length);
    expect(model.stageCounts.idea).toBe(model.ideas.length);
    for (const stage of model.stages.filter((s) => s !== 'idea')) {
      expect({ stage, count: model.stageCounts[stage] }).toEqual({ stage, count: [...rows.values()].filter((r) => r.stage === stage).length });
    }
  });

  test.each(fixtureTrees())('stages: %s, the counts per stage add up to its active specs and stories', (tree) => {
    const model = planningOf(tree);
    expect(sum(model.stageCounts)).toBe(dashboardRows(tree).size + model.ideas.length);
  });

  test('stages: lantern runs the default table and the default board', () => {
    const model = planningOf('lantern');
    expect(model.workflow).toEqual({ rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] });
    expect(model.stages).toEqual(['idea', 'plan', 'tasks', 'review', 'build', 'blocked', 'close-pending', 'code-review', 'close', 'done']);
    const rows = dashboardRows('lantern');
    for (const h of holdersOfModel(model).filter((x) => !x.archived)) expect([h.slug, h.stage]).toEqual([h.slug, rows.get(h.slug)?.stage ?? '']);
  });

  test('stages: without spec states from the caller every holder has no stage and no hash, and only stories are counted', () => {
    const { master, specs, archived } = readTree('harbor');
    const model = core.buildPlanning({ master, specs, archived, now: '2026-03-20' });
    const holders = holdersOfModel(model);
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.every((h) => h.stage === null && h.stageSource === null && h.hash === null)).toBe(true);
    expect(model.workflow.source).toBe('default');
    expect(sum(model.stageCounts)).toBe(0);
    // The priority is the spec's own frontmatter, read in the tree: P3 when absent or invalid.
    const rows = dashboardRows('harbor');
    for (const h of holders.filter((x) => !x.archived)) expect([h.slug, h.priority]).toEqual([h.slug, rows.get(h.slug)?.priority ?? '']);
  });
});

// ISC-124.1 (T56): a feature block with its `Why:` line and no claim is a feature of the tree, 0/0, without a finding.
describe('planning: empty block', () => {
  test('empty block: harbor F7 counts 0/0 with no diagnostic, its story under it', () => {
    const model = planningOf('harbor');
    const f7 = model.features.find((f) => f.id === 'F7');
    expect(f7).toMatchObject({ id: 'F7', closed: 0, total: 0, claims: [], holders: [], unheld: [] });
    expect(f7?.why).not.toBeNull();
    expect(f7?.ideas.map((i) => i.slug)).toEqual(['registry-webhooks']);
    expect(model.diagnostics.filter((d) => d.diagnostic.subject === 'F7' || d.diagnostic.message.includes('F7'))).toEqual([]);
  });

  test('empty block: a synthetic block with a Why: line, zero claims and no story is 0/0, and the tree has no diagnostic', () => {
    const master = masterOf([
      { id: 'F0', name: 'Base', claims: [1] },
      { id: 'F7', name: 'Empty', claims: [] },
    ]);
    const model = core.buildPlanning({ master, specs: [folderOf('001-base', 'F0', [1])], archived: [], now: '2026-03-20' });
    expect(model.features.find((f) => f.id === 'F7')).toMatchObject({ id: 'F7', why: 'Empty matters.', closed: 0, total: 0, claims: [], holders: [], unheld: [], ideas: [] });
    expect(model.diagnostics).toEqual([]);
    expect(model.recount).toEqual({ closed: 0, total: 1 });
  });
});

// ISC-166 (spec 026, T2): a feature block names its milestone on a line `Milestone: <name>` directly under `Why:`, and
// the tree hangs each feature under exactly the milestone its line names: `PlanningMilestone.featureIds`, in master
// order. A feature without the line, or whose line names no entry of the `## Milestones` block (until T6 adds the
// warning), sits in the trailing no-milestone group `PlanningModel.unassignedFeatures`. The assignment moves no number:
// a milestone's specs and progress still come from the specs' `milestone:` (the sum over features is T7).
describe('planning: feature-milestone', () => {
  const trees = fixtureTrees();
  const header = (body: readonly string[]): string => ['# M', '', '## Features', '', ...body, '', '## Milestones', '', '- Kite 1.0 · 2026-04-01 · First', ''].join('\n');

  test('feature-milestone: the parser reads Milestone: directly under Why: into FeatureBlock.milestone, null without the line', () => {
    const doc = core.parseClaims(
      header([
        '### F1 · Named',
        'Why: one reason.',
        'Milestone: Kite 1.0',
        '',
        '- [ ] ISC-1: a',
        '',
        '### F2 · Plain',
        'Why: another reason.',
        '',
        '- [ ] ISC-2: b',
        '',
        '### F3 · Late line',
        'Why: a third reason.',
        '',
        '- [ ] ISC-3: c',
        'Milestone: Kite 1.0',
        '',
        '### F4 · No why',
        'Milestone: Kite 1.0',
        '- [ ] ISC-4: d',
        '',
        '### F5 · Padded',
        'Why: a fifth reason.',
        'Milestone:   Kite 1.0   ',
        '- [ ] ISC-5: e',
      ]),
    );
    expect(doc.features.map((f) => ({ id: f.id, why: f.why, milestone: f.milestone, claims: f.claims }))).toEqual([
      { id: 'F1', why: 'one reason.', milestone: 'Kite 1.0', claims: ['ISC-1'] },
      { id: 'F2', why: 'another reason.', milestone: null, claims: ['ISC-2'] },
      // After a claim the line is prose, not the block's milestone.
      { id: 'F3', why: 'a third reason.', milestone: null, claims: ['ISC-3'] },
      // Without a Why: line there is nothing for the line to stand under.
      { id: 'F4', why: null, milestone: null, claims: ['ISC-4'] },
      { id: 'F5', why: 'a fifth reason.', milestone: 'Kite 1.0', claims: ['ISC-5'] },
    ]);
    // The line is not a claim and not a diagnostic.
    expect(doc.claims.map((c) => c.id)).toEqual(['ISC-1', 'ISC-2', 'ISC-3', 'ISC-4', 'ISC-5']);
    expect(doc.diagnostics).toEqual([]);
  });

  test('feature-milestone: milestone-lines hangs F1 under Beacon 0.5, F2 under Beacon 1.0, and F0 and F3 in the no-milestone group', () => {
    const model = planningOf('milestone-lines');
    expect(model.features.map((f) => f.id)).toEqual(['F0', 'F1', 'F2', 'F3']);
    expect(model.milestones.map((m) => ({ name: m.name, featureIds: m.featureIds }))).toEqual([
      { name: 'Beacon 0.5', featureIds: ['F1'] },
      { name: 'Beacon 1.0', featureIds: ['F2'] },
    ]);
    // F0 has no line; F3 names Beacon 2.0, which the block does not list.
    expect(model.unassignedFeatures).toEqual(['F0', 'F3']);
    // No silent re-hang: 002 names Beacon 0.5 and stays a spec of it, though its main feature F2 names Beacon 1.0; the
    // progress is still the specs' (T7 sums the features).
    const byName = new Map(model.milestones.map((m) => [m.name, m]));
    expect(byName.get('Beacon 0.5')?.specs.map((s) => s.id)).toEqual(['001', '002']);
    expect(byName.get('Beacon 0.5')).toMatchObject({ closed: 3, total: 7 });
    expect(byName.get('Beacon 1.0')?.specs).toEqual([]);
    expect(byName.get('Beacon 1.0')).toMatchObject({ closed: 0, total: 0 });
  });

  test('feature-milestone: a master without Milestone: lines puts every feature in the no-milestone group and keeps every milestone', () => {
    // harbor: a ## Milestones block, no line; lantern: neither.
    const harbor = planningOf('harbor');
    expect(harbor.milestones.map((m) => m.featureIds)).toEqual([[], []]);
    expect(harbor.unassignedFeatures).toEqual(harbor.features.map((f) => f.id));
    const lantern = planningOf('lantern');
    expect(lantern.milestones).toEqual([]);
    expect(lantern.unassignedFeatures).toEqual(['F0', 'F1']);
    expect(core.buildPlanning({ master: null, specs: [], archived: [] }).unassignedFeatures).toEqual([]);
  });

  test.each(trees)('feature-milestone: %s puts every feature in exactly one group and equals its planning golden', (tree) => {
    const model = planningOf(tree);
    // buildPlanning always sets both fields (optional only in the type): `undefined` here would fail the comparison.
    expect(model.unassignedFeatures).toBeDefined();
    expect(model.milestones.filter((m) => m.featureIds === undefined)).toEqual([]);
    const placed = [...model.milestones.flatMap((m) => m.featureIds ?? []), ...(model.unassignedFeatures ?? [])];
    expect([...placed].sort()).toEqual(model.features.map((f) => f.id).sort());
    expect(new Set(placed).size).toBe(placed.length);
    expectGolden(goldenPath(tree, 'planning'), goldenText(model), UPDATE_COMMAND);
  });
});

// ISC-127 (T57): this repository's own backlog. `ISA.md` and `specs/` are untracked, so the test runs only in a
// checkout that has them (skipped elsewhere, never passed); nothing from those files is quoted here, it reads them.
describe('planning: backlog', () => {
  const ROOT = join(import.meta.dir, '..', '..');
  const present = existsSync(join(ROOT, 'specs', 'ideas')) && existsSync(join(ROOT, 'ISA.md'));

  test.skipIf(!present)('backlog: the own tree holds F10 to F22 and three milestones, every story names both, zero unknown-*', () => {
    const model = planningModel(ROOT);
    const blocks = new Set(model.features.map((f) => f.id));
    const wanted = Array.from({ length: 13 }, (_, i) => `F${i + 10}`);
    expect(wanted.filter((id) => !blocks.has(id))).toEqual([]);
    expect(model.milestones).toHaveLength(3);
    const milestones = new Set(model.milestones.map((m) => m.name));
    expect(model.ideas.length).toBeGreaterThan(0);
    const stray = model.ideas.filter((i) => i.feature === null || !blocks.has(i.feature) || i.milestone === null || !milestones.has(i.milestone));
    expect(stray.map((i) => i.slug)).toEqual([]);
    expect(model.diagnostics.filter((d) => d.diagnostic.code.startsWith('unknown-')).map((d) => `${d.file}: ${d.diagnostic.code}`)).toEqual([]);
  });
});
