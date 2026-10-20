import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { RefreshService } from '../../core/refresh.service';
import { DetailSelection } from '../../layout/detail-sidebar/selection';
import { RailContent } from '../../layout/shell/rail-content';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { DashboardPage } from './dashboard-page';

/** The dashboard's blocks in the one order every tier shares (spec 058, design.md § Across viewports). */
const BLOCKS = ['app-kpi-band', 'app-brief', 'app-waiting-section', 'app-next-up-list', 'app-warnings-panel'] as const;

/** Harbor's body with its TL;DR fresh or stale (the golden's own brief is stale), or with no TL;DR at all. */
const withBrief = (stale: boolean | null): unknown => ({ ...harbor, brief: stale === null ? null : { ...harbor.brief, stale } });
const fresh = withBrief(false);

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
      provideRouter([{ path: 'w/:ws', component: DashboardPage, data: { page: 'dashboard' } }]),
      {
        provide: ShellData,
        useValue: {
          workspaceMissing: () => false,
          workspaceUnavailable: () => false,
          workspaceList: () => [{ slug: 'harbor', pathTail: 'code/harbor' }],
          dashboard: { value: () => ({ kind: 'ok', body: body() }) },
          planningModel: () => null,
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
  return { root, page };
}

const text = (el: Element | null | undefined): string | undefined => el?.textContent.replace(/\s+/g, ' ').trim();
/** The page's direct children in DOM order, by tag. */
const children = (page: HTMLElement): string[] => [...page.children].map((el) => el.tagName.toLowerCase());
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
      expect(page.querySelector('app-next-up-list')?.getAttribute('data-form')).toBe('card');
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
