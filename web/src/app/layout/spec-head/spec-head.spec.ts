import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import en from '../../../i18n/en.json';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import type { ShellRouteData } from '../shell/areas';
import { ShellState } from '../shell/shell-state.service';
import type { Tier } from '../shell/tier';
import { SpecHead } from './spec-head';

// T39 · ISC-105: the spec head's breadcrumb over the planning tree (design § The breadcrumb). The e2e (T41) proves it
// in the real app; these specs pin the levels, links, the "+n" popover, the archived and unknown-milestone forms and
// the compact short form against a hand-built planning model.

type Feature = PlanningBody['features'][number];
type Holder = Feature['holders'][number];
type Milestone = PlanningBody['milestones'][number];

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const unserved = { kind: 'not-found', served: false } as const;

const holder = (id: string, slug: string, main: boolean, archived = false): Holder => ({
  id,
  slug,
  title: slug,
  archived,
  main,
  held: 1,
  stage: null,
});
const feature = (id: string, name: string, holders: readonly Holder[], claims: readonly string[]): Feature => ({
  id,
  name,
  why: null,
  closed: 0,
  total: claims.length,
  claims: claims.map((claim) => ({ id: claim, closed: false, dropped: false, holder: holders[0]?.id ?? null })),
  holders,
  unheld: [],
});
const milestone = (name: string, slug: string, specs: readonly Holder[]): Milestone => ({
  name,
  slug,
  target: '2026-12-01',
  description: null,
  closed: 0,
  total: 0,
  state: 'upcoming',
  features: [],
  specs,
});

/** 002 is main under F7 and also holds claims of F0 and F2; 001 is archived, main under F1. */
const PLAN: PlanningBody = {
  features: [
    feature('F0', 'Cross-cutting', [holder('002', '002-web-console', false)], ['ISC-1']),
    feature('F1', 'Manifest sync', [holder('001', '001-manifest-sync', true, true)], ['ISC-5']),
    feature('F2', 'Web console', [holder('002', '002-web-console', false)], ['ISC-51']),
    feature('F7', 'Planning', [holder('002', '002-web-console', true)], ['ISC-100']),
  ],
  milestones: [milestone('v0.3', 'v0-3', [holder('002', '002-web-console', false)])],
  recount: null,
  diagnostics: [],
};

const HARBOR = {
  specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build' }],
  archive: [{ id: '001', title: 'Manifest sync', type: 'feature' }],
};

const TABS: ReadonlyArray<[string, ShellRouteData]> = [
  ['', { area: 'dashboard' }],
  ['status', { area: 'status', tab: 'status' }],
  ['claims', { area: 'data', tab: 'claims' }],
  ['tasks', { area: 'data', tab: 'tasks' }],
];
const routes: Routes = TABS.map(([tab, data]) => ({ path: tab ? `w/:ws/s/:id/${tab}` : 'w/:ws/s/:id', component: SpecHead, data }));

function setUp(planning: ApiResult<PlanningBody> = ok(PLAN)): void {
  const api = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(HARBOR)),
    planning: () => Promise.resolve(planning),
    spec: () => Promise.resolve(unserved),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
}

async function open(url: string, tier: Tier = 'wide'): Promise<HTMLElement> {
  const harness = await RouterTestingHarness.create();
  TestBed.inject(ShellState).tier.set(tier);
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();
  return harness.fixture.nativeElement as HTMLElement;
}

const nav = (root: HTMLElement): HTMLElement => {
  const found = root.querySelector<HTMLElement>('nav[data-breadcrumb]');
  if (!found) throw new Error('no breadcrumb');
  return found;
};
const crumb = (root: HTMLElement, name: string): HTMLElement | null => nav(root).querySelector<HTMLElement>(`[data-crumb="${name}"]`);
const crumbs = (root: HTMLElement): Array<string | null> =>
  [...nav(root).querySelectorAll('ol > li [data-crumb]')].map((el) => el.getAttribute('data-crumb'));
const seps = (root: HTMLElement): Array<string | null> => [...nav(root).querySelectorAll('ol > li')].map((li) => li.getAttribute('data-sep'));
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();

