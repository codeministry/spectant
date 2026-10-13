import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harborPlanning from '../../../../../core/fixtures/harbor.planning.golden.json';
import type { PlanningFeature, PlanningHolder } from '../../../../../core/src/planning';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { vi } from 'vitest';
import { FeaturesPage } from './features-page';

// T32 · ISC-103: the Features page renders the planning tree as it is served: one card per feature block in master
// order, the recount in the meta line, the holding specs as chips (main → other → archived) and the unheld count. The
// e2e tier (`bun run e2e -- features`, T33) proves the same against the harbor golden in a real browser.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const DASHBOARD = {
  specs: [
    { id: '002', title: 'Web console', type: 'feature', stage: 'build' },
    { id: '003', title: 'Config loader', type: 'feature', stage: 'plan' },
    { id: '004', title: 'Retention', type: 'feature', stage: 'close' },
    { id: '005', title: 'Config schema', type: 'feature', stage: 'tasks' },
    { id: '006', title: 'Cross-cutting', type: 'feature', stage: 'review' },
  ],
  archive: [{ id: '001', title: 'Manifest sync', type: 'feature' }],
};

const holder = (id: string, over: Partial<PlanningHolder> = {}): PlanningHolder => ({
  id,
  slug: `${id}-x`,
  title: 'x',
  archived: false,
  main: false,
  held: 1,
  stage: null,
  stageSource: null,
  priority: 'P3',
  hash: null,
  assignee: null,
  ...over,
});

const feature = (id: string, name: string, over: Partial<PlanningFeature> = {}): PlanningFeature => ({
  ideas: [],
  id,
  name,
  why: null,
  closed: 0,
  total: 0,
  claims: [],
  holders: [],
  unheld: [],
  ...over,
});

const WHY = 'what would sink Harbor whichever feature slipped — the invariants every spec inherits, written once';

/** Core's holder order is active by id, archived last; the page puts the main holder first. */
const FEATURES: readonly PlanningFeature[] = [
  feature('F0', 'Cross-cutting', { why: WHY, closed: 0, total: 4, holders: [holder('006', { main: true })], unheld: ['ISC-4'] }),
  feature('F1', 'Manifest sync', { closed: 46, total: 46, holders: [holder('001', { main: true, archived: true })] }),
  feature('F2', 'Web console', {
    closed: 25,
    total: 30,
    holders: [
      holder('002', { main: true }),
      holder('003'),
      holder('004'),
      holder('005'),
      holder('006'),
      holder('001', { archived: true }),
    ],
    claims: [
      { id: 'ISC-12', text: 'the console lists every run', closed: false, dropped: false, holder: null },
      { id: 'ISC-13', text: 'a failed run links its log', closed: false, dropped: false, holder: null },
    ],
    unheld: ['ISC-12', 'ISC-13'],
  }),
  feature('F3', 'Config loader rewrite', {
    closed: 0,
    total: 14,
    holders: [holder('003'), holder('005', { main: true }), holder('001', { archived: true })],
  }),
  feature('F4', 'Retention policies', { holders: [holder('003', { main: true }), holder('004', { main: true })] }),
];

const planning = (features: readonly PlanningFeature[]): PlanningBody => ({
  workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: [],
  stageCounts: {},
  ideas: [],
  features,
  milestones: [],
  recount: { closed: 71, total: 94 },
  diagnostics: [],
});

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec'>;

function setUp(plan: Promise<ApiResult<PlanningBody>>): void {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(DASHBOARD) : { kind: 'not-found', served: true }),
    planning: () => plan,
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

/** The harness of the last `open`, so a test can settle the view after a click. */
let harness: RouterTestingHarness;

async function open(url: string, tier: Tier = 'wide', body: PlanningBody = planning(FEATURES)): Promise<HTMLElement> {
  setUp(Promise.resolve(ok(body)));
  TestBed.inject(ShellState).tier.set(tier);
  harness = await RouterTestingHarness.create();
  document.body.appendChild(harness.fixture.nativeElement as HTMLElement);
  await harness.navigateByUrl(url);
  await settle();
  return harness.fixture.nativeElement as HTMLElement;
}

async function settle(): Promise<void> {
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
}

