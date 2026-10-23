import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { Favorites } from '../../../../../../server/src/contracts/spec-routes.contract';
import de from '../../../../i18n/de.json';
import en from '../../../../i18n/en.json';
import { ApiClient, type ApiResult, type DashboardBody } from '../../../core/api.service';
import { SettingsService } from '../../../core/settings.service';
import { ShellData } from '../shell-data.service';
import { ShellState } from '../shell-state.service';
import { isTabId, type TabId } from '../areas';
import type { Tier } from '../tier';
import { FavoritesSelect } from './favorites-select';

type Lang = 'en' | 'de';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const row = (folder: string, title: string, stage = 'build') => ({ id: folder.slice(0, 3), slug: folder, title, stage, type: null });

/** The other workspaces as their answers give them (the open one, harbor, comes from ShellData). */
const DASHBOARDS: Readonly<Record<string, DashboardBody>> = {
  lantern: {
    specs: [row('004-search', 'Search', 'plan'), row('003-index', 'Index')],
    archive: [],
    ideas: { list: [{ slug: 'fuzzy', title: 'Fuzzy match' }] },
  },
  beacon: { specs: [row('003-uptime', 'Uptime')], archive: [], ideas: { list: [{ slug: 'uptime-badges', title: 'Badges' }] } },
  // Read only off harbor (on `/`): while harbor is open its sets come from ShellData.
  harbor: {
    specs: [row('002-web-console', 'Web console'), row('009-audit', 'Audit', 'done')],
    archive: [],
    ideas: { list: [{ slug: 'dark-mode', title: 'Dark mode' }] },
  },
};

const FAVORITES: Readonly<Record<string, Favorites>> = {
  lantern: { specs: ['003-index', '004-search'], ideas: ['fuzzy'] },
  beacon: { specs: [], ideas: [] },
  harbor: { specs: ['002-web-console', '009-audit'], ideas: ['dark-mode'] },
};

/** The route `ShellState` reads off `url`, as its `readRoute` does: `/w/<ws>/s/<id>/<tab>…`; `/` names nothing. */
function routeOf(url: string): { ws: string | null; specId: string | null; tab: TabId | null } {
  const [ws = null, , specId = null, tab = null] = new URL(url, 'http://x').pathname.split('/').slice(2);
  return { ws, specId, tab: isTabId(tab) ? tab : null };
}

interface Options {
  readonly lang?: Lang;
  readonly tier?: Tier;
  /** No favourite anywhere: the open workspace's sets empty and every other answer empty. */
  readonly none?: boolean;
  /** The open spec (`/w/harbor/s/<id>`); none by default. */
  readonly specId?: string;
  /** The other workspaces answer after a timer, as over the network: after the list has opened. */
  readonly slow?: boolean;
  /** The page the select sits on: the router starts there and `ShellState` reads its workspace, spec and tab. */
  readonly url?: string;
}

