import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type CanActivateFn, NavigationStart, provideRouter, type Route, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../core/fixtures/harbor.golden.json';
import type { Relation, RelationIndex, RelationRef } from '../../../../../core/src/relations';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { RefreshService } from '../../layout/shell/refresh.service';
import { DetailSelection } from '../../layout/detail-sidebar/selection';
import { RailContent } from '../../layout/shell/rail-content';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { OpenState } from '../../shared/open-state';
import { DashboardPage } from './dashboard-page';

/**
 * The dashboard's blocks in the one order every tier shares (spec 058, design.md § Across viewports); since spec 064
 * (T17) Waits on you and In progress share the row `[data-lists]`.
 */
const BLOCKS = ['app-kpi-band', 'app-brief', '[data-lists]', 'app-next-up-list', 'app-warnings-panel'] as const;

/** Harbor's body with its TL;DR fresh or stale (the golden's own brief is stale), or with no TL;DR at all. */
const withBrief = (stale: boolean | null): unknown => ({ ...harbor, brief: stale === null ? null : { ...harbor.brief, stale } });
const fresh = withBrief(false);

/** The app's own guards of `w/:ws`: they send a list address on to `/w/:ws/specs`, never `sel` alone (ISC-396, ISC-400). */
const dashboardGuards = (routes.flatMap((route: Route) => route.children ?? []).find((route) => route.path === 'w/:ws')?.canActivate ??
  []) as CanActivateFn[];

/** Stands in for the Specs page, so a redirect of the guard lands on a route of its own. */
@Component({ selector: 'app-specs-stub', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class SpecsStub {}

/** A spec entry in the relation index for each spec harbor's Next up and warnings link to, so the sidebar has an entry. */
const relations = Object.fromEntries(
  ['001', '002', '003', '004', '005', '006'].map((id) => {
    const ref = `spec:${id}` as RelationRef;
    const entry: Relation = { ref, type: 'spec', id, title: id, closed: 0, total: 0, parents: [], children: [], blockers: [] };
    return [ref, entry];
  }),
) as RelationIndex;

/** The dashboard body the stubbed shell data serves; a test may swap it before rendering. */
const body = signal<unknown>(fresh);

beforeEach(() => {
  body.set(fresh);
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([
        { path: 'w/:ws', component: DashboardPage, canActivate: dashboardGuards, data: { page: 'dashboard' } },
        { path: 'w/:ws/specs', component: SpecsStub },
      ]),
      {
        provide: ShellData,
        useValue: {
          workspaceMissing: () => false,
          workspaceUnavailable: () => false,
          workspaceList: () => [{ slug: 'harbor', pathTail: 'code/harbor' }],
          dashboard: { value: () => ({ kind: 'ok', body: body() }) },
          planningModel: () => ({ relations }),
          isFavorite: () => false,
          toggleFavorite: () => Promise.resolve(false),
        },
      },
      { provide: RefreshService, useValue: { changedKpis: signal(new Set()), changedRows: signal(new Set()) } },
    ],
  });
});

async function render(tier: Tier, url = '/w/harbor') {
  TestBed.inject(ShellState).tier.set(tier);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  await harness.fixture.whenStable();
  const root = harness.fixture.nativeElement as HTMLElement;
  const page = root.querySelector('app-dashboard-page') as HTMLElement;
  return { root, page, harness };
}

const text = (el: Element | null | undefined): string | undefined => el?.textContent.replace(/\s+/g, ' ').trim();
/** The page's direct children in DOM order, by tag. */
const children = (page: HTMLElement): string[] =>
  [...page.children].map((el) => (el.hasAttribute('data-lists') ? '[data-lists]' : el.tagName.toLowerCase()));
/** The dashboard blocks among the page's children, in DOM order. */
const blocks = (page: HTMLElement): string[] => children(page).filter((tag) => (BLOCKS as readonly string[]).includes(tag));

