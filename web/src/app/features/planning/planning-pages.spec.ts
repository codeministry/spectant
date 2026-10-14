import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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
  ideas: [],
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
  workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: [],
  stageCounts: {},
  ideas: [],
  features: [{ ideas: [], id: 'F2', name: 'Web console', why: null, closed: 2, total: 4, claims: [], holders: [], unheld: [] }],
  milestones,
  recount: { closed: 2, total: 4 },
  diagnostics: [],
});

const NAMED = planning([
  milestone('Harbor 1.0', [{ id: '002', slug: '002-web-console', title: 'Web console', archived: false, main: true, held: 4, stage: null, stageSource: null, priority: 'P3', hash: null, assignee: null }]),
]);
/** A block entry no spec names is a 0/0 row: the page stays absent (ISC-104). */

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
  // Spec 026 (T30, ISC-167.1): the old Features and Milestones pages are redirects to the tree lens; an anchor naming
  // a feature or a milestone becomes `?sel=`, any other anchor is dropped.
  it.each([
    ['/w/harbor/features', '/w/harbor/planning/tree'],
    ['/w/harbor/milestones', '/w/harbor/planning/tree'],
    ['/w/harbor/features#F2', '/w/harbor/planning/tree?sel=feature:F2'],
    ['/w/harbor/milestones#m-harbor-1-0', '/w/harbor/planning/tree?sel=milestone:harbor-1-0'],
    ['/w/harbor/features#m-harbor-1-0', '/w/harbor/planning/tree'],
    ['/w/harbor/milestones#F2', '/w/harbor/planning/tree'],
    ['/w/nope/features', '/w/nope/planning/tree'],
  ])('redirects %s to %s', async (from, to) => {
    setUp(ok(NAMED));
    await open(from);
    expect(TestBed.inject(Router).url).toBe(to);
    expect(TestBed.inject(ShellState).route().wsPage).toBe('planning');
  });
});
