import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Favorites } from '../../../../../../server/src/contracts/spec-routes.contract';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ApiClient, type ApiResult, type DashboardBody, type PutResult } from '../../../core/api.service';
import { LockSourceService } from '../../../core/lock-source.service';
import { ToastService } from '../../../shared/ui/toast/toast';
import { ShellData } from '../shell-data.service';
import { ShellState } from '../shell-state.service';
import { favoriteIdeaLink, FavoritesIndex, favoriteSpecLink, type FavoriteGroup } from './favorites-index.service';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const row = (folder: string, title: string, stage = 'build') => ({ id: folder.slice(0, 3), slug: folder, title, stage });

/** Dashboards as core serves them, the fields the index reads: active rows, archived rows and the story list. */
const DASHBOARDS: Readonly<Record<string, DashboardBody>> = {
  harbor: {
    specs: [row('005-alerts', 'Alerts'), row('002-web-console', 'Web console'), row('009-audit', 'Audit')],
    archive: [{ id: '001', slug: '001-bootstrap', title: 'Bootstrap', archived: '2026-09-01' }],
    ideas: { list: [{ slug: 'dark-mode', title: 'Dark mode' }, { slug: 'csv-export', title: '' }] },
  },
  lantern: {
    specs: [row('004-search', 'Search'), row('003-index', 'Index')],
    archive: [],
    ideas: { list: [{ slug: 'fuzzy', title: 'Fuzzy match' }] },
  },
  beacon: { specs: [row('003-uptime', 'Uptime')], archive: [], ideas: { list: [{ slug: 'uptime-badges', title: 'Badges' }] } },
};

/** The stored sets; sorted as the server sorts them, so the dashboard order must win over this one. */
const FAVORITES: Readonly<Record<string, Favorites>> = {
  harbor: { specs: ['002-web-console', '009-audit'], ideas: ['csv-export', 'dark-mode'] },
  lantern: { specs: ['003-index', '004-search'], ideas: ['fuzzy'] },
  beacon: { specs: [], ideas: [] },
};

interface Options {
  readonly open?: string | null;
  readonly list?: ReadonlyArray<{ slug: string; name: string; readable?: boolean }>;
  readonly favorites?: Readonly<Record<string, ApiResult<Favorites>>>;
  readonly dashboards?: Readonly<Record<string, ApiResult<DashboardBody>>>;
  /** A DELETE's answer by workspace; absent, it is ok. */
  readonly deletes?: Readonly<Record<string, () => Promise<PutResult<Favorites>>>>;
}

const LIST = [
  { slug: 'lantern', name: 'Lantern' },
  { slug: 'harbor', name: 'Harbor' },
  { slug: 'beacon', name: 'Beacon' },
];

