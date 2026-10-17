import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';

// T115 · ISC-129: the routes spec 008 adds to the real route table — `w/:ws/board` and `w/:ws/ideas/:slug` (lazy,
// beside the spec list) and the global `help` inside the shell — resolve to their pages, and an unknown story slug
// renders the not-found page. The pages themselves come with T121, T131 and T129.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const DASHBOARD = { specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build' }], archive: [] };

const PLANNING: PlanningBody = {
  asOf: '2026-03-20', workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: ['idea', 'plan', 'build', 'done'],
  stageCounts: { idea: 1, build: 1 },
  ideas: [
    {
      slug: 'board-swimlanes',
      title: 'Swimlanes on the board',
      type: 'feature',
      feature: 'F2',
      milestone: null,
      priority: 'P2',
      path: 'specs/ideas/board-swimlanes.md',
    },
  ],
  features: [],
  milestones: [],
  recount: { closed: 0, total: 0 },
  diagnostics: [],
};

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'idea'>;

function setUp(): void {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(DASHBOARD) : { kind: 'not-found', served: true }),
    planning: (ws) => Promise.resolve(ws === 'harbor' ? ok(PLANNING) : { kind: 'not-found', served: true }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    // The story route (T131): the fake serves the one story of PLANNING with an empty rendered body.
    idea: (ws, slug) =>
      Promise.resolve(
        ws === 'harbor' && slug === 'board-swimlanes'
          ? ok({ idea: PLANNING.ideas[0], page: { html: '', toc: [], frontmatter: null, figures: [], sections: [], wordCount: 0 }, hash: '0'.repeat(64) })
          : { kind: 'not-found', served: true },
      ),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
}

async function open(url: string): Promise<HTMLElement> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  return harness.fixture.nativeElement as HTMLElement;
}

const text = (element: Element | null | undefined): string | undefined => element?.textContent.replace(/\s+/g, ' ').trim();

describe('spec 008 routes (T115, ISC-129)', () => {
  beforeEach(setUp);

  it('resolves /w/:ws/board to the workspace board inside the shell and names it in the shell state', async () => {
    const root = await open('/w/harbor/board');
    expect(root.querySelector('app-shell [data-page="board"]')).not.toBeNull();
    expect(text(root.querySelector('[data-page="board"] h1#board'))).toBe('Board');
    expect(root.querySelector('app-not-found')).toBeNull();
    expect(TestBed.inject(ShellState).route()).toMatchObject({ ws: 'harbor', specId: null, wsPage: 'board', ideaSlug: null, notFound: false });
  });

  it('resolves /w/:ws/ideas/:slug to the idea page with the story slug', async () => {
    const root = await open('/w/harbor/ideas/board-swimlanes');
    const page = root.querySelector('app-shell [data-page="idea"]');
    expect(text(page?.querySelector('h1#idea'))).toBe('board-swimlanes');
    expect(text(page?.querySelector('[data-idea-goal] blockquote'))).toBe('Swimlanes on the board');
    expect(page?.querySelector('[data-idea-chips]')).not.toBeNull();
    expect(root.querySelector('app-not-found')).toBeNull();
    expect(TestBed.inject(ShellState).route()).toMatchObject({ ws: 'harbor', wsPage: 'idea', ideaSlug: 'board-swimlanes', notFound: false });
  });

  it('renders not-found for a story slug the workspace does not have', async () => {
    const root = await open('/w/harbor/ideas/no-such-story');
    expect(root.querySelector('[data-page="idea"] app-not-found')).not.toBeNull();
    expect(root.querySelector('h1#idea')).toBeNull();
  });

  it('renders not-found on the idea page of an unknown workspace', async () => {
    const root = await open('/w/nope/ideas/board-swimlanes');
    expect(root.querySelector('[data-page="idea"] app-not-found')).not.toBeNull();
  });

  it('resolves /help globally inside the shell, with no workspace in the route', async () => {
    const root = await open('/help');
    expect(root.querySelector('app-shell [data-page="help"]')).not.toBeNull();
    // spec 024: prototype value (principal: the prototype wins): the help head is the page head, no longer a card.
    expect(text(root.querySelector('[data-page="help"] h1#help'))).toBe('Help');
    expect(root.querySelector('app-not-found')).toBeNull();
    expect(TestBed.inject(ShellState).route()).toMatchObject({ ws: null, wsPage: null, notFound: false });
  });

  it('keeps an unknown path under a workspace on the not-found page', async () => {
    const root = await open('/w/harbor/ideas');
    expect(root.querySelector('app-not-found')).not.toBeNull();
    expect(TestBed.inject(ShellState).notFound()).toBe(true);
  });
});
