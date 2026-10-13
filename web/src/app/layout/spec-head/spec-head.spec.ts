import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import en from '../../../i18n/en.json';
import specGolden from '../../../../../core/fixtures/harbor.spec.golden.json';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import type { ShellRouteData } from '../shell/areas';
import { ShellState } from '../shell/shell-state.service';
import type { Tier } from '../shell/tier';
import { SpecHead } from './spec-head';

// T39 · ISC-105, T36 · ISC-149: the spec head's breadcrumb (`workspace / Spec NNN · Area`) and its planning chips (spec 024
// design.md: milestone, feature and priority in the chip row). The e2e proves it in the real app; these specs pin the
// levels, links, the "+n" popover, the archived and unknown-milestone forms against a hand-built planning model.

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
  stageSource: null,
  priority: 'P3',
  hash: null,
  assignee: null,
});
const feature = (id: string, name: string, holders: readonly Holder[], claims: readonly string[]): Feature => ({
  ideas: [],
  id,
  name,
  why: null,
  closed: 0,
  total: claims.length,
  claims: claims.map((claim) => ({ id: claim, text: '', closed: false, dropped: false, holder: holders[0]?.id ?? null })),
  holders,
  unheld: [],
});
const milestone = (name: string, slug: string, specs: readonly Holder[]): Milestone => ({
  ideas: [],
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
  workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: [],
  stageCounts: {},
  ideas: [],
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

function setUp(
  planning: ApiResult<PlanningBody> = ok(PLAN),
  spec: () => ApiResult<unknown> = () => unserved,
  dashboard: unknown = HARBOR,
): void {
  const api = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(dashboard)),
    planning: () => Promise.resolve(planning),
    spec: () => Promise.resolve(spec()),
    reviewedHashes: () => null,
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
const chip = (root: HTMLElement, name: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-head-chips] [data-head-chip="${name}"]`);
const chipNames = (root: HTMLElement): Array<string | null> =>
  [...root.querySelectorAll('[data-head-chips] [data-head-chip]')].map((el) => el.getAttribute('data-head-chip'));
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();

describe('SpecHead breadcrumb (T39, ISC-105; T36, ISC-149)', () => {
  for (const tier of ['wide', 'medium', 'compact'] as const) {
    it(`renders workspace / Spec NNN · Area on every tier, the workspace first (${tier})`, async () => {
      setUp();
      const root = await open('/w/harbor/s/002/status', tier);
      expect(nav(root).getAttribute('aria-label')).toBe(en.planning.breadcrumb.label);
      expect(crumbs(root)).toEqual(['workspace', 'spec', 'area']);
      expect(seps(root)).toEqual([null, 'scope', 'dot']);
      const ws = crumb(root, 'workspace');
      expect(ws?.getAttribute('href')).toBe('/w/harbor');
      expect(text(ws)).toBe('harbor');
      expect(ws?.querySelector('ui-icon[name="arrow-left"]')).not.toBeNull();
      expect(ws?.querySelector('.ws-badge')?.getAttribute('data-mono')).toBe('HA');
      const spec = crumb(root, 'spec');
      expect(spec?.getAttribute('href')).toBe('/w/harbor/s/002');
      expect(text(spec)).toBe('Spec 002');
      expect(spec?.getAttribute('aria-description')).toBe(en.terms.spec);
      expect(crumb(root, 'area')?.getAttribute('aria-current')).toBe('page');
      expect(nav(root).querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      // Milestone, feature and priority left the breadcrumb for the chip row (spec 024, principal 2026-10-12).
      expect(nav(root).querySelector('[data-crumb="milestone"], [data-crumb="feature"], ui-priority')).toBeNull();
    });
  }

  it('puts an open claim last with aria-current and turns the area into a link', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/claims#claim-ISC-1');
    expect(crumbs(root)).toEqual(['workspace', 'spec', 'area', 'claim']);
    expect(seps(root)).toEqual([null, 'scope', 'dot', 'down']);
    const area = crumb(root, 'area');
    expect(area?.tagName).toBe('A');
    expect(area?.getAttribute('href')).toBe('/w/harbor/s/002/claims');
    expect(area?.hasAttribute('aria-current')).toBe(false);
    const claim = crumb(root, 'claim');
    expect(text(claim)).toBe('ISC-1');
    expect(claim?.getAttribute('aria-current')).toBe('page');
    expect(claim?.getAttribute('href')).toBe('/w/harbor/s/002/claims#claim-ISC-1');
    expect(claim?.getAttribute('aria-description')).toBe(en.terms.claim);
    expect(crumb(root, 'spec')?.hasAttribute('aria-current')).toBe(false);
  });

  it('puts an open task last on the tasks tab', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/tasks#task-T12', 'compact');
    const task = crumb(root, 'task');
    expect(text(task)).toBe('T12');
    expect(task?.getAttribute('aria-current')).toBe('page');
    expect(task?.getAttribute('href')).toBe('/w/harbor/s/002/tasks#task-T12');
    expect(task?.getAttribute('aria-description')).toBe(en.terms.task);
  });

  it('marks an archived spec with the archive glyph and an accessible name ending "archived"', async () => {
    setUp();
    const root = await open('/w/harbor/s/001/status');
    expect(crumbs(root)).toEqual(['workspace', 'spec', 'area']);
    const spec = crumb(root, 'spec');
    expect(spec?.querySelector('ui-icon[name="archive"]')).not.toBeNull();
    expect(spec?.getAttribute('aria-label')).toBe(`Spec 001, ${en.planning.breadcrumb.archived}`);
    expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F1');
    expect(root.querySelector('button[data-head-more]')).toBeNull();
  });

  it('keeps the three levels when the planning tree is not loaded, and no planning chips', async () => {
    setUp(unserved);
    const root = await open('/w/harbor/s/002/status');
    expect(crumbs(root)).toEqual(['workspace', 'spec', 'area']);
    expect(chipNames(root)).toEqual(['type', 'stage', 'priority']);
  });
});

describe('SpecHead chip row (T36, ISC-149)', () => {
  it('reads type, stage, pmark, milestone, feature in order, each planning chip linking to its page', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/status');
    expect(chipNames(root)).toEqual(['type', 'stage', 'priority', 'milestone', 'feature']);
    const type = chip(root, 'type');
    expect(type?.getAttribute('data-variant')).toBe('plain');
    expect(type?.querySelector('ui-icon')).not.toBeNull();
    expect(text(type)).toBe('feature');
    const stage = chip(root, 'stage');
    expect(stage?.querySelector('ui-icon')).not.toBeNull();
    expect(text(stage)).toBe(en.stages.build);
    expect(chip(root, 'priority')?.hasAttribute('data-mark')).toBe(true);

    const ms = chip(root, 'milestone');
    expect(ms?.getAttribute('href')).toBe('/w/harbor/milestones#m-v0-3');
    expect(text(ms)).toBe('v0.3');
    expect(ms?.querySelector('ui-chip ui-icon')).not.toBeNull();
    expect(ms?.querySelector('ui-chip')?.getAttribute('data-tone')).toBe('neutral');
    const feat = chip(root, 'feature');
    expect(feat?.getAttribute('href')).toBe('/w/harbor/features#F7');
    expect(text(feat)).toBe('F7');
    expect(feat?.getAttribute('title')).toBe('Planning');
    expect(feat?.getAttribute('aria-description')).toBe(en.terms.feature);
  });

  it('adds a "+2" chip button after the main feature whose popover lists the other held blocks as links', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/status');
    const more = root.querySelector<HTMLButtonElement>('[data-head-chips] button[data-head-more]');
    expect(text(more)).toBe('+2');
    expect(more?.getAttribute('aria-label')).toBe(en.planning.breadcrumb.more.replace('{{count}}', '2'));
    const panelId = more?.getAttribute('aria-controls') ?? '';
    const links = [...root.querySelectorAll<HTMLAnchorElement>(`[id="${panelId}"] a`)];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/w/harbor/features#F0', '/w/harbor/features#F2']);
    expect(links.map(text)).toEqual(['F0 Cross-cutting', 'F2 Web console']);
  });

  it('takes the open claim’s own block as the feature chip', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/claims#claim-ISC-1');
    expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F0');
    const others = root.querySelectorAll<HTMLAnchorElement>('[data-head-chips] ui-popover a');
    expect([...others].map((a) => a.getAttribute('href'))).toEqual(['/w/harbor/features#F2', '/w/harbor/features#F7']);
  });

  it('shows an unknown milestone as a warning chip with triangle-alert, not a link', async () => {
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
    const ms = chip(root, 'milestone');
    expect(ms?.tagName).not.toBe('A');
    expect(ms?.querySelector('ui-chip ui-icon')).not.toBeNull();
    expect(ms?.querySelector('ui-chip')?.getAttribute('data-tone')).toBe('warning');
    expect(text(ms)).toBe('v9');
    expect(ms?.getAttribute('aria-description')).toBe(en.planning.breadcrumb.unknownMilestone);
  });

  // The route's `:id` is every form the server resolves (`core/src/resolve.ts` `resolveSpec`): `NNN`, the folder
  // `NNN-slug` or the bare slug. The spec route answers not-found here, so the head must match the planning holders
  // by the form in the URL alone.
  for (const [form, ref] of [
    ['folder', '002-web-console'],
    ['bare slug', 'web-console'],
  ] as const) {
    it(`renders the milestone and feature chips for the ${form} form in the URL`, async () => {
      setUp();
      const root = await open(`/w/harbor/s/${ref}/status`);
      expect(chip(root, 'milestone')?.getAttribute('href')).toBe('/w/harbor/milestones#m-v0-3');
      expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F7');
      expect(text(root.querySelector('button[data-head-more]'))).toBe('+2');
      expect(text(crumb(root, 'spec'))).toBe('Spec 002');
    });
  }

  for (const [form, ref] of [
    ['folder', '001-manifest-sync'],
    ['bare slug', 'manifest-sync'],
  ] as const) {
    it(`marks an archived spec archived for the ${form} form in the URL`, async () => {
      setUp();
      const root = await open(`/w/harbor/s/${ref}/status`);
      const spec = crumb(root, 'spec');
      expect(spec?.querySelector('ui-icon[name="archive"]')).not.toBeNull();
      expect(spec?.getAttribute('aria-label')).toBe(`Spec 001, ${en.planning.breadcrumb.archived}`);
      expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/features#F1');
    });
  }
});

// T134 · ISC-118, T36 · ISC-149: the priority exactly once in the head, as `pmark` after the stage chip, against the
// harbor spec golden (006 P1; 003 P3; 005's invalid `priority: high`, which core reads as P3).
describe('SpecHead priority (T134, ISC-118; T36, ISC-149)', () => {
  const GOLDEN = specGolden as unknown as Record<string, { head: Record<string, unknown> }>;
  const bodyOf = (folder: string) => ok(GOLDEN[`specs/${folder}`]);
  const headPriority = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('[data-head-chip="priority"]');

  for (const tier of ['wide', 'medium', 'compact'] as const) {
    it(`shows P1 once, as the pmark right after the stage chip (${tier})`, async () => {
      setUp(unserved, () => bodyOf('006-partial-push'));
      const root = await open('/w/harbor/s/006/status', tier);
      expect(root.querySelectorAll('ui-priority')).toHaveLength(1);
      const mark = headPriority(root);
      expect(mark?.getAttribute('data-level')).toBe('P1');
      expect(mark?.hasAttribute('data-mark')).toBe(true);
      expect(mark?.previousElementSibling?.getAttribute('data-head-chip')).toBe('stage');
      expect(mark?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('priority P1');
      expect(mark?.querySelector('ui-icon')).toBeNull();
      expect(text(mark)).toBe('P1');
    });
  }

  it('shows the P3 core delivers for a spec without a priority key as a solid P3', async () => {
    setUp(unserved, () => bodyOf('003-config-loader'));
    const root = await open('/w/harbor/s/003/status');
    expect(headPriority(root)?.getAttribute('data-level')).toBe('P3');
    expect(headPriority(root)?.hasAttribute('data-unmarked')).toBe(false);
  });

  it("reads 005's invalid priority as P3; the head carries no warning indicator, the diagnostic stays core's", async () => {
    setUp(unserved, () => bodyOf('005-config-format-choice'));
    const root = await open('/w/harbor/s/005/status');
    expect(headPriority(root)?.getAttribute('data-level')).toBe('P3');
    expect(root.querySelector('[data-warning], [data-head-chip="warning"]')).toBeNull();
  });

  it('falls back to the dashboard row, then draws an unmarked P3 when no source names a priority', async () => {
    setUp(unserved, () => unserved, { specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build', priority: 'P2' }], archive: [] });
    const fromRow = await open('/w/harbor/s/002/status');
    expect(headPriority(fromRow)?.getAttribute('data-level')).toBe('P2');
    TestBed.resetTestingModule();
    setUp(unserved);
    const none = await open('/w/harbor/s/002/status');
    expect(headPriority(none)?.getAttribute('data-level')).toBe('P3');
    expect(headPriority(none)?.hasAttribute('data-unmarked')).toBe(true);
  });
});
