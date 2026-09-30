import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

type Milestone = PlanningBody['milestones'][number];

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const milestone = (name: string, specs: Milestone['specs']): Milestone => ({
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
const model = (milestones: readonly Milestone[]): PlanningBody => ({ features: [], milestones, recount: null, diagnostics: [] });
const holder = { id: '003', title: 'Planning', main: false, archived: false } as unknown as Milestone['specs'][number];

function setUp(planning: (ws: string) => Promise<ApiResult<PlanningBody>>, initialWs: string | null) {
  const ws = signal<string | null>(initialWs);
  const calls: string[] = [];
  const api = {
    workspaces: () => Promise.resolve(ok([])),
    dashboard: () => Promise.resolve(ok({ specs: [], archive: [] })),
    spec: () => Promise.resolve({ kind: 'not-found', served: false } as const),
    planning: (slug: string) => {
      calls.push(slug);
      return planning(slug);
    },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ShellState, useValue: { ws, specId: signal<string | null>(null) } },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
  return { data: TestBed.inject(ShellData), ws, calls };
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