function setUp(options: Options = {}) {
  const ws = signal<string | null>(options.open === undefined ? 'harbor' : options.open);
  const calls: string[] = [];
  const toggles: string[] = [];
  const toasts: string[] = [];
  const remove = (call: string, slug: string): Promise<PutResult<Favorites>> => {
    calls.push(call);
    return options.deletes?.[slug]?.() ?? Promise.resolve({ kind: 'ok', body: { specs: [], ideas: [] } });
  };
  const api = {
    deleteFavorite: (slug: string, spec: string) => remove(`delete spec ${slug} ${spec}`, slug),
    deleteIdeaFavorite: (slug: string, idea: string) => remove(`delete idea ${slug} ${idea}`, slug),
    favorites: (slug: string): Promise<ApiResult<Favorites>> => {
      calls.push(`favorites ${slug}`);
      return Promise.resolve(options.favorites?.[slug] ?? ok(FAVORITES[slug] ?? { specs: [], ideas: [] }));
    },
    dashboard: (slug: string): Promise<ApiResult<DashboardBody>> => {
      calls.push(`dashboard ${slug}`);
      return Promise.resolve(options.dashboards?.[slug] ?? ok(DASHBOARDS[slug] ?? {}));
    },
  };
  // The open workspace's sets as ShellData derives them (favoriteRows, favoriteIdeas): harbor's, filtered and ordered.
  const openRows = signal([row('002-web-console', 'Web console'), row('009-audit', 'Audit')]);
  const openIdeas = signal([
    { slug: 'dark-mode', title: 'Dark mode' },
    { slug: 'csv-export', title: 'csv-export' },
  ]);
  const data = {
    workspaceList: signal((options.list ?? LIST).map((entry) => ({ readable: true, ...entry }))),
    favoriteRows: computed(() => (ws() === 'harbor' ? openRows() : [])),
    favoriteIdeas: computed(() => (ws() === 'harbor' ? openIdeas() : [])),
    isFavorite: (spec: string) => openRows().some((entry) => entry.slug === spec),
    isIdeaFavorite: (slug: string) => openIdeas().some((idea) => idea.slug === slug),
    toggleFavorite: (spec: string) => {
      toggles.push(`spec ${spec}`);
      openRows.update((rows) => rows.filter((entry) => entry.slug !== spec));
      return Promise.resolve(true);
    },
    toggleIdeaFavorite: (slug: string) => {
      toggles.push(`idea ${slug}`);
      openIdeas.update((ideas) => ideas.filter((idea) => idea.slug !== slug));
      return Promise.resolve(true);
    },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ShellData, useValue: data },
      { provide: ShellState, useValue: { ws } },
      { provide: ToastService, useValue: { show: (message: string) => toasts.push(message) } },
      { provide: TranslocoService, useValue: { translate: (key: string) => key } },
    ],
  });
  return { index: TestBed.inject(FavoritesIndex), calls, toggles, toasts, ws, openRows };
}

/** Every pending answer lands (the fakes resolve on the microtask queue). */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** What a group shows: its head, its spec rows and its idea rows, each with its href. */
const shown = (groups: readonly FavoriteGroup[]) =>
  groups.map((group) => ({
    ws: group.ws,
    name: group.name,
    specs: group.specs.map((spec) => `${spec.id} ${spec.title} ${favoriteSpecLink(group.ws, spec.id).join('/')}`),
    ideas: group.ideas.map((idea) => `${idea.title} ${favoriteIdeaLink(group.ws, idea.slug).join('/')}`),
  }));

const LANTERN = {
  ws: 'lantern',
  name: 'Lantern',
  specs: ['004 Search /w/lantern/s/004', '003 Index /w/lantern/s/003'],
  ideas: ['Fuzzy match /w/lantern/ideas/fuzzy'],
};
const HARBOR = {
  ws: 'harbor',
  name: 'Harbor',
  specs: ['002 Web console /w/harbor/s/002', '009 Audit /w/harbor/s/009'],
  ideas: ['Dark mode /w/harbor/ideas/dark-mode', 'csv-export /w/harbor/ideas/csv-export'],
};

describe('FavoritesIndex (spec 069, ISC-557)', () => {
  it('loads nothing before the select first opens', async () => {
    const { calls } = setUp();
    TestBed.inject(FavoritesIndex);
    await settle();
    expect(calls).toEqual([]);
  });

  it('groups three workspaces: two heads in picker order, rows and hrefs per workspace, none for the third', async () => {
    const { index, calls } = setUp();
    await index.load();
    await settle();
    expect(shown(index.groups())).toEqual([LANTERN, HARBOR]);
    // The open workspace comes from ShellData; only the others are read, favourites and dashboard each.
    expect(calls.sort()).toEqual(['dashboard beacon', 'dashboard lantern', 'favorites beacon', 'favorites lantern']);
    expect(index.groups().some((group) => group.ws === 'beacon')).toBe(false);
    expect(index.loading()).toBe(false);
  });

  it('reads every workspace through the API off a workspace route, in the same order and with the same rows', async () => {
    const { index } = setUp({ open: null });
    await index.load();
    await settle();
    expect(shown(index.groups())).toEqual([LANTERN, HARBOR]);
  });

  it('follows the open workspace reactively and reloads the others on every open', async () => {
    const { index, calls, openRows } = setUp();
    await index.load();
    openRows.set([row('009-audit', 'Audit')]);
    expect(index.groups().find((group) => group.ws === 'harbor')?.specs.map((spec) => spec.id)).toEqual(['009']);
    await index.load();
    expect(calls.filter((call) => call === 'favorites lantern')).toHaveLength(2);
  });
});

