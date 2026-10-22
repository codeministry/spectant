import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import { ToastService } from '../../shared/ui/toast/toast';
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
  asOf: '2026-03-20', workflow: { rows: [], source: 'default', diagnostics: [] },
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
  extra: Partial<
    Record<'actors' | 'putActors' | 'boardQuery' | 'putBoardQuery' | 'tech' | 'dashboard' | 'favorites' | 'putFavorite' | 'deleteFavorite' | 'putIdeaFavorite' | 'deleteIdeaFavorite', unknown>
  > = {},
) {
  const ws = signal<string | null>(initialWs);
  const wsPage = signal<string | null>(null);
  const calls: string[] = [];
  const toasts: string[] = [];
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
    favorites: () => Promise.resolve(ok({ specs: [], ideas: [] })),
    tech: (slug: string) => {
      techCalls.push(slug);
      return Promise.resolve(ok({ pages: null, specs: [] }));
    },
    ...extra,
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ToastService, useValue: { show: (message: string) => toasts.push(message) } },
      { provide: ShellState, useValue: { ws, wsPage, specId: signal<string | null>(null) } },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
  return { data: TestBed.inject(ShellData), ws, wsPage, calls, techCalls, toasts };
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


// Spec 052, T10 and T11 · ISC-300, ISC-302: one favourite set per workspace, shared by every star, switched
// optimistically, and the rows the header's spec select lists.
describe('ShellData favourites (spec 052, T10, T11)', () => {
  type Favorites = { readonly specs: readonly string[]; readonly ideas: readonly string[] };
  type Answer = { readonly kind: 'ok'; readonly body: Favorites } | { readonly kind: 'error'; readonly status: number; readonly error: string | null };
  const row = (id: string, slug: string) => ({ id, slug, title: slug, stage: 'build' });
  const dashboard = () =>
    Promise.resolve(
      ok({
        specs: [row('007', '007-tide-tables'), row('002', '002-web-console'), row('004', '004-retention-policies')],
        archive: [row('001', '001-bootstrap')],
      }),
    );
  const deferred = () => {
    let resolve!: (answer: Answer) => void;
    const promise = new Promise<Answer>((done) => (resolve = done));
    return { promise, resolve };
  };

  it('loads the set per workspace, none without one, and reloads on a change', async () => {
    const reads: string[] = [];
    const { data, ws } = setUp(() => Promise.resolve(ok(model([]))), null, {
      favorites: (slug: string) => {
        reads.push(slug);
        return Promise.resolve(ok({ specs: slug === 'harbor' ? ['002-web-console'] : [] }));
      },
    });
    await settle();
    expect(reads).toEqual([]);
    expect([...data.favoriteIds()]).toEqual([]);
    ws.set('harbor');
    await settle();
    expect(reads).toEqual(['harbor']);
    expect([...data.favoriteIds()]).toEqual(['002-web-console']);
    expect(data.isFavorite('002-web-console')).toBe(true);
    expect(data.isFavorite('004-retention-policies')).toBe(false);
    ws.set('lantern');
    await settle();
    expect(reads).toEqual(['harbor', 'lantern']);
    expect([...data.favoriteIds()]).toEqual([]);
  });

  it('answers an empty set when the favourites route fails', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', { favorites: () => Promise.reject(new Error('down')) });
    await settle();
    expect([...data.favoriteIds()]).toEqual([]);
    expect(data.favoriteRows()).toEqual([]);
  });

  it('stars at once, sends the PUT, then takes the set the server answers', async () => {
    const put = deferred();
    const puts: Array<[string, string]> = [];
    const { data, toasts } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      favorites: () => Promise.resolve(ok({ specs: ['002-web-console'], ideas: [] })),
      putFavorite: (slug: string, spec: string) => {
        puts.push([slug, spec]);
        return put.promise;
      },
    });
    await settle();
    const toggled = data.toggleFavorite('004-retention-policies');
    expect(data.isFavorite('004-retention-policies')).toBe(true);
    expect([...data.favoriteIds()]).toEqual(['002-web-console', '004-retention-policies']);
    expect(puts).toEqual([['harbor', '004-retention-policies']]);

    put.resolve({ kind: 'ok', body: { specs: ['004-retention-policies', '007-tide-tables'], ideas: [] } });
    expect(await toggled).toBe(true);
    TestBed.tick();
    expect([...data.favoriteIds()]).toEqual(['004-retention-policies', '007-tide-tables']);
    expect(toasts).toEqual([]);
  });

  it('unstars at once and sends the DELETE', async () => {
    const deletes: Array<[string, string]> = [];
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      favorites: () => Promise.resolve(ok({ specs: ['002-web-console', '004-retention-policies'], ideas: [] })),
      deleteFavorite: (slug: string, spec: string) => {
        deletes.push([slug, spec]);
        return Promise.resolve({ kind: 'ok', body: { specs: ['004-retention-policies'], ideas: [] } });
      },
    });
    await settle();
    const toggled = data.toggleFavorite('002-web-console');
    expect(data.isFavorite('002-web-console')).toBe(false);
    expect(await toggled).toBe(true);
    expect(deletes).toEqual([['harbor', '002-web-console']]);
    expect([...data.favoriteIds()]).toEqual(['004-retention-policies']);
  });

  it('reverts to the set before the click and toasts favorites.failed on a 500', async () => {
    const put = deferred();
    const { data, toasts } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      favorites: () => Promise.resolve(ok({ specs: ['002-web-console'], ideas: [] })),
      putFavorite: () => put.promise,
    });
    await settle();
    const toggled = data.toggleFavorite('004-retention-policies');
    expect(data.isFavorite('004-retention-policies')).toBe(true);

    put.resolve({ kind: 'error', status: 500, error: null });
    expect(await toggled).toBe(false);
    TestBed.tick();
    expect([...data.favoriteIds()]).toEqual(['002-web-console']);
    expect(toasts).toEqual(['Could not save the favorite.']);
  });

  it('reverts an unstar the server refuses, keeping a star another click set meanwhile', async () => {
    const removal = deferred();
    const { data, toasts } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      favorites: () => Promise.resolve(ok({ specs: ['002-web-console'], ideas: [] })),
      deleteFavorite: () => removal.promise,
      putFavorite: () => Promise.resolve({ kind: 'ok', body: { specs: ['002-web-console', '007-tide-tables'], ideas: [] } }),
    });
    await settle();
    const unstar = data.toggleFavorite('002-web-console');
    expect(data.isFavorite('002-web-console')).toBe(false);
    expect(await data.toggleFavorite('007-tide-tables')).toBe(true);

    removal.resolve({ kind: 'error', status: 0, error: null });
    expect(await unstar).toBe(false);
    TestBed.tick();
    expect([...data.favoriteIds()].sort()).toEqual(['002-web-console', '007-tide-tables']);
    expect(toasts).toEqual(['Could not save the favorite.']);
  });

  it('sends nothing without a workspace or for an id that is no spec folder', async () => {
    let writes = 0;
    const write = () => {
      writes += 1;
      return Promise.resolve({ kind: 'ok', body: { specs: [], ideas: [] } });
    };
    const { data, ws } = setUp(() => Promise.resolve(ok(model([]))), null, { putFavorite: write, deleteFavorite: write });
    await settle();
    expect(await data.toggleFavorite('004-retention-policies')).toBe(false);
    ws.set('harbor');
    await settle();
    expect(await data.toggleFavorite('004')).toBe(false);
    expect(writes).toBe(0);
    expect([...data.favoriteIds()]).toEqual([]);
  });

  it('drops an answer that lands after the workspace changed', async () => {
    const put = deferred();
    const { data, ws } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      favorites: (slug: string) => Promise.resolve(ok({ specs: slug === 'lantern' ? ['001-lamp'] : [], ideas: [] })),
      putFavorite: () => put.promise,
    });
    await settle();
    const toggled = data.toggleFavorite('004-retention-policies');
    ws.set('lantern');
    await settle();
    put.resolve({ kind: 'ok', body: { specs: ['004-retention-policies'], ideas: [] } });
    expect(await toggled).toBe(true);
    TestBed.tick();
    expect([...data.favoriteIds()]).toEqual(['001-lamp']);
  });

  it('lists the favourite rows in the dashboard\'s row order', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      dashboard,
      favorites: () => Promise.resolve(ok({ specs: ['002-web-console', '007-tide-tables'], ideas: [] })),
    });
    await settle();
    expect(data.favoriteRows().map((entry) => entry.id)).toEqual(['007', '002']);
  });

  it('drops archived and unknown ids, so stale ids alone leave the select empty (ISC-302)', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      dashboard,
      favorites: () => Promise.resolve(ok({ specs: ['001-bootstrap', '009-renamed', '004-retention-policies'], ideas: [] })),
    });
    await settle();
    expect(data.favoriteRows().map((entry) => entry.id)).toEqual(['004']);
    TestBed.resetTestingModule();

    const stale = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      dashboard,
      favorites: () => Promise.resolve(ok({ specs: ['001-bootstrap', '009-renamed'], ideas: [] })),
    });
    await settle();
    expect(stale.data.favoriteIds().size).toBe(2);
    expect(stale.data.favoriteRows()).toEqual([]);
  });

  it('shows a new star in favoriteRows without a reload', async () => {
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      dashboard,
      putFavorite: () => Promise.resolve({ kind: 'ok', body: { specs: ['002-web-console'], ideas: [] } }),
    });
    await settle();
    expect(data.favoriteRows()).toEqual([]);
    const toggled = data.toggleFavorite('002-web-console');
    expect(data.favoriteRows().map((entry) => entry.id)).toEqual(['002']);
    await toggled;
    expect(data.favoriteRows().map((entry) => entry.id)).toEqual(['002']);
  });
});

