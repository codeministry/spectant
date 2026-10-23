import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { Favorites } from '../../../../../../server/src/contracts/spec-routes.contract';
import de from '../../../../i18n/de.json';
import en from '../../../../i18n/en.json';
import { ApiClient, type ApiResult, type DashboardBody } from '../../../core/api.service';
import { SettingsService } from '../../../core/settings.service';
import { ShellData } from '../shell-data.service';
import { ShellState } from '../shell-state.service';
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
};

const FAVORITES: Readonly<Record<string, Favorites>> = {
  lantern: { specs: ['003-index', '004-search'], ideas: ['fuzzy'] },
  beacon: { specs: [], ideas: [] },
};

interface Options {
  readonly lang?: Lang;
  readonly tier?: Tier;
  /** No favourite anywhere: the open workspace's sets empty and every other answer empty. */
  readonly none?: boolean;
}

/** The select with the real `FavoritesIndex` over stubbed answers: lantern, harbor (open) and beacon, in picker order. */
async function mount(options: Options = {}) {
  const calls: string[] = [];
  const api = {
    favorites: (slug: string): Promise<ApiResult<Favorites>> => {
      calls.push(`favorites ${slug}`);
      return Promise.resolve(ok(options.none ? { specs: [], ideas: [] } : (FAVORITES[slug] ?? { specs: [], ideas: [] })));
    },
    dashboard: (slug: string): Promise<ApiResult<DashboardBody>> => Promise.resolve(ok(DASHBOARDS[slug] ?? {})),
  };
  const ws = signal<string | null>('harbor');
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
      { provide: ShellState, useValue: { ws, specId: signal<string | null>(null), tier: signal<Tier>(options.tier ?? 'wide') } },
      { provide: SettingsService, useValue: { settings: signal({ singleKeyShortcuts: true }) } },
    ],
  });
  const fixture = TestBed.createComponent(FavoritesSelect);
  document.body.appendChild(fixture.nativeElement as HTMLElement);
  await fixture.whenStable();
  const stable = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await fixture.whenStable();
  };
  return { root: fixture.nativeElement as HTMLElement, select: fixture.componentInstance, stable, calls };
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
    expect(nav.textContent).not.toContain(en.shell.spec.overview);
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
      expect(nav?.textContent).not.toContain(catalogue.shell.spec.overview);
    });
  }
});