describe('DashboardPage on /w/harbor (spec 058, ISC-390, ISC-392)', () => {
  for (const tier of ['compact', 'medium', 'wide'] as const) {
    it(`names Dashboard in the eyebrow and the h1, without a count segment or a waits link, at ${tier}`, async () => {
      const { page } = await render(tier);
      expect(text(page.querySelector('ui-page-head [data-page-eyebrow]'))).toBe('harbor · Dashboard');
      const h1 = page.querySelectorAll('h1');
      expect(h1).toHaveLength(1);
      expect(text(h1[0])).toBe('Dashboard · harbor');
      expect(page.querySelector('[data-waits-link]')).toBeNull();
    });

    it(`stands the five blocks in one column in order, with no spec list, backlog or context rail, at ${tier}`, async () => {
      const { root, page } = await render(tier);
      expect(blocks(page)).toEqual([...BLOCKS]);
      for (const tag of BLOCKS) expect(root.querySelectorAll(tag)).toHaveLength(1);
      const order = children(page);
      expect(order[0]).toBe('ui-page-head');
      expect(order.at(-1)).toBe('p');
      expect(page.lastElementChild?.hasAttribute('data-footer-note')).toBe(true);
      expect(root.querySelector('app-spec-table')).toBeNull();
      expect(root.querySelector('app-ideas-panel')).toBeNull();
      expect(root.querySelector('app-context-rail')).toBeNull();
      // No rail blocks or strip badges are registered (T13).
      const rail = TestBed.inject(RailContent);
      expect([rail.blocks(), rail.badges()]).toEqual([null, null]);
      expect(page.querySelector('app-next-up-list > ui-section-header')).not.toBeNull();
      expect(page.querySelector('app-warnings-panel')?.getAttribute('data-form')).toBe('section');
    });

    it(`keeps a stale TL;DR in second place at ${tier}`, async () => {
      body.set(withBrief(true));
      const { page } = await render(tier);
      expect(blocks(page)).toEqual([...BLOCKS]);
      expect(page.querySelector('app-kpi-band')?.nextElementSibling?.tagName.toLowerCase()).toBe('app-brief');
      expect(page.querySelector('app-brief')?.hasAttribute('data-stale')).toBe(true);
    });
  }

  it('heads Waits on you, Next up and the warnings with h2 under the h1', async () => {
    const { page } = await render('wide');
    expect(text(page.querySelector('app-waiting-section h2'))).toContain('Waits on you');
    expect(page.querySelector('app-waiting-section ui-section-header h3')).toBeNull();
    expect(page.querySelector('app-next-up-list h2')).not.toBeNull();
    expect(page.querySelector('app-warnings-panel h2')).not.toBeNull();
  });

  it('renders no TL;DR card without a brief, the rest in order', async () => {
    body.set(withBrief(null));
    const { page } = await render('medium');
    expect(blocks(page)).toEqual(BLOCKS.filter((tag) => tag !== 'app-brief'));
  });

  it('shows a skeleton where the KPI band and Next up stand while the body is loading', async () => {
    body.set(null);
    const { page } = await render('wide');
    expect(page.querySelector('ui-page-head')).not.toBeNull();
    expect(page.querySelectorAll('ui-skeleton')).toHaveLength(2);
    expect(page.querySelector('[data-skeleton="kpi-band"]')).not.toBeNull();
    expect(page.querySelector('[data-skeleton="next-up"]')).not.toBeNull();
    for (const tag of BLOCKS) expect(page.querySelector(tag)).toBeNull();
  });

  it('never docks the detail sidebar', async () => {
    const dock = vi.spyOn(DetailSelection.prototype, 'dock');
    await render('wide');
    expect(dock).not.toHaveBeenCalled();
    dock.mockRestore();
  });
});

/** The non-docked presentation of each tier (design.md § Across viewports). */
const FLOATING = { compact: 'sheet', medium: 'overlay', wide: 'floating' } as const;

describe('DashboardPage keeps its own selection on /w/harbor (spec 058, ISC-400)', () => {
  /** Every navigation the router starts from here on, by URL. */
  function navigations(): string[] {
    const urls: string[] = [];
    TestBed.inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) urls.push(event.url);
    });
    return urls;
  }

  for (const tier of ['compact', 'medium', 'wide'] as const) {
    for (const [name, selector] of [
      ['a Next up link', 'app-next-up-list a[data-next-link]'],
      ['a warnings link', 'app-warnings-panel a[data-warning-link]'],
    ] as const) {
      it(`sets ?sel=spec:<id> from ${name} and stays on /w/harbor, the sidebar ${FLOATING[tier]}, at ${tier}`, async () => {
        const { page, harness } = await render(tier);
        // Spec 064 (T32, T33): the warnings start folded; opening them writes `?open=warnings`, which the links keep.
        page.querySelector<HTMLButtonElement>('app-warnings-panel [data-warnings-toggle]')?.click();
        await harness.fixture.whenStable();
        const link = page.querySelector<HTMLAnchorElement>(selector);
        expect(link).not.toBeNull();
        const href = link?.getAttribute('href');
        expect(href).toMatch(/^\/w\/harbor\?open=warnings&sel=spec:\d{3}$/);
        const urls = navigations();
        link?.click();
        await harness.fixture.whenStable();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe(href);
        expect(urls).toEqual([href]);
        expect(TestBed.inject(DetailSelection).presentation()).toBe(FLOATING[tier]);
        expect(TestBed.inject(DetailSelection).docked()).toBe(false);
      });
    }

    it(`stays on /w/harbor?sel=spec:002 when the address holds it, the sidebar ${FLOATING[tier]}, at ${tier}`, async () => {
      const urls = navigations();
      const { root } = await render(tier, '/w/harbor?sel=spec:002');
      expect(TestBed.inject(Router).url).toBe('/w/harbor?sel=spec:002');
      expect(urls).toEqual(['/w/harbor?sel=spec:002']);
      expect(root.querySelector('app-dashboard-page')).not.toBeNull();
      expect(root.querySelector('app-specs-stub')).toBeNull();
      expect(TestBed.inject(DetailSelection).presentation()).toBe(FLOATING[tier]);
    });
  }

  it('still sends a list address on to /w/harbor/specs, sel included (the guard is the real one)', async () => {
    const { root } = await render('wide', '/w/harbor?phase=fog&sel=spec:002');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/specs?phase=fog&sel=spec:002');
    expect(root.querySelector('app-specs-stub')).not.toBeNull();
  });
});

