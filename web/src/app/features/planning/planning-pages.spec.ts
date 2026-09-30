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

// T30 · ISC-103 / ISC-104: the two planning routes in the real route table, `w/:ws/features` and `w/:ws/milestones`,
// resolve to their lazy pages beside the spec list, and `ShellState.route().wsPage` names them. The rows come with
// T32 and T36; the e2e tiers (`features`, `milestones`) prove the pages against the golden.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const DASHBOARD = {
  specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build' }],
  archive: [{ id: '001', title: 'Manifest sync', type: 'feature' }],
};

type Milestone = PlanningBody['milestones'][number];

const milestone = (name: string, specs: Milestone['specs']): Milestone => ({
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  target: '2026-11-30',
  description: null,
  closed: 1,
  total: 4,
  state: 'upcoming',
  features: [],
  specs,
});

const planning = (milestones: readonly Milestone[]): PlanningBody => ({
  features: [{ id: 'F2', name: 'Web console', why: null, closed: 2, total: 4, claims: [], holders: [], unheld: [] }],
  milestones,
  recount: { closed: 2, total: 4 },
  diagnostics: [],
});

const NAMED = planning([
  milestone('Harbor 1.0', [{ id: '002', slug: '002-web-console', title: 'Web console', archived: false, main: true, held: 4, stage: null }]),
]);
/** A block entry no spec names is a 0/0 row: the page stays absent (ISC-104). */
const UNNAMED_ONLY = planning([milestone('Someday', [])]);

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec'>;

function setUp(plan: ApiResult<PlanningBody>): void {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(DASHBOARD) : { kind: 'not-found', served: true }),
    planning: () => Promise.resolve(plan),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
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

describe('planning routes', () => {
  it('resolves /w/:ws/features to the Features page and names it in the shell state', async () => {
    setUp(ok(NAMED));
    const root = await open('/w/harbor/features');
    // "Features" is a `ui-term` (T32, ISC-107): its closed hint popover sits in the H1's DOM, so read the words on screen.
    const h1 = root.querySelector('[data-page="features"] h1#features')?.cloneNode(true) as HTMLElement | undefined;
    h1?.querySelectorAll('[role="tooltip"]').forEach((hint) => {
      hint.remove();
    });
    expect(h1?.textContent.replace(/\s+/g, ' ').trim()).toBe('Features in harbor');
    expect(root.querySelector('[data-page="features"] h1')?.getAttribute('tabindex')).toBe('-1');
    expect(root.querySelector('app-not-found')).toBeNull();
    expect(TestBed.inject(ShellState).route().wsPage).toBe('features');
  });

  it('resolves /w/:ws/milestones to the Milestones page while a spec carries a milestone', async () => {
    setUp(ok(NAMED));
    const root = await open('/w/harbor/milestones');
    expect(root.querySelector('[data-page="milestones"] h1#milestones')?.textContent).toBe('Milestones in harbor');
    expect(root.querySelector('app-not-found')).toBeNull();
    expect(TestBed.inject(ShellState).route().wsPage).toBe('milestones');
  });

  it('renders not-found on /w/:ws/milestones while no spec names a milestone', async () => {
    setUp(ok(UNNAMED_ONLY));
    const root = await open('/w/harbor/milestones');
    expect(root.querySelector('[data-page="milestones"] app-not-found')).not.toBeNull();
    expect(root.querySelector('h1#milestones')).toBeNull();
  });

  it('renders not-found on both pages for an unknown workspace', async () => {
    setUp({ kind: 'not-found', served: true });
    const root = await open('/w/nope/features');
    expect(root.querySelector('[data-page="features"] app-not-found')).not.toBeNull();
  });
});
