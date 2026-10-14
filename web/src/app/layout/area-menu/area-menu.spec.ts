import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { LibraryCatalog, LibraryDoc } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../shell/shell-state.service';
import type { Tier } from '../shell/tier';
import { AreaMenu } from './area-menu';
import DASHBOARD_GOLDEN from '../../../../../core/fixtures/harbor.golden.json';
import PLANNING_GOLDEN from '../../../../../core/fixtures/harbor.planning.golden.json';
import { boardRowsOf, buildBoard } from '../../features/board/board-model';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

/** The shell's route shapes, reduced to the data `ShellState` reads (the real table loads every view). */
const ROUTES: Routes = [
  { path: 'w/:ws', component: Blank },
  { path: 'w/:ws/planning/tree', component: Blank, data: { page: 'planning', tab: 'tree' } },
  { path: 'w/:ws/planning/graph', component: Blank, data: { page: 'planning', tab: 'graph' } },
  { path: 'w/:ws/features', component: Blank, data: { page: 'features' } },
  { path: 'w/:ws/milestones', component: Blank, data: { page: 'milestones' } },
  { path: 'w/:ws/library', component: Blank, data: { page: 'library' } },
  { path: 'w/:ws/s/:id', component: Blank },
  { path: 'w/:ws/s/:id/claims', component: Blank, data: { area: 'data', tab: 'claims' } },
];

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const DASHBOARD = {
  specs: [
    { id: '004', title: 'Retention policies', type: 'feature', stage: 'code-review' },
    { id: '002', title: 'Web console', type: 'feature', stage: 'build' },
    { id: '003', title: 'Config loader', type: 'refactor', stage: 'tasks' },
  ],
  archive: [{ id: '001', title: 'Manifest sync', type: 'feature' }],
  kpis: { specs: 3, fog: 7, warnings: 2, attention: 9 },
};

type Milestone = PlanningBody['milestones'][number];
type Holder = Milestone['specs'][number];

const holder = (id: string, archived = false): Holder => ({
  id,
  slug: `${id}-spec`,
  title: `Spec ${id}`,
  archived,
  main: false,
  held: 2,
  stage: null,
  stageSource: null,
  priority: 'P3',
  hash: null,
  assignee: null,
});

const milestone = (name: string, target: string | null, state: Milestone['state'], specs: readonly Holder[]): Milestone => ({
  ideas: [],
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  target,
  description: null,
  closed: 1,
  total: 4,
  state,
  features: [],
  specs,
});

const feature = (id: string, closed: number, total: number): PlanningBody['features'][number] => ({
  ideas: [],
  id,
  name: `Feature ${id}`,
  why: null,
  closed,
  total,
  claims: [],
  holders: [],
  unheld: [],
});

const planning = (milestones: readonly Milestone[]): PlanningBody => ({
  workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: [],
  stageCounts: {},
  ideas: [],
  features: [feature('F1', 3, 5), feature('F2', 2, 4)],
  milestones,
  recount: { closed: 5, total: 9 },
  diagnostics: [],
});

/** A master block entry no spec names: a 0/0 row that must not reveal the page. */
const UNNAMED = milestone('Someday', '2027-06-01', 'upcoming', []);
const WITH_MILESTONES = planning([
  milestone('Harbor 0.9', '2026-08-01', 'complete', [holder('001', true)]),
  milestone('Harbor 1.0', '2026-11-30', 'upcoming', [holder('002')]),
  UNNAMED,
]);

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'library'>;

/** A catalog of 52 documents, 3 outdated and 5 missing (design.md 017 § 1): only the counts and the list's length matter. */
const doc = (n: number): LibraryDoc => ({
  path: `017-x/doc-${String(n)}.md`,
  type: 'artifact',
  spec: '017-x',
  title: `doc ${String(n)}`,
  modified: null,
  state: 'ok',
  media: 'markdown',
});
const CATALOG: LibraryCatalog = { docs: Array.from({ length: 52 }, (_, n) => doc(n)), groups: [], fog: [], missing: 5, stale: 3 };

type LibraryAnswer = () => Promise<ApiResult<LibraryCatalog>>;