describe('SpecHead breadcrumb (T39, ISC-105)', () => {
  it('renders milestone · feature › spec › area under the workspace, each level linking to its page', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/status');
    expect(nav(root).getAttribute('aria-label')).toBe(en.planning.breadcrumb.label);
    expect(crumbs(root)).toEqual(['workspace', 'milestone', 'feature', 'spec', 'area']);
    expect(seps(root)).toEqual([null, 'scope', 'dot', 'down', 'down']);

    const ms = crumb(root, 'milestone');
    expect(ms?.getAttribute('href')).toBe('/w/harbor/milestones#m-v0-3');
    expect(text(ms)).toBe('v0.3');
    expect(ms?.querySelector('ui-icon[name="flag"]')).not.toBeNull();

    const feat = crumb(root, 'feature');
    expect(feat?.getAttribute('href')).toBe('/w/harbor/features#F7');
    expect(text(feat)).toBe('F7 Planning');
    expect(feat?.getAttribute('aria-description')).toBe(en.terms.feature);

    const spec = crumb(root, 'spec');
    expect(spec?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(text(spec)).toBe('002 web-console');
    expect(spec?.getAttribute('aria-description')).toBe(en.terms.spec);
    // T40: the slug is its own truncating span; the id beside it is not.
    expect(spec?.querySelector('.crumb-slug')?.textContent).toBe('web-console');
    expect(spec?.querySelector('.mono')?.textContent).toBe('002');

    expect(crumb(root, 'area')?.getAttribute('aria-current')).toBe('page');
  });

  it('adds a "+2" chip button after the main feature whose popover lists the other held blocks as links', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/status');
    const more = nav(root).querySelector<HTMLButtonElement>('button[data-crumb-more]');
    expect(text(more)).toBe('+2');
    expect(more?.getAttribute('aria-label')).toBe(en.planning.breadcrumb.more.replace('{{count}}', '2'));
    const panelId = more?.getAttribute('aria-controls') ?? '';
    const links = [...nav(root).querySelectorAll<HTMLAnchorElement>(`[id="${panelId}"] a`)];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/w/harbor/features#F0', '/w/harbor/features#F2']);
    expect(links.map(text)).toEqual(['F0 Cross-cutting', 'F2 Web console']);
  });

  it("puts an open claim last with aria-current, its own block as the feature, and turns the area into a link", async () => {
    setUp();
    const root = await open('/w/harbor/s/002/claims#claim-ISC-1');
    expect(crumbs(root)).toEqual(['workspace', 'milestone', 'feature', 'spec', 'area', 'claim']);
    expect(crumb(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F0');
    const others = nav(root).querySelectorAll<HTMLAnchorElement>('ui-popover a');
    expect([...others].map((a) => a.getAttribute('href'))).toEqual(['/w/harbor/features#F2', '/w/harbor/features#F7']);

    const area = crumb(root, 'area');
    expect(area?.tagName).toBe('A');
    expect(area?.getAttribute('href')).toBe('/w/harbor/s/002/claims');
    expect(area?.hasAttribute('aria-current')).toBe(false);

    const claim = crumb(root, 'claim');
    expect(text(claim)).toBe('ISC-1');
    expect(claim?.getAttribute('aria-current')).toBe('page');
    expect(claim?.getAttribute('href')).toBe('/w/harbor/s/002/claims#claim-ISC-1');
    expect(claim?.getAttribute('aria-description')).toBe(en.terms.claim);
  });

  it('puts an open task last on the tasks tab', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/tasks#task-T12');
    const task = crumb(root, 'task');
    expect(text(task)).toBe('T12');
    expect(task?.getAttribute('aria-current')).toBe('page');
    expect(task?.getAttribute('href')).toBe('/w/harbor/s/002/tasks#task-T12');
    expect(task?.getAttribute('aria-description')).toBe(en.terms.task);
  });

  it('marks an archived spec with the archive glyph and an accessible name ending "archived"', async () => {
    setUp();
    const root = await open('/w/harbor/s/001/status');
    expect(crumbs(root)).toEqual(['workspace', 'feature', 'spec', 'area']);
    expect(seps(root)).toEqual([null, 'scope', 'down', 'down']);
    const spec = crumb(root, 'spec');
    expect(spec?.querySelector('ui-icon[name="archive"]')).not.toBeNull();
    expect(spec?.getAttribute('aria-label')).toBe(`001 manifest-sync, ${en.planning.breadcrumb.archived}`);
    expect(crumb(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F1');
    expect(nav(root).querySelector('button[data-crumb-more]')).toBeNull();
  });

  it('shows an unknown milestone as plain text with triangle-alert, not a link', async () => {
    setUp(
      ok({
        ...PLAN,
        milestones: [],
        diagnostics: [
          {
            file: 'specs/002-web-console/spec.md',
            diagnostic: { severity: 'warning', code: 'spec-milestone-unknown', message: 'milestone "v9" is not in the master\'s ## Milestones block', subject: 'v9' },
          },
        ],
      }),
    );
    const root = await open('/w/harbor/s/002/status');
    const ms = crumb(root, 'milestone');
    expect(ms?.tagName).not.toBe('A');
    expect(ms?.querySelector('ui-icon[name="triangle-alert"]')).not.toBeNull();
    expect(text(ms)).toBe('v9');
    expect(ms?.getAttribute('aria-description')).toBe(en.planning.breadcrumb.unknownMilestone);
  });

  it('returns at compact in the short form: no workspace, no area, the spec as its mono id', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/claims#claim-ISC-100', 'compact');
    expect(crumbs(root)).toEqual(['milestone', 'feature', 'spec', 'claim']);
    expect(seps(root)).toEqual([null, 'dot', 'down', 'down']);
    expect(text(crumb(root, 'feature'))).toBe('F7');
    expect(text(crumb(root, 'spec'))).toBe('002');
    expect(text(crumb(root, 'claim'))).toBe('ISC-100');
  });

  // Compact drops the area crumb, so without a leaf the spec crumb is the last level and carries `aria-current` on
  // every area, not only the dashboard.
  it('marks the spec crumb current at compact on a non-dashboard area without a leaf', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/status', 'compact');
    expect(crumb(root, 'area')).toBeNull();
    expect(crumb(root, 'spec')?.getAttribute('aria-current')).toBe('page');
    expect(nav(root).querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('marks the leaf current at compact when a claim is open, never the spec crumb', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/claims#claim-ISC-51', 'compact');
    expect(crumb(root, 'claim')?.getAttribute('aria-current')).toBe('page');
    expect(crumb(root, 'spec')?.hasAttribute('aria-current')).toBe(false);
    expect(nav(root).querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('leaves the spec crumb uncurrent at medium, where the area crumb carries it', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/status', 'medium');
    expect(crumb(root, 'spec')?.hasAttribute('aria-current')).toBe(false);
    expect(crumb(root, 'area')?.getAttribute('aria-current')).toBe('page');
  });

  // The route's `:id` is every form the server resolves (`core/src/resolve.ts` `resolveSpec`): `NNN`, the folder
  // `NNN-slug` or the bare slug. The spec route answers not-found here, so the head never learns the model's id and
  // must match the planning holders by the form in the URL alone.
  for (const [form, ref] of [
    ['folder', '002-web-console'],
    ['bare slug', 'web-console'],
  ] as const) {
    it(`renders the milestone and feature crumbs for the ${form} form in the URL`, async () => {
      setUp();
      const root = await open(`/w/harbor/s/${ref}/status`);
      expect(crumbs(root)).toEqual(['workspace', 'milestone', 'feature', 'spec', 'area']);
      expect(crumb(root, 'milestone')?.getAttribute('href')).toBe('/w/harbor/milestones#m-v0-3');
      expect(crumb(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F7');
      expect(text(nav(root).querySelector('button[data-crumb-more]'))).toBe('+2');
      expect(text(crumb(root, 'spec'))).toBe('002 web-console');
    });
  }

  for (const [form, ref] of [
    ['folder', '001-manifest-sync'],
    ['bare slug', 'manifest-sync'],
  ] as const) {
    it(`marks an archived spec archived for the ${form} form in the URL`, async () => {
      setUp();
      const root = await open(`/w/harbor/s/${ref}/status`);
      expect(crumbs(root)).toEqual(['workspace', 'feature', 'spec', 'area']);
      const spec = crumb(root, 'spec');
      expect(spec?.querySelector('ui-icon[name="archive"]')).not.toBeNull();
      expect(spec?.getAttribute('aria-label')).toBe(`001 manifest-sync, ${en.planning.breadcrumb.archived}`);
      expect(crumb(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F1');
    });
  }

  it('finds an unknown milestone for the bare-slug form in the URL', async () => {
    setUp(
      ok({
        ...PLAN,
        milestones: [],
        diagnostics: [
          {
            file: 'specs/002-web-console/spec.md',
            diagnostic: { severity: 'warning', code: 'spec-milestone-unknown', message: 'milestone "v9" is not in the master\'s ## Milestones block', subject: 'v9' },
          },
        ],
      }),
    );
    const root = await open('/w/harbor/s/web-console/status');
    expect(text(crumb(root, 'milestone'))).toBe('v9');
  });

  it('keeps the three levels of today when the planning tree is not loaded', async () => {
    setUp(unserved);
    const root = await open('/w/harbor/s/002/status');
    expect(crumbs(root)).toEqual(['workspace', 'spec', 'area']);
    expect(crumb(root, 'workspace')?.getAttribute('href')).toBe('/w/harbor');
    expect(crumb(root, 'area')?.getAttribute('aria-current')).toBe('page');
  });
});
