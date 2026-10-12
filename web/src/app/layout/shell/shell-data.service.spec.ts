import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

type Milestone = PlanningBody['milestones'][number];

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const milestone = (name: string, specs: Milestone['specs']): Milestone => ({
  ideas: [],
  name,
  slug: name,
  target: '2026-12-01',
  description: null,
  closed: 0,
  total: 0,
  state: 'upcoming',
  features: [],
  specs,
});
const model = (milestones: readonly Milestone[]): PlanningBody => ({
  workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: [],
  stageCounts: {},
  ideas: [],
  features: [],
  milestones,
  recount: null,
  diagnostics: [],
});
const holder = { id: '003', title: 'Planning', main: false, archived: false } as unknown as Milestone['specs'][number];

function setUp(
  planning: (ws: string) => Promise<ApiResult<PlanningBody>>,
  initialWs: string | null,
  extra: Partial<Record<'actors' | 'putActors' | 'boardQuery' | 'putBoardQuery' | 'tech', unknown>> = {},
) {
  const ws = signal<string | null>(initialWs);
  const wsPage = signal<string | null>(null);
  const calls: string[] = [];
  const techCalls: string[] = [];
  const api = {
    workspaces: () => Promise.resolve(ok([])),
    dashboard: () => Promise.resolve(ok({ specs: [], archive: [] })),
    spec: () => Promise.resolve({ kind: 'not-found', served: false } as const),
    planning: (slug: string) => {
      calls.push(slug);
      return planning(slug);
    },
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: '' })),
    tech: (slug: string) => {
      techCalls.push(slug);
      return Promise.resolve(ok({ pages: null, specs: [] }));
    },
    ...extra,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ShellState, useValue: { ws, wsPage, specId: signal<string | null>(null) } },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
  return { data: TestBed.inject(ShellData), ws, wsPage, calls, techCalls };
}

async function settle(): Promise<void> {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

describe('ShellData.planning (T22)', () => {
  it('loads when the workspace is set and not otherwise, and reloads on a change', async () => {
    const { data, ws, calls } = setUp(() => Promise.resolve(ok(model([]))), null);
    await settle();
    expect(calls).toEqual([]);
    expect(data.planningModel()).toBeNull();
    ws.set('harbor');
    await settle();
    expect(calls).toEqual(['harbor']);
    expect(data.planningModel()).toEqual(model([]));
    ws.set('lantern');
    await settle();
    expect(calls).toEqual(['harbor', 'lantern']);
  });

  it('has no milestones for an empty list', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor');
    await settle();
    expect(data.hasMilestones()).toBe(false);
  });

  it('has no milestones when every entry is held by no spec (a 0/0 row)', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([milestone('v1', []), milestone('v2', [])]))), 'harbor');
    await settle();
    expect(data.hasMilestones()).toBe(false);
  });

  it('has milestones when one entry is held by a spec', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([milestone('v1', []), milestone('v2', [holder])]))), 'harbor');
    await settle();
    expect(data.hasMilestones()).toBe(true);
  });

  it('yields a null model and no milestones for a not-found answer, and flags it', async () => {
    const { data } = setUp(() => Promise.resolve({ kind: 'not-found', served: true }), 'harbor');
    await settle();
    expect(data.planningModel()).toBeNull();
    expect(data.hasMilestones()).toBe(false);
    expect(data.planningMissing()).toBe(true);
    expect(data.planningUnavailable()).toBe(false);
  });

  it('does not flag an unserved route as missing, and flags an unavailable workspace', async () => {
    const unserved = setUp(() => Promise.resolve({ kind: 'not-found', served: false }), 'harbor');
    await settle();
    expect(unserved.data.planningMissing()).toBe(false);
    TestBed.resetTestingModule();
    const down = setUp(() => Promise.resolve({ kind: 'unavailable', body: { reason: 'x' } as never }), 'harbor');
    await settle();
    expect(down.data.planningUnavailable()).toBe(true);
    expect(down.data.hasMilestones()).toBe(false);
  });
});