/** The select with the real `FavoritesIndex` over stubbed answers: lantern, harbor (open) and beacon, in picker order. */
async function mount(options: Options = {}) {
  const calls: string[] = [];
  const later = <T>(value: T): Promise<T> =>
    options.slow ? new Promise((resolve) => setTimeout(() => resolve(value), 20)) : Promise.resolve(value);
  const written = () => Promise.resolve({ kind: 'ok' as const, body: { specs: [], ideas: [] } });
  const api = {
    favorites: (slug: string): Promise<ApiResult<Favorites>> => {
      calls.push(`favorites ${slug}`);
      return later(ok(options.none ? { specs: [], ideas: [] } : (FAVORITES[slug] ?? { specs: [], ideas: [] })));
    },
    dashboard: (slug: string): Promise<ApiResult<DashboardBody>> => later(ok(DASHBOARDS[slug] ?? {})),
    deleteFavorite: (slug: string, spec: string) => {
      calls.push(`DELETE ${slug} spec ${spec}`);
      return written();
    },
    deleteIdeaFavorite: (slug: string, idea: string) => {
      calls.push(`DELETE ${slug} idea ${idea}`);
      return written();
    },
  };
  const route = options.url === undefined ? { ws: 'harbor', specId: options.specId ?? null, tab: null } : routeOf(options.url);
  const ws = signal<string | null>(route.ws);
  const openRows = signal(options.none ? [] : [row('002-web-console', 'Web console'), row('009-audit', 'Audit', 'done')]);
  const openIdeas = signal(options.none ? [] : [{ slug: 'dark-mode', title: 'Dark mode' }]);
  const data = {
    workspaceList: signal(
      [
        { slug: 'lantern', name: 'Lantern' },
        { slug: 'harbor', name: 'Harbor' },
        { slug: 'beacon', name: 'Beacon' },
      ].map((entry) => ({ readable: true, ...entry })),
    ),
    favoriteRows: computed(() => (ws() === 'harbor' ? openRows() : [])),
    favoriteIdeas: computed(() => (ws() === 'harbor' ? openIdeas() : [])),
    isFavorite: (folder: string) => openRows().some((entry) => entry.slug === folder),
    isIdeaFavorite: (slug: string) => openIdeas().some((idea) => idea.slug === slug),
    toggleFavorite: (folder: string) => {
      calls.push(`toggle harbor spec ${folder}`);
      openRows.update((rows) => rows.filter((entry) => entry.slug !== folder));
      return Promise.resolve(true);
    },
    toggleIdeaFavorite: (slug: string) => {
      calls.push(`toggle harbor idea ${slug}`);
      openIdeas.update((ideas) => ideas.filter((idea) => idea.slug !== slug));
      return Promise.resolve(true);
    },
  };
  const lang = options.lang ?? 'en';
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: { en, de },
        translocoConfig: { availableLangs: ['en', 'de'], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: ApiClient, useValue: api },
      { provide: ShellData, useValue: data },
      {
        provide: ShellState,
        useValue: { ws, specId: signal(route.specId), tab: signal(route.tab), tier: signal<Tier>(options.tier ?? 'wide') },
      },
      { provide: SettingsService, useValue: { settings: signal({ singleKeyShortcuts: true }) } },
    ],
  });
  if (options.url !== undefined) await TestBed.inject(Router).navigateByUrl(options.url);
  const fixture = TestBed.createComponent(FavoritesSelect);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const stable = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await fixture.whenStable();
  };
  return { root: fixture.nativeElement as HTMLElement, select: fixture.componentInstance, stable, calls, router: TestBed.inject(Router) };
}

const trigger = (root: Element): HTMLButtonElement => {
  const button = root.querySelector<HTMLButtonElement>('button[data-control="favorites"]');
  if (button === null) throw new Error('no favorites trigger');
  return button;
};

/** jsdom has neither the popover API nor `showModal()`; both stubbed the way a browser behaves. */
function stubOverlays(): () => void {
  const html = HTMLElement.prototype as unknown as Record<string, unknown>;
  const dialog = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  html['showPopover'] = vi.fn();
  html['hidePopover'] = vi.fn();
  dialog['showModal'] = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  dialog['close'] = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  return () => {
    delete html['showPopover'];
    delete html['hidePopover'];
    delete dialog['showModal'];
    delete dialog['close'];
  };
}

let restore: () => void = () => undefined;
beforeEach(() => {
  restore = stubOverlays();
});
afterEach(() => {
  restore();
  document.body.innerHTML = '';
});

const CATALOGUES: ReadonlyArray<readonly [Lang, string]> = [
  ['en', en.shell.favorites.trigger],
  ['de', de.shell.favorites.trigger],
];

describe('FavoritesSelect trigger (spec 069, ISC-553)', () => {
  for (const [lang, name] of CATALOGUES) {
    it(`${lang}: shows only the star, named from the catalogue, aria-expanded false closed and true open`, async () => {
      const { root, select, stable } = await mount({ lang });
      const button = trigger(root);

      expect(name.length).toBeGreaterThan(0);
      expect(button.textContent.trim()).toBe('');
      const icons = button.querySelectorAll('ui-icon');
      expect(icons.length).toBe(1);
      expect(icons.item(0).getAttribute('data-icon')).toBe('star');
      expect(button.getAttribute('aria-label')).toBe(name);
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(select.open()).toBe(false);

      button.click();
      await stable();
      expect(select.open()).toBe(true);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      expect(button.textContent.trim()).toBe('');
      expect(select.anchor()).toBe(button);

      button.click();
      await stable();
      expect(button.getAttribute('aria-expanded')).toBe('false');
    });
  }

  it('the two catalogues name the trigger differently (en "Favorites", de formal)', () => {
    expect(en.shell.favorites.trigger).not.toBe(de.shell.favorites.trigger);
  });
});

