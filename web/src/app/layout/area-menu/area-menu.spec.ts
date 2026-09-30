import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../shell/shell-state.service';
import type { Tier } from '../shell/tier';
import { AreaMenu } from './area-menu';

@Component({ selector: 'app-blank', template: '' })
class Blank {}

/** The shell's route shapes, reduced to the data `ShellState` reads (the real table loads every view). */
const ROUTES: Routes = [
  { path: 'w/:ws', component: Blank },
  { path: 'w/:ws/features', component: Blank, data: { page: 'features' } },
  { path: 'w/:ws/milestones', component: Blank, data: { page: 'milestones' } },
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
});

const milestone = (name: string, target: string | null, state: Milestone['state'], specs: readonly Holder[]): Milestone => ({
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

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec'>;

function fakeApi(plan: ApiResult<PlanningBody>): FakeApi {
  return {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(DASHBOARD) : { kind: 'not-found', served: true }),
    planning: () => Promise.resolve(plan),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
  };
}

function setUp(plan: ApiResult<PlanningBody>): void {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(ROUTES), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: fakeApi(plan) }],
  });
}

/** Navigates to `url`, then renders the menu at `tier`; the popover's and the sheet's content is in the DOM while shut. */
async function render(url: string, tier: Tier = 'wide'): Promise<HTMLElement> {
  await TestBed.inject(Router).navigateByUrl(url);
  TestBed.inject(ShellState).tier.set(tier);
  const fixture = TestBed.createComponent(AreaMenu);
  await fixture.whenStable();
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

    it('lists Specs and Features, and no Milestones entry, while no spec carries a milestone', async () => {
      setUp(ok(planning([UNNAMED])));
      const root = await render('/w/harbor');
      const entries = pages(root);
      expect(attr(entries, 'data-page')).toEqual(['specs', 'features']);
      expect(entries.map((entry) => entry.tagName)).toEqual(['A', 'A']);
      expect(attr(entries, 'href')).toEqual(['/w/harbor', '/w/harbor/features']);
      expect(attr(entries, 'aria-disabled')).toEqual([null, null]);
      expect(entries.map((entry) => entry.querySelector('.entry-name')?.textContent.trim())).toEqual(['Specs', 'Features']);
      expect(root.querySelectorAll('nav [data-area]')).toHaveLength(0);
    });

    it('adds the Milestones entry, third, as soon as a spec carries a milestone', async () => {
      setUp(ok(WITH_MILESTONES));
      const entries = pages(await render('/w/harbor'));
      expect(attr(entries, 'data-page')).toEqual(['specs', 'features', 'milestones']);
      expect(attr(entries, 'href')).toEqual(['/w/harbor', '/w/harbor/features', '/w/harbor/milestones']);
      expect(entries.map((entry) => entry.querySelector('.entry-name')?.textContent.trim())).toEqual(['Specs', 'Features', 'Milestones']);
    });

    it("counts an archived spec's milestone", async () => {
      setUp(ok(planning([milestone('Harbor 0.9', '2026-08-01', 'complete', [holder('001', true)])])));
      expect(attr(pages(await render('/w/harbor')), 'data-page')).toEqual(['specs', 'features', 'milestones']);
    });

    it('marks the current page with aria-current and gives it focus on open', async () => {
      setUp(ok(WITH_MILESTONES));
      const cases: Array<[string, Array<string | null>]> = [
        ['/w/harbor', ['page', null, null]],
        ['/w/harbor/features', [null, 'page', null]],
        ['/w/harbor/milestones', [null, null, 'page']],
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

    it('renders the summaries from the dashboard rows and the planning model', async () => {
      setUp(ok(WITH_MILESTONES));
      const entries = pages(await render('/w/harbor'));
      expect(entries.map(sub)).toEqual(['3 active · 1 archived', '2 features · 5/9 closed', '2 milestones · next Nov 30']);
    });

    it('names an undated next milestone by its name', async () => {
      setUp(
        ok(
          planning([
            milestone('Harbor 0.9', '2026-08-01', 'complete', [holder('001', true)]),
            milestone('Harbor 2.0', null, 'upcoming', [holder('003')]),
          ]),
        ),
      );
      expect(pages(await render('/w/harbor')).map(sub)[2]).toBe('2 milestones · next Harbor 2.0');
    });

    it('leaves the Features summary out while the planning model is not loaded, rather than a broken template', async () => {
      setUp({ kind: 'not-found', served: false });
      const entries = pages(await render('/w/harbor'));
      expect(attr(entries, 'data-page')).toEqual(['specs', 'features']);
      expect(entries.map(sub)).toEqual(['3 active · 1 archived', null]);
      expect(entries.map((entry) => entry.textContent)).not.toContain('{{');
    });

    it('renders the same entries as 56 px sheet rows at compact', async () => {
      setUp(ok(WITH_MILESTONES));
      const root = await render('/w/harbor/features', 'compact');
      expect(root.querySelector('ui-sheet nav')?.getAttribute('data-tier')).toBe('compact');
      expect(attr(pages(root), 'data-page')).toEqual(['specs', 'features', 'milestones']);
      expect(attr(pages(root), 'aria-current')).toEqual([null, 'page', null]);
    });
  });

  describe('at spec scope', () => {
    it('keeps the six areas unchanged, milestones or not', async () => {
      setUp(ok(WITH_MILESTONES));
      const root = await render('/w/harbor/s/002/claims');
      expect(pages(root)).toHaveLength(0);
      const entries = [...root.querySelectorAll<HTMLElement>('nav [data-area]')];
      expect(attr(entries, 'data-area')).toEqual(['dashboard', 'status', 'live', 'data', 'docs', 'notes']);
      expect(attr(entries, 'href')).toEqual([
        '/w/harbor/s/002',
        '/w/harbor/s/002/status',
        '/w/harbor/s/002/board',
        '/w/harbor/s/002/claims',
        '/w/harbor/s/002/plan',
        '/w/harbor/s/002/notes',
      ]);
      expect(attr(entries, 'aria-current')).toEqual([null, null, null, 'page', null, null]);
      expect(entries.map((entry) => entry.querySelector('.dot')?.getAttribute('data-dot'))).toEqual([
        'dashboard',
        'status',
        'live',
        'data',
        'docs',
        'notes',
      ]);
    });
  });
});