const page = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>('app-features-page') ?? (() => { throw new Error('features page missing'); })();
const row = (root: HTMLElement, id: string): HTMLElement =>
  root.querySelector<HTMLElement>(`article#${id}`) ?? (() => { throw new Error(`row ${id} missing`); })();
/** The text a sighted reader sees: the closed hint popovers of `ui-term` removed, whitespace collapsed. */
const visible = (el: Element | null): string => {
  if (!el) return '';
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[role="tooltip"]').forEach((node) => {
    node.remove();
  });
  return copy.textContent.replace(/\s+/g, ' ').trim();
};
/** A chip's visible words, one per flex item (its gap, not a space character, separates them). */
const words = (el: Element | undefined): string =>
  [...(el?.querySelectorAll('span:not(.dot)') ?? [])].map((s) => s.textContent.trim()).join(' ');
const chips = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('ul.holders app-spec-chip')];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('FeaturesPage (T32, ISC-103)', () => {
  it('heads the page with the level word as a glossary term and the recount in the meta line', async () => {
    const root = page(await open('/w/harbor/features'));
    const h1 = root.querySelector('h1#features');
    expect(h1?.getAttribute('tabindex')).toBe('-1');
    // ISC-142: the h1 is the title only; the glossary term is its own trigger beside it.
    expect(h1?.textContent.trim()).toBe('Features');
    expect(h1?.querySelector('ui-term')).toBeNull();
    const term = root.querySelector('ui-term[data-features-term]');
    expect(term?.querySelector('dfn')?.textContent.trim()).toBe('Features');
    expect(term?.querySelector('[role="tooltip"]')?.textContent.trim()).toBe('Epic in a ticket tracker');

    const meta = root.querySelector('p.meta');
    // The "·" separators are generated content (the spec head's meta idiom), so the parts are read one by one.
    expect([...(meta?.querySelectorAll(':scope > span') ?? [])].map(visible)).toEqual([
      '5 features',
      '71/94 claims closed',
      '3 unheld',
    ]);
    expect(meta?.querySelector('dfn')?.textContent.trim()).toBe('claims');
    expect(meta?.querySelector('[role="tooltip"]')?.textContent.trim()).toBe('Acceptance criterion in a ticket tracker');
  });

  it('renders one card per feature block in master order, each an anchor target labelled by its heading', async () => {
    const root = page(await open('/w/harbor/features'));
    const articles = [...root.querySelectorAll<HTMLElement>('ol.rows > li > ui-card > article')];
    expect(articles.map((a) => a.id)).toEqual(['F0', 'F1', 'F2', 'F3', 'F4']);
    for (const article of articles) {
      expect(article.getAttribute('tabindex')).toBe('-1');
      expect(article.getAttribute('aria-labelledby')).toBe(`f-${article.id}`);
    }
    const h2 = root.querySelector('h2#f-F2');
    expect(h2?.querySelector('.id')?.textContent.trim()).toBe('F2');
    expect(h2?.querySelector('.name')?.textContent.trim()).toBe('Web console');
  });

  it('shows the fraction beside the meter, done ink and a check on a complete block', async () => {
    const root = await open('/w/harbor/features');
    const f2 = row(root, 'F2').querySelector('.fraction');
    expect(f2?.textContent.trim()).toBe('25/30');
    expect(f2?.classList.contains('done')).toBe(false);

    const f1 = row(root, 'F1').querySelector('.fraction');
    expect(f1?.textContent.trim()).toBe('46/46');
    expect(f1?.classList.contains('done')).toBe(true);
    expect(f1?.querySelector('ui-icon')).not.toBeNull();
  });

  it('shows a muted 0/0 and an empty track for a block without claims', async () => {
    const root = await open('/w/harbor/features');
    const fraction = row(root, 'F4').querySelector('.fraction');
    expect(fraction?.textContent.trim()).toBe('0/0');
    expect(fraction?.classList.contains('muted')).toBe(true);
    expect(fraction?.classList.contains('done')).toBe(false);
    expect(row(root, 'F4').querySelector('ui-meter')?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('names the meter and gives it a value text', async () => {
    const meter = row(await open('/w/harbor/features'), 'F2').querySelector('ui-meter');
    expect(meter?.getAttribute('role')).toBe('meter');
    expect(meter?.getAttribute('aria-label')).toBe('F2 claims closed');
    expect(meter?.getAttribute('aria-valuetext')).toBe('25 of 30 claims closed');
    expect(meter?.getAttribute('aria-valuemax')).toBe('30');
  });

  it('counts the unheld claims in a disclosure listing their ids, and reads "all held" at zero', async () => {
    const root = await open('/w/harbor/features');
    const details = row(root, 'F2').querySelector('details.unheld');
    expect(details?.querySelector('summary')?.textContent.trim()).toBe('2 unheld');
    expect(details?.querySelector('summary ui-icon')).not.toBeNull();
    // spec 024: prototype value (principal: Prototyp gilt immer) — the unheld claims open as claim lines (glyph | id | text).
    const disclosure = details as HTMLDetailsElement;
    disclosure.open = true;
    disclosure.dispatchEvent(new Event('toggle'));
    await settle();
    const lines = [...row(root, 'F2').querySelectorAll('.claim-line')];
    expect(lines.map((line) => line.querySelector('.cid')?.textContent.trim())).toEqual(['ISC-12', 'ISC-13']);
    expect(lines.map((line) => line.querySelector('.ctext')?.textContent.trim())).toEqual(['the console lists every run', 'a failed run links its log']);
    expect(lines.every((line) => line.querySelector('ui-icon[name="circle"]') !== null)).toBe(true);

    const held = row(root, 'F1').querySelector('.unheld');
    expect(held?.tagName).toBe('P');
    expect(held?.textContent.trim()).toBe('all held');
    expect(held?.querySelector('ui-icon')).toBeNull();
  });

  it('lists the holding specs as chips, main first and archived last, with the stage and the other main feature', async () => {
    const root = await open('/w/harbor/features');
    const f3 = chips(row(root, 'F3'));
    expect(f3.map((c) => c.dataset['spec'])).toEqual(['005', '003', '001']);
    expect(f3.map((c) => c.querySelector('a')?.dataset['variant'])).toEqual(['main', 'other', 'archived']);
    // 003 is the main holder of F4, so its chip under F3 names that block.
    expect(f3[1]?.querySelector('a')?.getAttribute('aria-label')).toBe('003 Plan, main feature F4');
    // The stage word comes from the dashboard row; an archived chip never shows one.
    expect(words(chips(row(root, 'F2'))[0])).toBe('002 Build');
    expect(words(f3[2])).toBe('001 archived');
    expect(row(root, 'F2').querySelector('ul.holders')?.getAttribute('aria-label')).toBe('Specs holding claims of F2');
  });

  // An active and an archived folder can share `NNN`; the folder slug is the holder's unique key, so both chips render
  // and Angular reports no duplicate track key (NG0955).
  it('renders two holders sharing an id but not a slug as two chips, without a duplicate-track warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const twins = feature('F9', 'Twins', {
        holders: [holder('007', { slug: '007-live', main: true }), holder('007', { slug: '007-old', archived: true })],
      });
      const root = await open('/w/harbor/features', 'wide', planning([twins]));
      // Angular checks track keys only against live items, so the page renders once more (as the next poll does).
      harness.fixture.debugElement.query(By.directive(FeaturesPage)).injector.get(ChangeDetectorRef).markForCheck();
      await settle();
      expect(chips(row(root, 'F9')).map((c) => c.querySelector('a')?.dataset['variant'])).toEqual(['main', 'archived']);
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/NG0955|duplicated keys/);
    } finally {
      warn.mockRestore();
    }
  });

  it('carries the full Why text in title and drops the line when the block has none', async () => {
    const root = await open('/w/harbor/features');
    const why = row(root, 'F0').querySelector('p.why');
    expect(why?.getAttribute('title')).toBe(`Why: ${WHY}`);
    expect(why?.textContent).toContain(WHY);
    expect(row(root, 'F4').querySelector('p.why')).toBeNull();
  });

  it('shows every chip at wide', async () => {
    const wide = await open('/w/harbor/features');
    expect(chips(row(wide, 'F2'))).toHaveLength(6);
    expect(row(wide, 'F2').querySelector('button.more-chips')).toBeNull();
  });

  it('shows three chips and "+n more" past four at compact, expanding in place', async () => {
    const compact = await open('/w/harbor/features', 'compact');
    const f2 = row(compact, 'F2');
    expect(chips(f2)).toHaveLength(3);
    const more = f2.querySelector<HTMLButtonElement>('button.more-chips');
    expect(more?.textContent.trim()).toBe('+3 more');
    more?.click();
    await settle();
    expect(chips(f2)).toHaveLength(6);
    expect(f2.querySelector('button.more-chips')).toBeNull();
    // Four chips or fewer never collapse.
    expect(chips(row(compact, 'F3'))).toHaveLength(3);
  });

  it('marks and focuses the row the fragment names', async () => {
    const root = await open('/w/harbor/features#F2');
    const f2 = row(root, 'F2');
    expect(f2.closest('ui-card')?.hasAttribute('data-arrived')).toBe(true);
    expect(row(root, 'F1').closest('ui-card')?.hasAttribute('data-arrived')).toBe(false);
    expect(document.activeElement).toBe(f2);
  });

  it('shows the empty state for a master without feature blocks', async () => {
    const root = page(await open('/w/harbor/features', 'wide', planning([])));
    expect(root.querySelector('ui-empty-state')?.textContent).toContain('No feature blocks in ISA.md');
    expect(root.querySelector('ol.rows')).toBeNull();
    expect(root.querySelector('h1#features')).not.toBeNull();
  });

  it('shows three skeleton cards until the planning tree answers', async () => {
    let answer: (value: ApiResult<PlanningBody>) => void = () => undefined;
    setUp(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/w/harbor/features');
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fixture.detectChanges();
    const root = page(harness.fixture.nativeElement as HTMLElement);
    expect(root.querySelectorAll('.skeleton-card')).toHaveLength(3);
    expect(root.querySelector('ol.rows')).toBeNull();

    answer(ok(planning(FEATURES)));
    await settle();
    expect(root.querySelectorAll('.skeleton-card')).toHaveLength(0);
    expect(root.querySelectorAll('ol.rows article')).toHaveLength(5);
  });

  it('renders the unavailable line when the planning tree cannot be read', async () => {
    setUp(Promise.resolve({ kind: 'error', status: 500 }));
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/w/harbor/features');
    await settle();
    const root = page(harness.fixture.nativeElement as HTMLElement);
    expect(root.querySelector('p.unavailable')).not.toBeNull();
    expect(root.querySelector('ol.rows')).toBeNull();
  });
});