function fakeApi(plan: ApiResult<PlanningBody>, dashboard: unknown, library: LibraryAnswer = () => Promise.resolve(ok(CATALOG))): FakeApi {
  return {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(dashboard) : { kind: 'not-found', served: true }),
    planning: () => Promise.resolve(plan),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    library: vi.fn(library),
  };
}

function setUp(plan: ApiResult<PlanningBody>, dashboard: unknown = DASHBOARD, api: FakeApi = fakeApi(plan, dashboard)): void {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(ROUTES), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
}

/**
 * Navigates to `url`, then renders the menu at `tier`; the popover's and the sheet's content is in the DOM while shut.
 * `open` opens it as the PAGE select does (the popover's `showPopover` stubbed), which is when it reads the catalog.
 */
async function render(url: string, tier: Tier = 'wide', open = false): Promise<HTMLElement> {
  await TestBed.inject(Router).navigateByUrl(url);
  TestBed.inject(ShellState).tier.set(tier);
  const fixture = TestBed.createComponent(AreaMenu);
  // spec 024: PAGE select (principal 2026-10-13): the workspace pages are the page menu's scope, the areas the area menu's
  fixture.componentRef.setInput('scope', url.includes('/s/') ? 'spec' : 'page');
  await fixture.whenStable();
  if (open) {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    proto['showPopover'] ??= vi.fn();
    fixture.componentInstance.show(document.createElement('button'));
    await fixture.whenStable();
  }
  return fixture.nativeElement as HTMLElement;
}

const pages = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('nav [data-page]')];
const attr = (entries: readonly HTMLElement[], name: string) => entries.map((entry) => entry.getAttribute(name));
const sub = (entry: HTMLElement) => entry.querySelector('.sub')?.textContent.trim() ?? null;