/** A held claim on `id` as core's row carries it (`taken`, held locks only). */
const LOCK = { id: 'ISC-74', session: 'a:claude:sess-2', since: '2026-10-21T09:00:00Z', source: 'activity' };
const withTaken = (id: string): unknown => ({
  ...(fresh as typeof harbor),
  specs: harbor.specs.map((row) => (row.id === id ? { ...row, taken: [LOCK] } : row)),
});

// Spec 064 (T17, ISC-460, ISC-462): Waits on you and In progress share one row `.lists` after the TL;DR, before Next up.
describe('DashboardPage lists row on /w/harbor (spec 064, ISC-460)', () => {
  it('holds the waits section and an In progress block with one tile for the held spec 002', async () => {
    body.set(withTaken('002'));
    const { page } = await render('wide');
    const lists = page.querySelector('[data-lists]') as HTMLElement;
    expect(lists).not.toBeNull();
    expect(lists.previousElementSibling?.tagName.toLowerCase()).toBe('app-brief');
    expect(lists.nextElementSibling?.tagName.toLowerCase()).toBe('app-next-up-list');
    expect([...lists.children].map((el) => el.tagName.toLowerCase())).toEqual(['app-waiting-section', 'ui-working-block']);
    expect(text(lists.querySelector('ui-working-block h2#working-heading'))).toContain('In progress');
    const tiles = lists.querySelectorAll('ui-working-block ui-flat-tile');
    expect(tiles).toHaveLength(1);
    expect(text(tiles[0].querySelector('[data-id]'))).toBe('002');
    expect(text(tiles[0].querySelector('[data-title]'))).toBe(harbor.specs.find((row) => row.id === '002')?.title);
    expect(text(tiles[0].querySelector('[data-agent]'))).toBe(LOCK.session);
    expect(tiles[0].querySelector('ui-agent-dot')).not.toBeNull();
    expect(tiles[0].querySelector('a')?.getAttribute('href')).toBe('/w/harbor/s/002');
  });

  it('renders no In progress block and no working heading without a held claim', async () => {
    const { page } = await render('wide');
    const lists = page.querySelector('[data-lists]') as HTMLElement;
    expect(lists.querySelector('app-waiting-section')).not.toBeNull();
    expect(lists.querySelector('ui-working-block')).toBeNull();
    expect(page.querySelector('#working-heading')).toBeNull();
  });
});

// Spec 064 (T33, ISC-473 to ISC-475): the warnings' fold is the key `warnings` of `?open=`, as the TL;DR's is `tldr`.
describe('DashboardPage warnings fold in ?open= (spec 064, ISC-473)', () => {
  const toggleOf = (page: HTMLElement) => page.querySelector('h2#warnings > button[data-warnings-toggle]') as HTMLButtonElement;
  const settle = async (harness: RouterTestingHarness): Promise<void> => {
    await harness.fixture.whenStable();
    await harness.fixture.whenStable();
  };

  it('stands closed without the key; a click sets ?open=warnings, a second click removes it', async () => {
    const { page, harness } = await render('wide');
    expect(toggleOf(page).getAttribute('aria-expanded')).toBe('false');
    expect(page.querySelector('[data-warning-spec]')).toBeNull();
    toggleOf(page).click();
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/w/harbor?open=warnings');
    expect(toggleOf(page).getAttribute('aria-expanded')).toBe('true');
    expect(page.querySelector('[data-warning-spec]')).not.toBeNull();
    toggleOf(page).click();
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/w/harbor');
    expect(toggleOf(page).getAttribute('aria-expanded')).toBe('false');
  });

  it('opens from ?open=tldr,warnings next to the TL;DR, and closing keeps tldr', async () => {
    const { page, harness } = await render('wide', '/w/harbor?open=tldr,warnings');
    expect(toggleOf(page).getAttribute('aria-expanded')).toBe('true');
    expect(TestBed.inject(OpenState).isOpen('tldr')).toBe(true);
    toggleOf(page).click();
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/w/harbor?open=tldr');
    expect(toggleOf(page).getAttribute('aria-expanded')).toBe('false');
  });

  it('arrives on #warnings open, with h2#warnings focused', async () => {
    const { page, harness } = await render('wide', '/w/harbor?open=warnings#warnings');
    await settle(harness);
    expect(toggleOf(page).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(page.querySelector('h2#warnings'));
  });

  it('arriving on #warnings alone opens the fold and writes the key', async () => {
    const { page, harness } = await render('wide', '/w/harbor#warnings');
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/w/harbor?open=warnings#warnings');
    expect(toggleOf(page).getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(page.querySelector('h2#warnings'));
  });
});