// T139 · ISC-124.2: each feature block lists its stories after its specs as a sub-list "Ideas · n" with idea chips;
// the block's claim fraction stays the model's, since a story holds no claim.
describe('FeaturesPage ideas (T139, ISC-124.2)', () => {
  const HARBOR = harborPlanning as unknown as PlanningBody;
  const ideasOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-ideas]');

  it('shows one idea chip each on F2 and F7 of the harbor golden, linking to the idea page', async () => {
    const root = page(await open('/w/harbor/features', 'wide', HARBOR));
    for (const id of ['F2', 'F7']) {
      const feature = HARBOR.features.find((f) => f.id === id) as PlanningFeature;
      expect(feature.ideas).toHaveLength(1);
      const list = ideasOf(row(root, id)) as HTMLElement;
      expect(list.getAttribute('data-ideas')).toBe('1');
      expect(list.querySelector('[data-ideas-label]')).not.toBeNull();
      const links = [...list.querySelectorAll<HTMLAnchorElement>('ui-idea-chip a')];
      expect(links.map((a) => a.getAttribute('href'))).toEqual(feature.ideas.map((idea) => `/w/harbor/ideas/${idea.slug}`));
      expect(links.map((a) => a.textContent.trim())).toEqual(feature.ideas.map((idea) => idea.title));
    }
  });

  it('keeps the claim fraction of a block with stories unchanged', async () => {
    const root = page(await open('/w/harbor/features', 'wide', HARBOR));
    expect(row(root, 'F2').querySelector('.fraction')?.textContent.trim()).toBe('25/30');
    expect(row(root, 'F7').querySelector('.fraction')?.textContent.trim()).toBe('0/0');
  });

  it('shows no sub-list on a block without stories', async () => {
    const root = page(await open('/w/harbor/features', 'wide', HARBOR));
    for (const id of ['F0', 'F1', 'F3', 'F4', 'F5', 'F6']) expect(ideasOf(row(root, id))).toBeNull();
    expect(root.querySelectorAll('[data-ideas] ui-idea-chip')).toHaveLength(2);
  });
});