describe('FavoritesIndex stale and unreadable (spec 069, ISC-561)', () => {
  const archivedOnly = { harbor: ok<Favorites>({ specs: ['001-bootstrap'], ideas: ['gone-story'] }) };

  it('drops an archived favourite id and an unreadable workspace; the other groups stay', async () => {
    const { index, calls } = setUp({
      open: null,
      list: [...LIST, { slug: 'ghost', name: 'Ghost', readable: false }, { slug: 'broken', name: 'Broken' }],
      favorites: { ...archivedOnly, broken: { kind: 'unavailable', body: {} as never } },
    });
    await index.load();
    await settle();
    expect(shown(index.groups())).toEqual([LANTERN]);
    expect(calls.some((call) => call.endsWith('ghost'))).toBe(false);
  });

  it('skips a workspace whose dashboard does not answer ok', async () => {
    const { index } = setUp({ open: null, dashboards: { lantern: { kind: 'error', status: 500 } } });
    await index.load();
    await settle();
    expect(shown(index.groups())).toEqual([HARBOR]);
  });

  it('is the empty state when nothing but stale and unreadable favourites remain', async () => {
    const { index } = setUp({
      open: null,
      list: [{ slug: 'harbor', name: 'Harbor' }, { slug: 'lantern', name: 'Lantern' }, { slug: 'beacon', name: 'Beacon' }],
      favorites: { ...archivedOnly, lantern: { kind: 'error', status: 0 } },
    });
    await index.load();
    await settle();
    expect(index.groups()).toEqual([]);
  });

  it('keeps the other groups when a read rejects', async () => {
    const { index } = setUp({ open: null });
    TestBed.inject(ApiClient).dashboard = (slug: string) =>
      slug === 'lantern' ? Promise.reject(new Error('offline')) : Promise.resolve(ok(DASHBOARDS[slug] ?? {}));
    await index.load();
    await settle();
    expect(shown(index.groups())).toEqual([HARBOR]);
  });
});

/** The spec ids and story slugs a workspace's group lists; null when it has no group. */
const rowsIn = (index: FavoritesIndex, ws: string) => {
  const group = index.groups().find((entry) => entry.ws === ws);
  return group ? [...group.specs.map((spec) => spec.id), ...group.ideas.map((idea) => idea.slug)] : null;
};

