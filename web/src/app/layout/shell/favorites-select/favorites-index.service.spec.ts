import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Favorites } from '../../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient, type ApiResult, type DashboardBody } from '../../../core/api.service';
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
}

const LIST = [
  { slug: 'lantern', name: 'Lantern' },
  { slug: 'harbor', name: 'Harbor' },
  { slug: 'beacon', name: 'Beacon' },
];

function setUp(options: Options = {}) {
  const ws = signal<string | null>(options.open === undefined ? 'harbor' : options.open);
  const calls: string[] = [];
  const api = {
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
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ShellData, useValue: data },
      { provide: ShellState, useValue: { ws } },
    ],
  });
  return { index: TestBed.inject(FavoritesIndex), calls, ws, openRows };
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
