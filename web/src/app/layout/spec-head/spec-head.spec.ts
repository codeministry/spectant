import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import type { SpecWait, TasksTab } from '../../../../../core/src/files';
import specGolden from '../../../../../core/fixtures/harbor.spec.golden.json';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import type { ShellRouteData } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
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
  rank: 1,
  priority: 'P3',
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
  asOf: '2026-03-20', workflow: { rows: [], source: 'default', diagnostics: [] },
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
  favorites: readonly string[] = [],
): void {
  const api = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(dashboard)),
    planning: () => Promise.resolve(planning),
    spec: () => Promise.resolve(spec()),
    reviewedHashes: () => null,
    // Spec 052 (T16): the favourites route answers the stored set; a write answers the set it leaves.
    favorites: () => Promise.resolve(ok({ specs: favorites, ideas: [] })),
    putFavorite: (_ws: string, id: string) => Promise.resolve(ok({ specs: [...favorites, id].sort(), ideas: [] })),
    deleteFavorite: (_ws: string, id: string) => Promise.resolve(ok({ specs: favorites.filter((other) => other !== id), ideas: [] })),
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
      // Spec 058 (ISC-395): the Workspace crumb means the workspace, its dashboard at `/w/<ws>`.
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
    expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/planning/tree?sel=feature:F1');
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
    expect(ms?.getAttribute('href')).toBe('/w/harbor/planning/tree?sel=milestone:v0-3');
    expect(text(ms)).toBe('v0.3');
    expect(ms?.querySelector('ui-chip ui-icon')).not.toBeNull();
    expect(ms?.querySelector('ui-chip')?.getAttribute('data-tone')).toBe('neutral');
    const feat = chip(root, 'feature');
    expect(feat?.getAttribute('href')).toBe('/w/harbor/planning/tree?sel=feature:F7');
    expect(text(feat)).toBe('F7');
    expect(feat?.getAttribute('title')).toBe('Planning');
    expect(feat?.getAttribute('aria-description')).toBe(en.terms.feature);
  });

  it('adds a "+2" chip button after the main feature whose popover lists the other held blocks as links', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/status');
    const more = root.querySelector<HTMLButtonElement>('[data-head-chips] button[data-head-more]');
    expect(text(more)).toBe('+2');
    expect(more?.getAttribute('aria-label')).toBe(en.planning.breadcrumb.more.other.replace('{{count}}', '2'));
    const panelId = more?.getAttribute('aria-controls') ?? '';
    const links = [...root.querySelectorAll<HTMLAnchorElement>(`[id="${panelId}"] a`)];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/w/harbor/planning/tree?sel=feature:F0', '/w/harbor/planning/tree?sel=feature:F2']);
    expect(links.map(text)).toEqual(['F0 Cross-cutting', 'F2 Web console']);
  });

  it('takes the open claim’s own block as the feature chip', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/claims#claim-ISC-1');
    expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/planning/tree?sel=feature:F0');
    const others = root.querySelectorAll<HTMLAnchorElement>('[data-head-chips] ui-popover a');
    expect([...others].map((a) => a.getAttribute('href'))).toEqual(['/w/harbor/planning/tree?sel=feature:F2', '/w/harbor/planning/tree?sel=feature:F7']);
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
      expect(chip(root, 'milestone')?.getAttribute('href')).toBe('/w/harbor/planning/tree?sel=milestone:v0-3');
      expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/planning/tree?sel=feature:F7');
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
      expect(chip(root, 'feature')?.getAttribute('href')).toBe('/w/harbor/planning/tree?sel=feature:F1');
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

// T34, T35 · ISC-175, ISC-181 (spec 027 design.md § Across viewports 1, source hint): the provenance line —
// the worktree chip, the source note and the "No agent source" text, in that order; nothing of it without a worktree.
describe('SpecHead provenance line (T34, T35, ISC-175, ISC-181)', () => {
  type Body = { head: Record<string, unknown>; warnings: unknown[]; keyNumbers: { claims: { closed: number; total: number } } };
  const GOLDEN = specGolden as unknown as Record<string, Body>;
  const WORKTREE = { path: '.worktrees/002-web-console', branch: 'feature/002-web-console', spec: '002', ahead: 2, dirty: true, kind: 'spec' };
  const MAIN = { stage: 'build', progress: { closed: 23, total: 30 } };
  const MISMATCH = { kind: 'worktree-branch-mismatch', text: 'branch names another spec', ref: WORKTREE.path };
  const with002 = (head: Record<string, unknown>, warnings: unknown[] = []) => {
    const golden = GOLDEN['specs/002-web-console'];
    return ok({ ...golden, head: { ...golden.head, ...head }, warnings: [...golden.warnings, ...warnings] });
  };
  const chip = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('ui-worktree-chip[data-head-worktree]');
  const note = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('[data-source-note]');

  it('shows the full chip with branch, ↑2 and ± for a spec with a worktree', async () => {
    setUp(unserved, () => with002({ worktree: WORKTREE }));
    const root = await open('/w/harbor/s/002/status');
    const found = chip(root);
    expect(found?.getAttribute('data-form')).toBe('full');
    expect(found?.hasAttribute('data-mismatch')).toBe(false);
    expect(text(found)).toContain('feature/002-web-console');
    expect(text(found)).toContain('↑2');
    expect(text(found)).toContain('±');
    // Read from main: the chip, no source note; the "No agent source" text keeps its place behind the chip.
    expect(note(root)).toBeNull();
    const line = root.querySelector<HTMLElement>('[data-provenance]');
    expect(line?.firstElementChild).toBe(found);
    expect(text(line?.querySelector('[data-no-source-line]') ?? null)).toBe(en.specHead.noSource);
  });

  it('shows no chip, no note and the unchanged "No agent source" line without a worktree', async () => {
    setUp(unserved, () => ok(GOLDEN['specs/004-retention-policies']));
    const root = await open('/w/harbor/s/004/status');
    expect(root.querySelector('ui-worktree-chip')).toBeNull();
    expect(note(root)).toBeNull();
    expect(root.querySelector('[data-provenance]')).toBeNull();
    const line = root.querySelector<HTMLElement>('[data-no-source-line]');
    // Spec 021 T38 (ISC-250): a part of the one meta line, no line of its own.
    expect(line?.classList.contains('no-source')).toBe(true);
    expect(line?.parentElement?.hasAttribute('data-meta')).toBe(true);
    expect(text(line)).toBe(en.specHead.noSource);
  });

  it("puts the source note between chip and agent text, main's stage as an outline chip and n/m", async () => {
    setUp(unserved, () => with002({ worktree: WORKTREE, source: 'worktree', stage: 'plan', main: MAIN }));
    const root = await open('/w/harbor/s/002/status');
    const found = note(root);
    // Segments: the separators are drawn between them, so the text is read per segment.
    expect([...(found?.children ?? [])].map(text)).toEqual([en.specHead.source.read, `${en.specHead.source.main} ${en.stages.build}`, '23/30']);
    const stage = found?.querySelector<HTMLElement>('ui-chip[data-main-stage]') ?? null;
    expect(text(stage)).toBe(en.stages.build);
    expect(stage?.getAttribute('data-tone')).toBe('neutral');
    expect(text(found?.querySelector('[data-main-progress]') ?? null)).toBe('23/30');
    // The copy's own stage chip in the chip row stays the filled one.
    expect(text(root.querySelector('[data-head-chip="stage"]'))).toBe(en.stages.plan);
    const parts = [...(root.querySelector('[data-provenance]')?.querySelectorAll('[data-head-worktree], [data-source-note], [data-no-source-line]') ?? [])];
    expect(parts.map((el) => el.getAttribute('data-head-worktree') !== null ? 'chip' : el.hasAttribute('data-source-note') ? 'note' : 'agent')).toEqual(['chip', 'note', 'agent']);
  });

  it('reads "main equal" when main matches the copy in stage and progress', async () => {
    const { closed, total } = GOLDEN['specs/002-web-console'].keyNumbers.claims;
    setUp(unserved, () => with002({ worktree: WORKTREE, source: 'worktree', stage: 'build', main: { stage: 'build', progress: { closed, total } } }));
    const root = await open('/w/harbor/s/002/status');
    expect([...(note(root)?.children ?? [])].map(text)).toEqual([en.specHead.source.read, en.specHead.source.equal]);
    expect(note(root)?.querySelector('[data-main-stage]')).toBeNull();
  });

  it('turns the chip to the warning tone on a worktree-branch-mismatch warning', async () => {
    setUp(unserved, () => with002({ worktree: WORKTREE }, [MISMATCH]));
    const root = await open('/w/harbor/s/002/status');
    expect(chip(root)?.hasAttribute('data-mismatch')).toBe(true);
  });

  it("passes the shell's tier: a bottom sheet at compact, a popover at medium and wide", async () => {
    for (const [tier, overlay] of [['compact', 'ui-sheet'], ['medium', 'ui-popover'], ['wide', 'ui-popover']] as const) {
      TestBed.resetTestingModule();
      setUp(unserved, () => with002({ worktree: WORKTREE }));
      const root = await open('/w/harbor/s/002/status', tier);
      expect(chip(root)?.querySelector(overlay) ?? null).not.toBeNull();
    }
  });

  // Spec 021 T38 (ISC-250): the command chip moved into the title row, so the meta line's chip now follows it.
  it('comes after the breadcrumb and the title row’s command chip in tab order', async () => {
    setUp(unserved, () => with002({ worktree: WORKTREE }));
    const root = await open('/w/harbor/s/002/status');
    const trigger = chip(root)?.querySelector('button') ?? null;
    const command = root.querySelector('[data-head-command]');
    expect(trigger).not.toBeNull();
    expect(nav(root).compareDocumentPosition(trigger as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((command as Node).compareDocumentPosition(trigger as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// Spec 025, T22 · ISC-163 (design.md § Spec head): the waits chip in the chip row right after the priority mark; a
// partial hold keeps the stage and shows the scope behind the chip, a full one stands on `blocked` with the chip alone.
describe('SpecHead waits chip (T22, ISC-163)', () => {
  type Body = { head: Record<string, unknown> };
  const GOLDEN = specGolden as unknown as Record<string, Body>;
  const with002 = (head: Record<string, unknown>) => {
    const golden = GOLDEN['specs/002-web-console'];
    return ok({ ...golden, head: { ...golden.head, ...head } });
  };
  const DASHBOARD = { ...HARBOR, specs: [...HARBOR.specs, { id: '006', title: 'Search index', type: 'feature', stage: 'review' }] };
  const waits = (root: HTMLElement): HTMLElement | null => chip(root, 'waits');

  it('shows "waits on 006" after the priority with the scope as separate meta, the stage kept (partial)', async () => {
    const partial = { spec: '002', blockers: ['006'], heldTasks: 4, readyTasks: 3, openTasks: 7, full: false };
    setUp(unserved, () => with002({ stage: 'build', waits: partial }), DASHBOARD);
    const root = await open('/w/harbor/s/002/status');
    expect(chipNames(root).slice(0, 4)).toEqual(['type', 'stage', 'priority', 'waits']);
    expect(text(chip(root, 'stage'))).toBe(en.stages.build);
    const link = waits(root)?.querySelector<HTMLElement>('a[data-waits]') ?? null;
    expect(text(link)).toBe('waits on 006');
    expect(link?.getAttribute('href')).toBe('/w/harbor/s/006');
    expect(link?.getAttribute('aria-label')).toBe('Waits on spec 006, Search index');
    expect(text(waits(root)?.querySelector('[data-waits-meta]') ?? null)).toBe('· 4 waiting · 3 open');
  });

  it('stands on blocked with the chip and no meta (full)', async () => {
    const full = { spec: '002', blockers: ['006'], heldTasks: 7, readyTasks: 0, openTasks: 7, full: true };
    setUp(unserved, () => with002({ stage: 'blocked', waits: full }), DASHBOARD);
    const root = await open('/w/harbor/s/002/status');
    expect(text(chip(root, 'stage'))).toBe(en.stages.blocked);
    expect(text(waits(root)?.querySelector('[data-waits]') ?? null)).toBe('waits on 006');
    expect(waits(root)?.querySelector('[data-waits-meta]')).toBeNull();
  });

  it('shows the overlap line in the heads of both specs, each with its own edge (T29, ISC-164.1)', async () => {
    const PATHS = ['web/src/app/retention/a.ts', 'web/src/app/retention/b.ts', 'web/src/app/retention/c.ts', 'web/src/app/retention/d.ts'];
    const overlap = { specs: ['002', '004'], paths: PATHS, waiting: '002', edge: '(after: 004)' };
    const rows = [
      { id: '002', title: 'Web console', type: 'feature', stage: 'build', warnings: [{ kind: 'spec-overlap', text: 'shares 4 files with 004, no edge', overlap }] },
      { id: '004', title: 'Retention', type: 'feature', stage: 'plan', warnings: [] },
    ];
    const lineOf = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-head-overlaps] [data-overlap-line]');
    for (const [id, other, edge] of [
      ['002', '004', '(after: 004)'],
      ['004', '002', '(after: 002)'],
    ] as const) {
      TestBed.resetTestingModule();
      setUp(unserved, () => unserved, { ...HARBOR, specs: rows });
      const root = await open(`/w/harbor/s/${id}/status`);
      const line = lineOf(root);
      expect(line?.id).toBe(`overlap-${other}`);
      expect(text(line?.querySelector('[data-overlap-text]') ?? null)).toBe(`Shares 4 files with ${other}, no edge`);
      expect(line?.querySelector('a[data-overlap-other]')?.getAttribute('href')).toBe(`/w/harbor/s/${other}`);
      // Spec 021 T37 (ISC-250): inside the head's one overlaps disclosure every path stands, no "+n more" of its own.
      expect([...(line?.querySelectorAll('[data-overlap-path]') ?? [])].map((p) => text(p))).toEqual(PATHS);
      expect(text(line?.querySelector('[data-overlap-edge] code') ?? null)).toBe(edge);
      expect(line?.querySelector('[data-overlap-more]')).toBeNull();
    }
  });

  it('shows nothing once the edge is met (waits null)', async () => {
    setUp(unserved, () => with002({ waits: null }), DASHBOARD);
    const root = await open('/w/harbor/s/002/status');
    expect(root.querySelector('ui-waits-chip')).toBeNull();
    expect(chipNames(root)).not.toContain('waits');
  });
});

// Spec 021, T37 and T38 · ISC-250 (design.md § Spec dashboard per viewport, § Across viewports, head height): the head
// keeps its height down: every overlap in one collapsed disclosure whose state lives in `?open=overlaps`, one meta line,
// the next command and Notes in the title row, the goal clamped with a toggle that names the goal of its spec (ISC-248).
describe('SpecHead density (T37, T38, ISC-250)', () => {
  type Body = { head: Record<string, unknown>; ideaQuote: string | null };
  const GOLDEN = specGolden as unknown as Record<string, Body>;
  const with002 = () => ok(GOLDEN['specs/002-web-console']);
  const PATHS = ['web/src/app/a.ts', 'web/src/app/b.ts', 'web/src/app/c.ts', 'web/src/app/d.ts'];
  const pair = (other: string) => ({
    kind: 'spec-overlap',
    text: `shares 4 files with ${other}, no edge`,
    overlap: { specs: ['002', other], paths: PATHS, waiting: '002', edge: `(after: ${other})` },
  });
  const rowsWith = (others: readonly string[]) => ({
    ...HARBOR,
    specs: [
      { id: '002', title: 'Web console', type: 'feature', stage: 'build', warnings: others.map(pair) },
      ...others.map((id) => ({ id, title: id, type: 'feature', stage: 'plan', warnings: [] })),
    ],
  });
  const fold = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('ui-disclosure[data-head-overlap-fold]');
  const summary = (root: HTMLElement): HTMLButtonElement | null => fold(root)?.querySelector<HTMLButtonElement>('button[aria-expanded]') ?? null;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('folds every overlap into one collapsed "N overlaps" disclosure inside the head (T37)', async () => {
    setUp(unserved, with002, rowsWith(['004', '006', '009']));
    const root = await open('/w/harbor/s/002/status');
    expect(root.querySelectorAll('ui-disclosure[data-head-overlap-fold]')).toHaveLength(1);
    expect(text(summary(root))).toBe('3 overlaps');
    expect(summary(root)?.getAttribute('aria-expanded')).toBe('false');
    expect(fold(root)?.hasAttribute('data-open')).toBe(false);
    // Inside: every line and every path, no second fold ("+n more overlaps", "+n more").
    const lines = [...(fold(root)?.querySelectorAll('[data-head-overlaps] [data-overlap-line]') ?? [])];
    expect(lines.map((line) => line.id)).toEqual(['overlap-004', 'overlap-006', 'overlap-009']);
    expect(fold(root)?.querySelector('[data-overlaps-more]')).toBeNull();
    expect(fold(root)?.querySelector('[data-overlap-more]')).toBeNull();
    expect(lines[0]?.querySelectorAll('[data-overlap-path]')).toHaveLength(4);
  });

  it('reads the singular for one overlap', async () => {
    setUp(unserved, with002, rowsWith(['004']));
    const root = await open('/w/harbor/s/002/status');
    expect(text(summary(root))).toBe('1 overlap');
  });

  it('keeps the open state in ?open=overlaps, on every tab (T37)', async () => {
    setUp(unserved, with002, rowsWith(['004', '006']));
    const root = await open('/w/harbor/s/002/claims?open=overlaps');
    expect(fold(root)?.hasAttribute('data-open')).toBe(true);
    const router = TestBed.inject(Router);
    summary(root)?.click();
    await settle();
    expect(router.url).toBe('/w/harbor/s/002/claims');
    summary(root)?.click();
    await settle();
    expect(router.url).toBe('/w/harbor/s/002/claims?open=overlaps');
  });

  it('renders no fold without an overlap', async () => {
    setUp(unserved, with002);
    const root = await open('/w/harbor/s/002/status');
    expect(fold(root)).toBeNull();
  });

  it('draws one meta line: updated, round and the "No agent source" text together (T38)', async () => {
    setUp(unserved, with002);
    const root = await open('/w/harbor/s/002/status');
    expect(root.querySelectorAll('[data-meta]')).toHaveLength(1);
    const line = root.querySelector<HTMLElement>('[data-meta]');
    expect(line?.querySelector('[data-no-source-line]')).not.toBeNull();
    expect(text(line)).toContain('round 3');
    expect(text(line)).toContain(en.specHead.noSource);
  });

  it('puts the next command and Notes into the title row, after the title (T38)', async () => {
    setUp(unserved, with002);
    const root = await open('/w/harbor/s/002/status');
    const row = root.querySelector<HTMLElement>('[data-title-row]');
    expect(row).not.toBeNull();
    expect(row?.querySelector('h1#spec-title')).not.toBeNull();
    expect(row?.querySelector('[data-head-actions] [data-head-command]')).not.toBeNull();
    expect(row?.querySelector('[data-head-actions] [data-notes-pill]')).not.toBeNull();
  });

  for (const tier of ['compact', 'wide'] as const) {
    it(`clamps the goal with uiClamp, the toggle shows "More…" and is named "More… goal of 002" (${tier}, T38)`, async () => {
      const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
        return this.textContent.length > 40 ? 400 : 10;
      });
      try {
        setUp(unserved, with002);
        const root = await open('/w/harbor/s/002/status', tier);
        const goal = root.querySelector<HTMLElement>('[data-description]');
        expect(goal?.getAttribute('data-clamp')).toBe('cut');
        const toggle = root.querySelector<HTMLButtonElement>('button[data-more]');
        expect(text(toggle)).toBe(en.specHead.more);
        expect(toggle?.getAttribute('aria-label')).toBe('More… goal of 002');
        expect(toggle?.getAttribute('aria-controls')).toBe(goal?.id);
        expect(toggle?.getAttribute('aria-expanded')).toBe('false');
        toggle?.click();
        await settle();
        await settle();
        expect(goal?.getAttribute('data-clamp')).toBe('open');
        expect(toggle?.getAttribute('aria-expanded')).toBe('true');
        // T67: the name follows the visible word once open (label in name).
        expect(text(toggle)).toBe(en.specHead.less);
        expect(toggle?.getAttribute('aria-label')).toBe('Less, goal of 002');
        expect(text(goal)).toBe(GOLDEN['specs/002-web-console'].ideaQuote);
      } finally {
        height.mockRestore();
      }
    });
  }
});

// Spec 021, T64b · ISC-252.1: the waits scope in the spec head counts in the Tasks tab's units, the `held` and `open`
// status chips, so no number in the head reads as open tasks when it means held ones; in en and de. One spec model: 002
// has seven open tasks, four held by `(after: 006)` and three open. The tab's chips read `counts.byStatus`; core derives
// `SpecWait.heldTasks` / `readyTasks` from that same tab model (core/tests/spec-waits-tab.test.ts), and `openTasks` (7)
// is neither chip, so a head that showed it would fail here.
describe('SpecHead waits scope (T64b, ISC-252.1)', () => {
  type Body = { head: Record<string, unknown> };
  const GOLDEN = specGolden as unknown as Record<string, Body>;
  const counts: Pick<TasksTab['counts'], 'byStatus'> = {
    byStatus: [
      { name: 'open', count: 3 },
      { name: 'held', count: 4 },
      { name: 'done', count: 0 },
    ],
  };
  const chipCount = (name: string): number => counts.byStatus.find((c) => c.name === name)?.count ?? 0;
  const partial: SpecWait = { spec: '002', blockers: ['006'], heldTasks: chipCount('held'), readyTasks: chipCount('open'), openTasks: 7, full: false };
  const with002 = () => {
    const golden = GOLDEN['specs/002-web-console'];
    return ok({ ...golden, head: { ...golden.head, stage: 'build', waits: partial } });
  };
  const DASHBOARD = { ...HARBOR, specs: [...HARBOR.specs, { id: '006', title: 'Search index', type: 'feature', stage: 'review' }] };
  const CASES = [
    ['en', '· 4 waiting · 3 open', en.tasks.status.open],
    ['de', '· 4 warten · 3 offen', de.tasks.status.open],
  ] as const;

  for (const [lang, expected, openWord] of CASES) {
    it(`spec-head waits count: 4 held and 3 open, the tasks tab's chips (${lang})`, async () => {
      setUp(unserved, with002, DASHBOARD);
      TestBed.inject(TranslocoService).setActiveLang(lang);
      const root = await open('/w/harbor/s/002/status');
      const meta = text(chip(root, 'waits')?.querySelector('[data-waits-meta]') ?? null);
      expect(meta).toBe(expected);
      // The open count carries the open chip's own word, never "open tasks" around a held count.
      expect(meta.endsWith(` ${openWord}`)).toBe(true);
      // The numbers are the tab's `held` chip, then its `open` chip, of the same tasks.
      expect(meta.match(/\d+/gu)).toEqual([String(chipCount('held')), String(chipCount('open'))]);
    });
  }
});

// Spec 021, T67 · ISC-250 (design.md § Mobile, spec dashboard item 2): at compact the meta line, the next command and
// Notes fold into one collapsed "Details of NNN"; the overlaps keep their own fold in the head; medium and wide unchanged.
describe('SpecHead details at compact (T67, ISC-250)', () => {
  type Body = { head: Record<string, unknown> };
  const GOLDEN = specGolden as unknown as Record<string, Body>;
  const with002 = () => ok(GOLDEN['specs/002-web-console']);
  const overlap = { specs: ['002', '004'], paths: ['web/a.ts'], waiting: '002', edge: '(after: 004)' };
  const overlapRows = {
    ...HARBOR,
    specs: [
      { id: '002', title: 'Web console', type: 'feature', stage: 'build', warnings: [{ kind: 'spec-overlap', text: 'shares 1 file with 004, no edge', overlap }] },
      { id: '004', title: 'Search', type: 'feature', stage: 'plan', warnings: [] },
    ],
  };
  const details = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('ui-disclosure[data-head-details]');
  const toggle = (root: HTMLElement): HTMLButtonElement | null => details(root)?.querySelector<HTMLButtonElement>('button[aria-expanded]') ?? null;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('folds the meta line, the next command and Notes into a collapsed "Details of 002" at compact', async () => {
    setUp(unserved, with002, overlapRows);
    const root = await open('/w/harbor/s/002/status', 'compact');
    expect(root.querySelectorAll('ui-disclosure[data-head-details]')).toHaveLength(1);
    expect(text(toggle(root))).toBe('Details of 002');
    expect(toggle(root)?.getAttribute('aria-expanded')).toBe('false');
    // Out of the title row, into the details.
    const row = root.querySelector<HTMLElement>('[data-title-row]');
    expect(row?.querySelector('[data-head-command]')).toBeNull();
    expect(row?.querySelector('[data-notes-pill]')).toBeNull();
    expect(details(root)?.querySelector('[data-meta]')).not.toBeNull();
    expect(details(root)?.querySelector('[data-head-details-actions] [data-head-command]')).not.toBeNull();
    expect(details(root)?.querySelector('[data-head-details-actions] [data-notes-pill]')).not.toBeNull();
    expect(root.querySelectorAll('[data-meta]')).toHaveLength(1);
    // The overlaps keep their own fold in the head, outside the details.
    expect(root.querySelector('ui-disclosure[data-head-overlap-fold]')).not.toBeNull();
    expect(details(root)?.querySelector('[data-head-overlap-fold]')).toBeNull();
    toggle(root)?.click();
    await settle();
    expect(details(root)?.hasAttribute('data-open')).toBe(true);
    expect(toggle(root)?.getAttribute('aria-expanded')).toBe('true');
  });

  // Spec 021 T70 (ISC-250): the title row's one action at compact is the gate button, icon only beside the title; its
  // label stays its accessible name, so it never wraps under the title. Medium and wide keep the 32 px inline button.
  // Spec 069 T35 (ISC-598): the favourite star left the title row for the chip row, so the gate is its only action.
  it('keeps the gate button beside the title at compact, icon only, its label as its name', async () => {
    setUp(unserved, with002);
    const root = await open('/w/harbor/s/002/status', 'compact');
    const row = root.querySelector<HTMLElement>('[data-title-row]');
    const gate = row?.querySelector<HTMLElement>('[data-head-actions] app-gate-button');
    expect(gate?.getAttribute('data-size')).toBe('icon');
    expect([...(row?.querySelectorAll('[data-head-actions] > *') ?? [])].map((el) => el.localName)).toEqual(['app-gate-button']);
    expect(text(gate?.querySelector('[data-gate-action] .gate-label') ?? null)).toBe('Re-mark');
    expect(details(root)?.querySelector('app-gate-button')).toBeNull();
  });

  for (const tier of ['medium', 'wide'] as const) {
    it(`keeps the inline gate button with its visible label (${tier})`, async () => {
      setUp(unserved, with002);
      const root = await open('/w/harbor/s/002/status', tier);
      expect(root.querySelector('[data-title-row] [data-head-actions] app-gate-button')?.getAttribute('data-size')).toBe('inline');
    });
  }

  it('reads "Details zu 002" in German', async () => {
    setUp(unserved, with002);
    TestBed.inject(TranslocoService).setActiveLang('de');
    const root = await open('/w/harbor/s/002/status', 'compact');
    expect(text(toggle(root))).toBe('Details zu 002');
  });

  for (const tier of ['medium', 'wide'] as const) {
    it(`keeps the command and Notes in the title row and the meta line visible, no details (${tier})`, async () => {
      setUp(unserved, with002);
      const root = await open('/w/harbor/s/002/status', tier);
      expect(details(root)).toBeNull();
      const row = root.querySelector<HTMLElement>('[data-title-row]');
      expect(row?.querySelector('[data-head-actions] [data-head-command]')).not.toBeNull();
      expect(row?.querySelector('[data-head-actions] [data-notes-pill]')).not.toBeNull();
      expect(root.querySelector('.meta-row > [data-meta]')).not.toBeNull();
    });
  }
});

// Spec 052, T16 · ISC-300 (design.md § Mobile, Tablet, Desktop: spec head), moved by spec 069 T35 (ISC-598): the
// favourite star is the first child of the chip row over the title on every tier, directly before the type chip (the
// stage chip without a type), the 28 px box level with the chips; the title row's actions hold no star, and it never
// moves into "Details of NNN". Its pressed state is `ShellData.isFavorite` of the open spec's folder, a
// click hands that folder (never the bare id) to `ShellData.toggleFavorite`, and an archived spec shows no star.
describe('SpecHead favourite star (T16, ISC-300; spec 069 T35, ISC-598)', () => {
  type Body = { head: Record<string, unknown> };
  const GOLDEN = specGolden as unknown as Record<string, Body>;
  const with002 = () => ok(GOLDEN['specs/002-web-console']);
  const star = (root: HTMLElement): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>('[data-head-chips] > button[ui-star-toggle]');
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  // The same golden head without a type, and a dashboard row without one: the stage chip then follows the star.
  const golden002 = GOLDEN['specs/002-web-console'];
  const untyped = () => ok({ ...golden002, head: { ...golden002.head, type: null } });
  const UNTYPED_ROWS = { ...HARBOR, specs: [{ id: '002', title: 'Web console', stage: 'build' }] };
  const CASES = [
    { name: 'with a type', body: with002, rows: HARBOR, next: 'type' },
    { name: 'without a type', body: untyped, rows: UNTYPED_ROWS, next: 'stage' },
  ] as const;

  for (const tier of ['compact', 'medium', 'wide'] as const) {
    for (const { name, body, rows, next } of CASES) {
      it(`puts the star first in the chip row, before the ${next} chip, none in the title row (${name}, ${tier})`, async () => {
        setUp(unserved, body, rows);
        const root = await open('/w/harbor/s/002/status', tier);
        const chips = root.querySelector<HTMLElement>('[data-head-chips]');
        expect(star(root)).not.toBeNull();
        expect(chips?.firstElementChild).toBe(star(root));
        expect(star(root)?.nextElementSibling?.getAttribute('data-head-chip')).toBe(next);
        expect(chip(root, 'type') === null).toBe(next === 'stage');
        expect(root.querySelectorAll('[data-head-actions] [ui-star-toggle]')).toHaveLength(0);
        expect(root.querySelectorAll('[ui-star-toggle]')).toHaveLength(1);
        expect(star(root)?.getAttribute('data-size')).toBe('head');
        expect(star(root)?.getAttribute('aria-label')).toBe('Favorite: 002 Web console');
        expect(star(root)?.getAttribute('aria-pressed')).toBe('false');
        expect(root.querySelector('ui-disclosure[data-head-details] [ui-star-toggle]')).toBeNull();
        star(root)?.click();
        await settle();
        await settle();
        expect(star(root)?.getAttribute('aria-pressed')).toBe('true');
      });
    }
  }

  it('reads pressed from ShellData.isFavorite of the folder slug', async () => {
    setUp(unserved, with002, HARBOR, ['002-web-console']);
    const root = await open('/w/harbor/s/002/status');
    expect(TestBed.inject(ShellData).isFavorite('002-web-console')).toBe(true);
    expect(star(root)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('hands the folder slug to ShellData.toggleFavorite on a click and shows the new state', async () => {
    setUp(unserved, with002);
    const root = await open('/w/harbor/s/002/status');
    const toggle = vi.spyOn(TestBed.inject(ShellData), 'toggleFavorite');
    star(root)?.click();
    await settle();
    await settle();
    expect(toggle).toHaveBeenCalledExactlyOnceWith('002-web-console');
    expect(star(root)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows no star on an archived spec', async () => {
    setUp(ok(PLAN), () => unserved, HARBOR, ['001-manifest-sync']);
    const root = await open('/w/harbor/s/001');
    expect(crumb(root, 'spec')?.querySelector('ui-icon[name="archive"]')).not.toBeNull();
    expect(root.querySelector('[ui-star-toggle]')).toBeNull();
  });
});