describe('ShellData idea favourites (spec 064, T53, ISC-497)', () => {
  it('stars an idea at once through PUT, unstars it through DELETE and keeps the spec set', async () => {
    const writes: string[] = [];
    const answer = (ideas: string[]) => Promise.resolve({ kind: 'ok', body: { specs: ['002-web-console'], ideas } });
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      favorites: () => Promise.resolve(ok({ specs: ['002-web-console'], ideas: [] })),
      putIdeaFavorite: (ws: string, slug: string) => (writes.push(`PUT ${ws} ${slug}`), answer([slug])),
      deleteIdeaFavorite: (ws: string, slug: string) => (writes.push(`DELETE ${ws} ${slug}`), answer([])),
    });
    await settle();
    const starred = data.toggleIdeaFavorite('offline-sync');
    expect(data.isIdeaFavorite('offline-sync')).toBe(true);
    expect(await starred).toBe(true);
    expect([...data.favoriteIdeaSlugs()]).toEqual(['offline-sync']);
    expect(await data.toggleIdeaFavorite('offline-sync')).toBe(true);
    expect(data.isIdeaFavorite('offline-sync')).toBe(false);
    expect(writes).toEqual(['PUT harbor offline-sync', 'DELETE harbor offline-sync']);
    expect([...data.favoriteIds()]).toEqual(['002-web-console']);
  });

  it('sends nothing for a slug that is no story slug', async () => {
    const writes: string[] = [];
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', { putIdeaFavorite: () => writes.push('PUT') });
    await settle();
    expect(await data.toggleIdeaFavorite('../x')).toBe(false);
    expect(writes).toEqual([]);
  });

  it('lists the favourite ideas with their dashboard titles, skipping slugs without a story', async () => {
    const list = [{ slug: 'offline-sync', title: 'Offline sync' }, { slug: 'tide-alerts' }, { title: 'No slug' }];
    const { data } = setUp(() => Promise.resolve(ok(model([]))), 'harbor', {
      dashboard: () => Promise.resolve(ok({ specs: [], archive: [], ideas: { list } })),
      favorites: () => Promise.resolve(ok({ specs: [], ideas: ['gone', 'offline-sync', 'tide-alerts'] })),
    });
    await settle();
    expect(data.favoriteIdeas()).toEqual([
      { slug: 'offline-sync', title: 'Offline sync' },
      { slug: 'tide-alerts', title: 'tide-alerts' },
    ]);
  });
});