/** A group as the list shows it: its head's name, then every row link's href in DOM order. */
const groupsOf = (nav: Element) =>
  [...nav.querySelectorAll<HTMLElement>('[data-favorites-group]')].map((group) => ({
    ws: group.getAttribute('data-favorites-group'),
    head: group.querySelector('.menu-head .entry-name')?.textContent.trim(),
    badge: group.querySelector('.menu-head ui-ws-badge') !== null,
    rows: [...group.querySelectorAll<HTMLAnchorElement>('a.picker-entry')].map(
      (link) => `${link.hasAttribute('data-spec') ? 'spec' : 'idea'} ${link.getAttribute('href') ?? ''}`,
    ),
  }));

const EXPECTED = [
  {
    ws: 'lantern',
    head: 'Lantern',
    badge: true,
    rows: ['spec /w/lantern/s/004', 'spec /w/lantern/s/003', 'idea /w/lantern/ideas/fuzzy'],
  },
  {
    ws: 'harbor',
    head: 'Harbor',
    badge: true,
    rows: ['spec /w/harbor/s/002', 'spec /w/harbor/s/009', 'idea /w/harbor/ideas/dark-mode'],
  },
];

describe('FavoritesSelect list (spec 069, ISC-557)', () => {
  it('lists three workspaces in a popover: two heads in picker order, hrefs per workspace, ideas under the specs, no head for the third', async () => {
    const { root, stable, calls } = await mount();
    trigger(root).click();
    await stable();
    const nav = root.querySelector('ui-popover nav[data-picker="favorites"]');
    expect(nav).not.toBeNull();
    if (nav === null) return;
    expect(groupsOf(nav)).toEqual(EXPECTED);
    expect(nav.querySelector('[data-favorites-group="beacon"]')).toBeNull();
    expect(nav.textContent).not.toContain('Beacon');
    // Each spec row: ID, title, stage chip and a pressed star; a hairline before the ideas.
    const first = nav.querySelector('[data-favorites-group="lantern"] a[data-spec="004"]');
    expect(first?.querySelector('.entry-id')?.textContent.trim()).toBe('004');
    expect(first?.querySelector('.entry-name')?.textContent.trim()).toBe('Search');
    expect(first?.querySelector('ui-chip')?.textContent.trim()).toBe(en.stages.plan);
    expect(nav.querySelectorAll('[data-favorites-group="lantern"] [data-star][aria-pressed="true"]')).toHaveLength(3);
    expect(nav.querySelectorAll('[data-favorites-group] .picker-sep')).toHaveLength(2);
    // No "Spec overview" link, and no empty state while favourites are listed.
    expect(nav.querySelector('a[href$="/specs"]')).toBeNull();
    expect(nav.querySelector('.picker-all')).toBeNull();
    expect(nav.querySelector('.picker-empty')).toBeNull();
    expect(calls.filter((call) => call === 'favorites lantern')).toHaveLength(1);
  });

  it('reloads the index on every open and closes on a row click', async () => {
    const { root, select, stable, calls } = await mount();
    trigger(root).click();
    await stable();
    root.querySelector<HTMLAnchorElement>('ui-popover a[data-spec="003"]')?.click();
    await stable();
    expect(select.open()).toBe(false);
    trigger(root).click();
    await stable();
    expect(calls.filter((call) => call === 'favorites lantern')).toHaveLength(2);
  });

  it('lists the same groups in the compact bottom sheet', async () => {
    const { root, stable } = await mount({ tier: 'compact' });
    trigger(root).click();
    await stable();
    expect(root.querySelector('ui-popover')).toBeNull();
    const nav = root.querySelector('ui-sheet[data-tier="compact"] dialog[open] nav[data-picker="favorites"]');
    expect(nav).not.toBeNull();
    if (nav !== null) expect(groupsOf(nav)).toEqual(EXPECTED);
  });

  for (const [lang, catalogue] of [
    ['en', en],
    ['de', de],
  ] as const) {
    it(`${lang}: shows the empty state without any favourite, and no head`, async () => {
      const { root, stable } = await mount({ lang, none: true });
      trigger(root).click();
      await stable();
      const nav = root.querySelector('nav[data-picker="favorites"]');
      expect(nav?.querySelector('.picker-empty')?.textContent.trim()).toBe(catalogue.shell.favorites.empty);
      expect(nav?.querySelectorAll('[data-favorites-group]')).toHaveLength(0);
      expect(nav?.querySelector('a[href$="/specs"]')).toBeNull();
    });
  }
});