describe('ShellData spec 008 (T112, ISC-129.1)', () => {
  const idea = { slug: 'tide-tables', title: 'Tide tables', type: 'feature', feature: null, milestone: null, priority: 'P3', path: 'specs/ideas/tide-tables.md' } as const;
  const board = (): PlanningBody => ({
    ...model([]),
    workflow: { rows: [], source: 'file', diagnostics: [] },
    stages: ['idea', 'plan', 'build', 'blocked', 'done'],
    stageCounts: { idea: 1, plan: 2, build: 0 },
    ideas: [idea],
  });

  it('exposes the planning model\'s workflow, stages, stage counts and ideas as signals', async () => {
    const { data } = setUp(() => Promise.resolve(ok(board())), 'harbor');
    await settle();
    expect(data.workflow()).toEqual({ rows: [], source: 'file', diagnostics: [] });
    expect(data.stages()).toEqual(['idea', 'plan', 'build', 'blocked', 'done']);
    expect(data.stageCounts()).toEqual({ idea: 1, plan: 2, build: 0 });
    expect(data.ideas()).toEqual([idea]);
  });

  it('answers null workflow and empty stages, counts and ideas while the planning tree is not ok', async () => {
    const { data } = setUp(() => Promise.resolve({ kind: 'not-found', served: true }), 'harbor');
    await settle();
    expect(data.workflow()).toBeNull();
    expect(data.stages()).toEqual([]);
    expect(data.stageCounts()).toEqual({});
    expect(data.ideas()).toEqual([]);
  });

  it('loads the actor names once, and reloads them after an accepted PUT only', async () => {
    const stored = [{ id: 'u:3f9c0a7d', displayName: 'Harbour Master', gitIdentities: [] }];
    let reads = 0;
    let current: readonly unknown[] = [];
    const { data } = setUp(() => Promise.resolve(ok(model([]))), null, {
      actors: () => {
        reads += 1;
        return Promise.resolve(ok(current));
      },
      putActors: (list: readonly unknown[]) => {
        if (list.length === 0) return Promise.resolve({ kind: 'error', status: 400, error: 'invalid-body' });
        current = list;
        return Promise.resolve({ kind: 'ok', body: list });
      },
    });
    await settle();
    expect(reads).toBe(1);
    expect(data.actorList()).toEqual([]);

    expect(await data.saveActors(stored)).toEqual({ kind: 'ok', body: stored });
    await settle();
    expect(reads).toBe(2);
    expect(data.actorList()).toEqual(stored);

    expect(await data.saveActors([])).toEqual({ kind: 'error', status: 400, error: 'invalid-body' });
    await settle();
    expect(reads).toBe(2);
    expect(data.actorList()).toEqual(stored);
  });

  it('answers an empty actor list when the actor route fails', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([]))), null, { actors: () => Promise.reject(new Error('down')) });
    await settle();
    expect(data.actorList()).toEqual([]);
  });

  it('loads the board query per workspace, and keeps the stored query after a PUT', async () => {
    const reads: string[] = [];
    const puts: Array<[string, string]> = [];
    const { data, ws } = setUp(() => Promise.resolve(ok(model([]))), null, {
      boardQuery: (slug: string) => {
        reads.push(slug);
        return Promise.resolve(ok({ query: slug === 'harbor' ? 'feature=F1' : '' }));
      },
      putBoardQuery: (slug: string, query: string) => {
        puts.push([slug, query]);
        return Promise.resolve({ kind: 'ok', body: { query } });
      },
    });
    await settle();
    expect(reads).toEqual([]);
    expect(data.boardQueryText()).toBeNull();
    expect(await data.saveBoardQuery('col=build')).toEqual({ kind: 'error', status: 0, error: null });

    ws.set('harbor');
    await settle();
    expect(reads).toEqual(['harbor']);
    expect(data.boardQueryText()).toBe('feature=F1');

    expect(await data.saveBoardQuery('group=feature')).toEqual({ kind: 'ok', body: { query: 'group=feature' } });
    TestBed.tick();
    expect(puts).toEqual([['harbor', 'group=feature']]);
    expect(data.boardQueryText()).toBe('group=feature');
    expect(reads).toEqual(['harbor']);

    ws.set('lantern');
    await settle();
    expect(reads).toEqual(['harbor', 'lantern']);
    expect(data.boardQueryText()).toBe('');
  });
});

describe('ShellData.tech (spec 023)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('loads the tech model only on the tech page, keyed by the workspace', async () => {
    const { data, ws, wsPage, techCalls } = setUp(() => Promise.resolve(ok(model([]))), 'harbor');
    await settle();
    expect(techCalls).toEqual([]);
    expect(data.tech.status()).toBe('idle');
    wsPage.set('tech');
    await settle();
    expect(techCalls).toEqual(['harbor']);
    expect(data.techModel()).toEqual({ pages: null, specs: [] });
    ws.set('lantern');
    await settle();
    expect(techCalls).toEqual(['harbor', 'lantern']);
    wsPage.set('board');
    await settle();
    expect(data.tech.status()).toBe('idle');
    expect(data.techModel()).toBeNull();
    expect(data.tech.reload()).toBe(false);
    await settle();
    expect(techCalls).toEqual(['harbor', 'lantern']);
  });

  it('flags the tech page missing on the tech route\'s served 404, not on the catch-all', async () => {
    const served = setUp(() => Promise.resolve(ok(model([]))), 'harbor', { tech: () => Promise.resolve({ kind: 'not-found', served: true }) });
    served.wsPage.set('tech');
    await settle();
    expect(served.data.techMissing()).toBe(true);
    TestBed.resetTestingModule();
    const unserved = setUp(() => Promise.resolve(ok(model([]))), 'harbor', { tech: () => Promise.resolve({ kind: 'not-found', served: false }) });
    unserved.wsPage.set('tech');
    await settle();
    expect(unserved.data.techMissing()).toBe(false);
  });
});