describe('AreaMenu', () => {
  describe('at workspace scope (T26, ISC-104)', () => {
    it('leaves workspace scope for a workspace the server does not know: no page links into not-found', async () => {
      setUp(ok(WITH_MILESTONES));
      const root = await render('/w/nope');
      expect(pages(root)).toHaveLength(0);
      expect(root.querySelectorAll('a[href^="/w/nope"]')).toHaveLength(0);
    });

    it('lists Specs, Board, Planning, Tech and Library, no Features or Milestones entry, without milestones (spec 026, ISC-167)', async () => {
      setUp(ok(planning([UNNAMED])));
      const root = await render('/w/harbor');
      const entries = pages(root);
      expect(attr(entries, 'data-page')).toEqual(['specs', 'board', 'planning', 'library']);
      expect(entries.map((entry) => entry.tagName)).toEqual(['A', 'A', 'A', 'A']);
      expect(attr(entries, 'href')).toEqual(['/w/harbor', '/w/harbor/board', '/w/harbor/planning', '/w/harbor/library']);
      expect(attr(entries, 'aria-disabled')).toEqual([null, null, null, null]);
      expect(entries.map((entry) => entry.querySelector('.entry-name')?.textContent.trim())).toEqual(['Specs', 'Board', 'Planning', 'Library']);
      expect(root.querySelectorAll('nav [data-area]')).toHaveLength(0);
    });

    it('keeps the same four entries when a spec carries a milestone: no Milestones page any more (spec 026); Library stands fourth, where Tech stood (spec 017 T41)', async () => {
      setUp(ok(WITH_MILESTONES));
      const entries = pages(await render('/w/harbor'));
      expect(attr(entries, 'data-page')).toEqual(['specs', 'board', 'planning', 'library']);
      expect(attr(entries, 'href')).toEqual(['/w/harbor', '/w/harbor/board', '/w/harbor/planning', '/w/harbor/library']);
      expect(entries.map((entry) => entry.querySelector('.entry-name')?.textContent.trim())).toEqual(['Specs', 'Board', 'Planning', 'Library']);
      expect(entries[3]?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('book');
    });

    it("counts an archived spec's milestone", async () => {
      setUp(ok(planning([milestone('Harbor 0.9', '2026-08-01', 'complete', [holder('001', true)])])));
      expect(attr(pages(await render('/w/harbor')), 'data-page')).toEqual(['specs', 'board', 'planning', 'library']);
    });

    it('marks the current page with aria-current and gives it focus on open', async () => {
      setUp(ok(WITH_MILESTONES));
      const cases: Array<[string, Array<string | null>]> = [
        ['/w/harbor', ['page', null, null, null]],
        ['/w/harbor/planning/tree', [null, null, 'page', null]],
        ['/w/harbor/planning/graph', [null, null, 'page', null]],
        ['/w/harbor/library', [null, null, null, 'page']],
      ];
      for (const [url, current] of cases) {
        const entries = pages(await render(url));
        expect(attr(entries, 'aria-current'), url).toEqual(current);
        expect(attr(entries, 'data-autofocus'), url).toEqual(current.map((value) => (value ? '' : null)));
      }
    });

    it('draws each page icon instead of an area dot, and no g-key hint while the keys are unbound', async () => {
      setUp(ok(WITH_MILESTONES));
      const root = await render('/w/harbor');
      for (const entry of pages(root)) {
        expect(entry.querySelector('ui-icon'), entry.dataset['page']).not.toBeNull();
        expect(entry.querySelector('.dot'), entry.dataset['page']).toBeNull();
      }
      expect(root.querySelector('nav ui-kbd')).toBeNull();
    });

    it('renders the summaries from the dashboard rows, the planning model and, once opened, the catalog', async () => {
      setUp(ok(WITH_MILESTONES));
      const entries = pages(await render('/w/harbor', 'wide', true));
      expect(entries.map(sub)).toEqual([
        '3 active · 1 archived',
        '0 stages · 0 cards · 0 wait on you',
        '2 milestones · 2 features',
        '52 documents · 3 outdated · 5 missing',
      ]);
    });

    it('counts the Library line from the catalog in German too (spec 017 T41, ISC-157.1)', async () => {
      setUp(ok(WITH_MILESTONES));
      TestBed.inject(TranslocoService).setActiveLang('de');
      expect(pages(await render('/w/harbor', 'wide', true)).map(sub).at(-1)).toBe('52 Dokumente · 3 veraltet · 5 fehlen');
    });

    it('reads the catalog only once the menu opens, and once per workspace', async () => {
      const api = fakeApi(ok(WITH_MILESTONES), DASHBOARD);
      setUp(ok(WITH_MILESTONES), DASHBOARD, api);
      await TestBed.inject(Router).navigateByUrl('/w/harbor');
      TestBed.inject(ShellState).tier.set('compact');
      const fixture = TestBed.createComponent(AreaMenu);
      fixture.componentRef.setInput('scope', 'page');
      await fixture.whenStable();
      expect(api.library).not.toHaveBeenCalled();
      expect(pages(fixture.nativeElement as HTMLElement).map(sub).at(-1)).toBe('Every document, artifact and prototype');
      for (let round = 0; round < 3; round++) {
        fixture.componentInstance.show(document.createElement('button'));
        await fixture.whenStable();
        fixture.componentInstance.close();
        await fixture.whenStable();
      }
      expect(api.library).toHaveBeenCalledTimes(1);
      expect(api.library).toHaveBeenCalledWith('harbor');
      expect(pages(fixture.nativeElement as HTMLElement).map(sub).at(-1)).toBe('52 documents · 3 outdated · 5 missing');
    });

    it('keeps the static Library line while the catalog loads and after it fails, never an empty row', async () => {
      let answer: (result: ApiResult<LibraryCatalog>) => void = () => undefined;
      const pending = new Promise<ApiResult<LibraryCatalog>>((resolve) => {
        answer = resolve;
      });
      setUp(ok(WITH_MILESTONES), DASHBOARD, fakeApi(ok(WITH_MILESTONES), DASHBOARD, () => pending));
      await TestBed.inject(Router).navigateByUrl('/w/harbor');
      TestBed.inject(ShellState).tier.set('compact');
      const fixture = TestBed.createComponent(AreaMenu);
      fixture.componentRef.setInput('scope', 'page');
      await fixture.whenStable();
      fixture.componentInstance.show(document.createElement('button'));
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(pages(root).map(sub).at(-1)).toBe('Every document, artifact and prototype');
      answer({ kind: 'error', status: 500 });
      await fixture.whenStable();
      expect(pages(root).map(sub).at(-1)).toBe('Every document, artifact and prototype');
    });

    it('shows the same Library line at compact as at medium and wide', async () => {
      for (const tier of ['compact', 'medium', 'wide'] as const) {
        TestBed.resetTestingModule();
        setUp(ok(WITH_MILESTONES));
        expect(pages(await render('/w/harbor/library', tier, true)).map(sub).at(-1), tier).toBe('52 documents · 3 outdated · 5 missing');
      }
    });

    it('counts the Board line through the board model: stages, cards and cards waiting on you (T116, ISC-129)', async () => {
      const golden = PLANNING_GOLDEN as unknown as PlanningBody;
      setUp(ok(golden), DASHBOARD_GOLDEN);
      const model = buildBoard({ planning: golden, rows: boardRowsOf(DASHBOARD_GOLDEN) });
      const cards = Object.values(golden.stageCounts).reduce((n, v) => n + v, 0);
      expect(model.total).toBe(cards);
      expect(pages(await render('/w/harbor')).map(sub)[1]).toBe(`${String(golden.stages.length)} stages · ${String(cards)} cards · 3 wait on you`);
    });

    it('leaves the Board line out until the dashboard rows have answered too', async () => {
      setUp(ok(WITH_MILESTONES));
      TestBed.overrideProvider(ApiClient, {
        useValue: { ...fakeApi(ok(WITH_MILESTONES), DASHBOARD), dashboard: () => Promise.resolve({ kind: 'unavailable' }) },
      });
      expect(pages(await render('/w/harbor')).map(sub)[1]).toBeNull();
    });

    it('counts an undated milestone in the Planning line (spec 026)', async () => {
      setUp(
        ok(
          planning([
            milestone('Harbor 0.9', '2026-08-01', 'complete', [holder('001', true)]),
            milestone('Harbor 2.0', null, 'upcoming', [holder('003')]),
          ]),
        ),
      );
      expect(pages(await render('/w/harbor')).map(sub)[2]).toMatch(/^2 milestones · \d+ features$/u);
    });

    it('leaves the Planning summary out while the planning model is not loaded, rather than a broken template', async () => {
      setUp({ kind: 'not-found', served: false });
      const entries = pages(await render('/w/harbor'));
      expect(attr(entries, 'data-page')).toEqual(['specs', 'board', 'planning', 'library']);
      expect(entries.map(sub)).toEqual(['3 active · 1 archived', null, null, 'Every document, artifact and prototype']);
      expect(entries.map((entry) => entry.textContent)).not.toContain('{{');
    });

    it('renders the same entries as 56 px sheet rows at compact', async () => {
      setUp(ok(WITH_MILESTONES));
      const root = await render('/w/harbor/planning/tree', 'compact');
      expect(root.querySelector('ui-sheet nav')?.getAttribute('data-tier')).toBe('compact');
      expect(attr(pages(root), 'data-page')).toEqual(['specs', 'board', 'planning', 'library']);
      expect(attr(pages(root), 'aria-current')).toEqual([null, null, 'page', null]);
    });
  });

  describe('at spec scope', () => {
    it('keeps the six areas, Library where Docs stood (spec 017, ISC-158), milestones or not', async () => {
      setUp(ok(WITH_MILESTONES));
      const root = await render('/w/harbor/s/002/claims');
      expect(pages(root)).toHaveLength(0);
      const entries = [...root.querySelectorAll<HTMLElement>('nav [data-area]')];
      expect(attr(entries, 'data-area')).toEqual(['dashboard', 'status', 'live', 'data', 'library', 'notes']);
      expect(attr(entries, 'href')).toEqual([
        '/w/harbor/s/002',
        '/w/harbor/s/002/status',
        '/w/harbor/s/002/board',
        '/w/harbor/s/002/claims',
        '/w/harbor/s/002/library',
        '/w/harbor/s/002/notes',
      ]);
      expect(attr(entries, 'aria-current')).toEqual([null, null, null, 'page', null, null]);
      expect(entries.map((entry) => entry.querySelector('.dot')?.getAttribute('data-dot'))).toEqual([
        'dashboard',
        'status',
        'live',
        'data',
        'library',
        'notes',
      ]);
    });
  });
});