/** The answers of a `slow` mount are in: past their timer, and rendered. */
const answered = async (stable: () => Promise<void>): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  await stable();
};

const rowOf = (root: Element, ws: string, id: string) =>
  root.querySelector<HTMLAnchorElement>(`[data-favorites-group="${ws}"] a[data-spec="${id}"]`);

describe('FavoritesSelect open spec (spec 069, ISC-562)', () => {
  for (const slow of [false, true]) {
    const when = slow ? 'answers after the open' : 'answers at once';
    it(`${when}: on /w/harbor/s/002, starred, 002 carries aria-current and the focus, no check`, async () => {
      const { root, stable } = await mount({ specId: '002', slow });
      trigger(root).click();
      await stable();
      if (slow) await answered(stable);
      const open = rowOf(root, 'harbor', '002');
      expect(open?.getAttribute('aria-current')).toBe('true');
      expect(open?.hasAttribute('data-autofocus')).toBe(true);
      expect(document.activeElement).toBe(open);
      expect(root.querySelectorAll('[aria-current]')).toHaveLength(1);
      expect(root.querySelectorAll('.entry-check')).toHaveLength(0);
      expect(root.querySelectorAll('[data-autofocus]')).toHaveLength(1);
    });

    for (const specId of ['005', '003']) {
      it(`${when}: on /w/harbor/s/${specId}, no favourite there, no row is current and the first row has the focus`, async () => {
        const { root, stable } = await mount({ specId, slow });
        trigger(root).click();
        await stable();
        if (slow) await answered(stable);
        // 003 is a favourite of lantern, not of the open harbor: the same id in another workspace is not current.
        expect(rowOf(root, 'lantern', '003')).not.toBeNull();
        expect(root.querySelectorAll('[aria-current]')).toHaveLength(0);
        const first = root.querySelector<HTMLAnchorElement>('nav[data-picker="favorites"] a.picker-entry');
        expect(first).toBe(rowOf(root, 'lantern', '004'));
        expect(first?.hasAttribute('data-autofocus')).toBe(true);
        expect(root.querySelectorAll('[data-autofocus]')).toHaveLength(1);
        expect(document.activeElement).toBe(first);
      });
    }
  }
});

const starOf = (root: Element, ws: string, key: string) =>
  root.querySelector<HTMLButtonElement>(`[data-favorites-group="${ws}"] button[data-star="${key}"]`);

const writes = (calls: readonly string[]) => calls.filter((call) => call.startsWith('DELETE') || call.startsWith('toggle'));

