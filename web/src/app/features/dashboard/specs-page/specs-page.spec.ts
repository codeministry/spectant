import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { RefreshService } from '../../../layout/shell/refresh.service';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { SpecsPage } from './specs-page';

/** The dashboard's own blocks, none of which belongs on the Specs page (spec 058, ISC-391). */
const DASHBOARD_BLOCKS = ['app-kpi-band', 'app-brief', 'app-waiting-section', 'app-next-up-list', 'app-warnings-panel', 'app-context-rail'];

const missing = signal(false);
/** The body the page reads; harbor's golden unless a test swaps it. */
const body = signal<unknown>(harbor);

/**
 * Harbor with a lock on 002 and 005 (spec 064, T5, ISC-465): the golden's rows carry `taken: []`, the activity locks
 * reach them only through the live source, so the test gives two rows a holder as core's `taken` would.
 */
const WORKING = ['002', '005'];
const harborWorking = {
  ...harbor,
  specs: harbor.specs.map((spec) =>
    WORKING.includes(spec.id) ? { ...spec, taken: [{ id: 'ISC-1', session: `a:claude:sess-${spec.id}`, since: '2026-10-21T09:00:00Z', source: 'activity' }] } : spec,
  ),
};

beforeEach(() => {
  missing.set(false);
  body.set(harbor);
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: 'w/:ws/specs', component: SpecsPage, data: { page: 'specs' } }]),
      {
        provide: ShellData,
        useValue: {
          workspaceMissing: () => missing(),
          workspaceUnavailable: () => false,
          workspaceList: () => [{ slug: 'harbor', pathTail: 'code/harbor' }],
          // The not-found page names the workspace and, on a spec route, the nearest specs.
          workspaceName: (slug: string) => slug,
          specMissing: () => false,
          specRows: () => [],
          dashboard: { value: () => ({ kind: 'ok', body: body() }) },
          isFavorite: () => false,
          toggleFavorite: () => Promise.resolve(false),
        },
      },
      { provide: RefreshService, useValue: { changedKpis: signal(new Set()), changedRows: signal(new Set()) } },
    ],
  });
});

async function render(url: string) {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  const root = harness.routeNativeElement as HTMLElement;
  return { harness, root };
}

/** The spec ids the list shows, once each, sorted. */
const rowIds = (root: HTMLElement): string[] => [...new Set([...root.querySelectorAll('[data-spec-row]')].map((el) => el.getAttribute('data-spec-row') ?? ''))].sort();
const text = (el: Element | null | undefined): string | undefined => el?.textContent.replace(/\s+/g, ' ').trim();

describe('SpecsPage (spec 058, T6, ISC-391)', () => {
  it('names Specs with the active and archived counts in the eyebrow, and "Specs · <ws>" in the h1', async () => {
    const { root } = await render('/w/harbor/specs');
    expect(text(root.querySelector('ui-page-head [data-page-eyebrow]'))).toBe(`harbor · Specs · ${String(harbor.specs.length)} active · ${String(harbor.kpis.archived)} archived`);
    expect(text(root.querySelector('ui-page-head h1'))).toBe('Specs · harbor');
    expect(root.querySelector('ui-page-head ui-ws-badge.page-mark')).not.toBeNull();
    expect(root.querySelector('[data-waits-link]')).toBeNull();
  });

  it('lists the specs filtered by ?phase=building, then the backlog and the footnote, and no dashboard block', async () => {
    const { root } = await render('/w/harbor/specs?phase=building');
    const building = harbor.specs.filter((spec) => spec.stageGroup === 'building').map((spec) => spec.id);
    expect(building.length).toBeGreaterThan(0);
    expect(building.length).toBeLessThan(harbor.specs.length);
    expect(rowIds(root)).toEqual(building.sort());
    expect([...root.children].map((el) => el.tagName.toLowerCase())).toEqual(['ui-page-head', 'app-spec-table', 'p']);
    expect(root.querySelector('p.footer-note')?.textContent).toContain('code/harbor');
    for (const block of DASHBOARD_BLOCKS) expect(root.querySelector(block), block).toBeNull();
  });

  it('lists the stories as the idea group of the spec list, linked to their pages, and no ideas panel (spec 064, T42, ISC-479)', async () => {
    const { root } = await render('/w/harbor/specs');
    const group = root.querySelector('app-spec-table [data-ideas-group]');
    expect(group).not.toBeNull();
    expect(text(group?.querySelector('[data-ideas-count]'))).toBe(`${String(harbor.ideas.list.length)} ideas`);
    const hrefs = [...(group?.querySelectorAll('app-idea-row a.link') ?? [])].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(harbor.ideas.list.map((idea) => `/w/harbor/ideas/${idea.slug}`));
    expect(root.querySelector('[data-ideas]')).toBeNull();
    expect(root.querySelector('app-ideas-panel')).toBeNull();
  });

  it('lists every active spec without a filter', async () => {
    const { root } = await render('/w/harbor/specs');
    expect(rowIds(root)).toEqual(harbor.specs.map((spec) => spec.id).sort());
  });

  it('writes the list query into the URL', async () => {
    const { harness } = await render('/w/harbor/specs');
    const page = harness.routeDebugElement?.componentInstance as { setQuery: (query: unknown) => void };
    page.setQuery({ phase: 'scoping', type: null, sort: 'stage', takeable: false, archived: false });
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('phase=scoping');
  });

  it('lists exactly the specs with an agent on ?working=1 and drops the param when the filter resets (spec 064, T5, ISC-465)', async () => {
    body.set(harborWorking);
    const { root, harness } = await render('/w/harbor/specs?working=1');
    expect(rowIds(root)).toEqual([...WORKING].sort());
    const page = harness.routeDebugElement?.componentInstance as { query: () => { working: boolean }; setQuery: (query: unknown) => void };
    expect(page.query().working).toBe(true);
    page.setQuery({ ...page.query(), working: false });
    await harness.fixture.whenStable();
    const router = TestBed.inject(Router);
    expect(router.parseUrl(router.url).queryParamMap.has('working')).toBe(false);
    expect(rowIds(root)).toEqual(harbor.specs.map((spec) => spec.id).sort());
  });

  it('writes ?working=1 into the URL like takeable (spec 064, T5, ISC-465)', async () => {
    const { harness } = await render('/w/harbor/specs');
    const page = harness.routeDebugElement?.componentInstance as { query: () => object; setQuery: (query: unknown) => void };
    page.setQuery({ ...page.query(), working: true });
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('working=1');
  });

  it('renders not-found for an unknown workspace', async () => {
    missing.set(true);
    const { root } = await render('/w/nope/specs');
    expect(root.querySelector('app-not-found')).not.toBeNull();
    expect(root.querySelector('app-spec-table')).toBeNull();
  });

  it('takes the selection: the previewed spec and ] stepping to its neighbour (T8, ISC-393)', async () => {
    const { root, harness } = await render('/w/harbor/specs?sel=spec:004');
    const selection = TestBed.inject(DetailSelection);
    expect(selection.selected()).toBe('spec:004');
    const page = harness.routeDebugElement?.componentInstance as { preview: () => { id: string } | null; neighbours: () => { prev: string | null; next: string | null } };
    expect(page.preview()?.id).toBe('004');
    const { next } = page.neighbours();
    expect(next).not.toBeNull();
    root.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
    await harness.fixture.whenStable();
    expect(selection.selected()).toBe(`spec:${String(next)}`);
  });
});