describe('FavoritesIndex.unstar (spec 069, ISC-559)', () => {
  it('sends one DELETE to the row’s own workspace and takes the row out at once; the open set stays', async () => {
    const { index, calls, toggles } = setUp();
    await index.load();
    await settle();
    calls.length = 0;
    const done = index.unstar('lantern', 'specs', '003-index');
    expect(rowsIn(index, 'lantern')).toEqual(['004', 'fuzzy']);
    expect(await done).toBe(true);
    expect(calls).toEqual(['delete spec lantern 003-index']);
    expect(toggles).toEqual([]);
    expect(shown(index.groups())[1]).toEqual(HARBOR);
  });

  it('drops a group with its last favourite and is the empty state after the very last, the open one via ShellData', async () => {
    const { index, calls, toggles } = setUp({ list: [{ slug: 'lantern', name: 'Lantern' }, { slug: 'harbor', name: 'Harbor' }] });
    await index.load();
    await settle();
    calls.length = 0;
    await index.unstar('lantern', 'specs', '004-search');
    await index.unstar('lantern', 'specs', '003-index');
    expect(rowsIn(index, 'lantern')).toEqual(['fuzzy']);
    await index.unstar('lantern', 'ideas', 'fuzzy');
    expect(index.groups().map((group) => group.ws)).toEqual(['harbor']);
    for (const spec of ['002-web-console', '009-audit']) await index.unstar('harbor', 'specs', spec);
    for (const idea of ['dark-mode', 'csv-export']) await index.unstar('harbor', 'ideas', idea);
    expect(index.groups()).toEqual([]);
    expect(calls).toEqual(['delete spec lantern 004-search', 'delete spec lantern 003-index', 'delete idea lantern fuzzy']);
    expect(toggles).toEqual(['spec 002-web-console', 'spec 009-audit', 'idea dark-mode', 'idea csv-export']);
  });

  it('never stars: an open-workspace row that is no favourite any more sends nothing', async () => {
    const { index, toggles } = setUp();
    expect(await index.unstar('harbor', 'specs', '005-alerts')).toBe(false);
    expect(toggles).toEqual([]);
  });

  it('puts the row back at its place and toasts when the DELETE fails or rejects', async () => {
    const failures = [
      () => Promise.resolve<PutResult<Favorites>>({ kind: 'error', status: 500, error: null }),
      () => Promise.reject(new Error('offline')),
    ];
    for (const failure of failures) {
      TestBed.resetTestingModule();
      const { index, toasts } = setUp({ deletes: { lantern: failure } });
      await index.load();
      await settle();
      const done = index.unstar('lantern', 'specs', '004-search');
      expect(rowsIn(index, 'lantern')).toEqual(['003', 'fuzzy']);
      expect(await done).toBe(false);
      expect(shown(index.groups())).toEqual([LANTERN, HARBOR]);
      expect(toasts).toEqual(['favorites.failed']);
    }
  });
});

describe('FavoritesIndex and ShellData share the open set (spec 069, ISC-560)', () => {
  it('lists a star set elsewhere without a reload, and an unstar in the select flips every star', async () => {
    const writes: string[] = [];
    const stored = (specs: string[]) => Promise.resolve<PutResult<Favorites>>({ kind: 'ok', body: { specs, ideas: [] } });
    const api = {
      workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'Harbor', readable: true }])),
      dashboard: () => Promise.resolve(ok(DASHBOARDS['harbor'])),
      spec: () => Promise.resolve({ kind: 'not-found', served: false } as const),
      planning: () => Promise.resolve({ kind: 'error', status: 0 } as const),
      actors: () => Promise.resolve(ok([])),
      boardQuery: () => Promise.resolve(ok({ query: '' })),
      favorites: () => Promise.resolve(ok<Favorites>({ specs: ['002-web-console'], ideas: [] })),
      tech: () => Promise.resolve(ok({ pages: null, specs: [] })),
      putFavorite: (ws: string, spec: string) => (writes.push(`put ${ws} ${spec}`), stored(['002-web-console', '005-alerts'])),
      deleteFavorite: (ws: string, spec: string) => (writes.push(`delete ${ws} ${spec}`), stored(['005-alerts'])),
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' } })],
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ToastService, useValue: { show: () => undefined } },
        { provide: ShellState, useValue: { ws: signal('harbor'), wsPage: signal(null), specId: signal(null) } },
        { provide: LockSourceService, useValue: { connect: () => undefined } },
      ],
    });
    const data = TestBed.inject(ShellData);
    const index = TestBed.inject(FavoritesIndex);
    for (let i = 0; i < 3; i++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(rowsIn(index, 'harbor')).toEqual(['002']);
    const star = data.toggleFavorite('005-alerts');
    expect(rowsIn(index, 'harbor')).toEqual(['005', '002']);
    await star;
    expect(await index.unstar('harbor', 'specs', '002-web-console')).toBe(true);
    expect(data.isFavorite('002-web-console')).toBe(false);
    expect(rowsIn(index, 'harbor')).toEqual(['005']);
    expect(writes).toEqual(['put harbor 005-alerts', 'delete harbor 002-web-console']);
  });
});