describe('FavoritesSelect row star (spec 069, ISC-559)', () => {
  it('unsets a favourite of a non-open workspace in place: one DELETE, no navigation, the select stays open', async () => {
    const { root, select, stable, calls, router } = await mount({ specId: '002' });
    trigger(root).click();
    await stable();
    const url = router.url;

    starOf(root, 'lantern', '004')?.click();
    await stable();
    expect(writes(calls)).toEqual(['DELETE lantern spec 004-search']);
    expect(select.open()).toBe(true);
    expect(rowOf(root, 'lantern', '004')).toBeNull();
    expect(rowOf(root, 'harbor', '002')).not.toBeNull();
    // Focus moves to the star of the row that moved up, and the removal is announced.
    expect(document.activeElement).toBe(starOf(root, 'lantern', '003'));
    expect(root.querySelector('[data-favorites-announcer]')?.textContent.trim()).toBe(en.favorites.removed.replace('{{id}}', '004'));

    starOf(root, 'lantern', '003')?.click();
    await stable();
    starOf(root, 'lantern', 'idea:fuzzy')?.click();
    await stable();
    expect(writes(calls)).toEqual(['DELETE lantern spec 004-search', 'DELETE lantern spec 003-index', 'DELETE lantern idea fuzzy']);
    // The last favourite of lantern gone: its head goes with it, and focus moves on to harbor's first star.
    expect(root.querySelector('[data-favorites-group="lantern"]')).toBeNull();
    expect(root.querySelector('nav[data-picker="favorites"]')?.textContent).not.toContain('Lantern');
    expect(document.activeElement).toBe(starOf(root, 'harbor', '002'));
    expect(select.open()).toBe(true);
    expect(router.url).toBe(url);
  });

  it('the last favourite overall leaves the empty state while the select stays open', async () => {
    const { root, select, stable, calls, router } = await mount();
    trigger(root).click();
    await stable();
    const url = router.url;
    for (let i = 0; i < 6; i++) {
      root.querySelector<HTMLButtonElement>('nav[data-picker="favorites"] button[data-star]')?.click();
      await stable();
    }
    expect(writes(calls)).toEqual([
      'DELETE lantern spec 004-search',
      'DELETE lantern spec 003-index',
      'DELETE lantern idea fuzzy',
      'toggle harbor spec 002-web-console',
      'toggle harbor spec 009-audit',
      'toggle harbor idea dark-mode',
    ]);
    const nav = root.querySelector('nav[data-picker="favorites"]');
    expect(nav?.querySelectorAll('[data-favorites-group]')).toHaveLength(0);
    const empty = nav?.querySelector<HTMLElement>('.picker-empty');
    expect(empty?.textContent.trim()).toBe(en.shell.favorites.empty);
    expect(document.activeElement).toBe(empty);
    expect(select.open()).toBe(true);
    expect(router.url).toBe(url);
  });
});

describe('FavoritesSelect keeps the open tab (spec 069, ISC-566; spec 051, ISC-291 to ISC-295)', () => {
  /** The page the select is opened on, and the tab its spec rows lead to ('' is the new spec's dashboard). */
  const PAGES = [
    ['/w/harbor/s/002/timeline', 'timeline'],
    // The note editor gives the new spec's note list; the old spec's query and fragment never go along (ISC-293).
    ['/w/harbor/s/002/notes/n-7f3a?doc=plan#claim-ISC-74', 'notes'],
    // The spec dashboard and a page without an open spec lead to the chosen spec's dashboard (ISC-292).
    ['/w/harbor/s/002', ''],
    ['/', ''],
  ] as const;
  /** A row of the open workspace and two of another one. */
  const ROWS = [
    ['harbor', '009'],
    ['lantern', '004'],
    ['lantern', '003'],
  ] as const;
  const CASES = PAGES.flatMap(([url, tab]) => ROWS.map(([ws, id]) => [url, ws, id, tab] as const));
  /** The path, query and fragment an href names, resolved against the base href as the browser would. */
  const resolved = (href: string | null): string => {
    const url = new URL(href ?? '', document.baseURI);
    return url.pathname + url.search + url.hash;
  };

  it.each(CASES)('on %s the row %s/%s leads to its tab %j, href and click alike', async (url, ws, id, tab) => {
    const target = tab === '' ? `/w/${ws}/s/${id}` : `/w/${ws}/s/${id}/${tab}`;
    const { root, select, stable, router } = await mount({ url });
    expect(router.url).toBe(url);
    trigger(root).click();
    await stable();
    const entry = rowOf(root, ws, id);
    if (entry === null) throw new Error(`row ${ws}/${id} missing on ${url}`);
    expect(entry.getAttribute('href')).toBe(target);

    entry.click();
    await stable();
    // ISC-295: the click lands where the href points, with no query and no fragment of the old page.
    expect(router.url).toBe(target);
    expect(router.url).toBe(resolved(entry.getAttribute('href')));
    expect(select.open()).toBe(false);
  });
});
