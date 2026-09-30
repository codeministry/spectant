import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { PlanningHolder, PlanningMilestone } from '../../../../../core/src/planning';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { afterEach, vi } from 'vitest';
import { MILESTONES_TODAY, MilestonesPage } from './milestones-page';

// T36 · ISC-104 / ISC-102: the Milestones page renders the planning tree's milestones as served: one card per entry a
// spec names, in model order (target ascending, undated last), with the served state, a day count from a pinned today,
// the cross-feature meter, feature chips into the Features page and the naming specs as chips. The e2e tier
// (`bun run e2e -- milestones`, T37) proves absence and presence against the harbor golden in a real browser.

const TODAY = '2026-09-30';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const DASHBOARD = {
  specs: [
    { id: '002', title: 'Web console', type: 'feature', stage: 'build' },
    { id: '003', title: 'Config loader', type: 'feature', stage: 'plan' },
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
  ...over,
});

const milestone = (name: string, over: Partial<PlanningMilestone> = {}): PlanningMilestone => ({
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  target: null,
  description: null,
  closed: 0,
  total: 0,
  state: 'upcoming',
  features: [],
  specs: [],
  ...over,
});

const DESCRIPTION = 'Config through one loader, before the console ships.';

/** Model order: target ascending, undated last; the 0/0 entry no spec names adds no row. */
const MILESTONES: readonly PlanningMilestone[] = [
  milestone('Harbor 0.9', {
    target: '2026-09-18',
    description: DESCRIPTION,
    closed: 0,
    total: 18,
    state: 'late',
    features: [
      { id: 'F3', name: 'Config loader rewrite', closed: 0, total: 14 },
      { id: 'F0', name: 'Cross-cutting', closed: 0, total: 4 },
    ],
    specs: [holder('003')],
  }),
  milestone('Harbor 0.95', { target: '2026-10-15', state: 'upcoming' }),
  milestone('Harbor 1.0', {
    target: '2026-11-14',
    closed: 8,
    total: 10,
    state: 'upcoming',
    features: [{ id: 'F2', name: 'Web console', closed: 8, total: 10 }],
    specs: [holder('002', { main: true }), holder('001', { archived: true })],
  }),
  milestone('Archive sweep', {
    target: '2026-08-01',
    closed: 46,
    total: 46,
    state: 'complete',
    features: [{ id: 'F1', name: 'Manifest sync', closed: 46, total: 46 }],
    specs: [holder('001', { archived: true })],
  }),
];

const planning = (milestones: readonly PlanningMilestone[]): PlanningBody => ({
  features: [],
  milestones,
  recount: { closed: 0, total: 0 },
  diagnostics: [],
});

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec'>;

function setUp(plan: Promise<ApiResult<PlanningBody>>, lang = 'en'): void {
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
        translocoConfig: { availableLangs: [...LANGS], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: MILESTONES_TODAY, useValue: () => TODAY },
    ],
  });
}

let harness: RouterTestingHarness;

async function open(url: string, body: PlanningBody = planning(MILESTONES), lang = 'en'): Promise<HTMLElement> {
  setUp(Promise.resolve(ok(body)), lang);
  TestBed.inject(ShellState).tier.set('wide');
  if (lang !== 'en') TestBed.inject(TranslocoService).setActiveLang(lang);
  harness = await RouterTestingHarness.create();
  document.body.appendChild(harness.fixture.nativeElement as HTMLElement);
  await harness.navigateByUrl(url);
  await settle();
  return page(harness.fixture.nativeElement as HTMLElement);
}

async function settle(): Promise<void> {
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
}

const page = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>('app-milestones-page') ?? (() => { throw new Error('milestones page missing'); })();
const row = (root: HTMLElement, slug: string): HTMLElement =>
  root.querySelector<HTMLElement>(`article[id="m-${slug}"]`) ?? (() => { throw new Error(`row ${slug} missing`); })();
/** The text a sighted reader sees: the closed hint popovers of `ui-term` removed, whitespace collapsed. */
const visible = (el: Element | null | undefined): string => {
  if (!el) return '';
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[role="tooltip"]').forEach((node) => {
    node.remove();
  });
  return copy.textContent.replace(/\s+/g, ' ').trim();
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MilestonesPage (T36, ISC-104)', () => {
  it('heads the page with the H1, the caption and the next open milestone', async () => {
    const root = await open('/w/harbor/milestones');
    const h1 = root.querySelector('h1#milestones');
    expect(h1?.getAttribute('tabindex')).toBe('-1');
    expect(h1?.textContent.trim()).toBe('Milestones in harbor');
    expect(h1?.querySelector('ui-term')).toBeNull();
    expect(root.querySelector('p.caption')?.textContent.trim()).toBe('Ordered by target date');
    // Three named rows; the earliest not complete is the late Harbor 0.9.
    expect(root.querySelector('p.meta')?.textContent.trim()).toBe('3 milestones · next: Harbor 0.9, Sep 18, 2026');
  });

  it('reads metaNone when every named milestone is complete', async () => {
    const root = await open('/w/harbor/milestones', planning(MILESTONES.slice(3)));
    expect(root.querySelector('p.meta')?.textContent.trim()).toBe('no upcoming milestone');
  });

  it('renders one card per named milestone in model order, each an anchor target', async () => {
    const root = await open('/w/harbor/milestones');
    const articles = [...root.querySelectorAll<HTMLElement>('ol.rows > li > ui-card > article')];
    expect(articles.map((a) => a.id)).toEqual(['m-harbor-0-9', 'm-harbor-1-0', 'm-archive-sweep']);
    for (const article of articles) expect(article.getAttribute('tabindex')).toBe('-1');
    const h2 = row(root, 'harbor-1-0').querySelector('h2');
    expect(h2?.querySelector('ui-icon')?.getAttribute('name')).toBe('flag');
    expect(h2?.textContent.trim()).toBe('Harbor 1.0');
    // The 0/0 entry no spec names adds no row.
    expect(root.querySelector('article[id="m-harbor-0-95"]')).toBeNull();
  });

  it('shows the date and an upcoming day count in muted text', async () => {
    const line = row(await open('/w/harbor/milestones'), 'harbor-1-0').querySelector('.date-line');
    expect(line?.querySelector('time')?.textContent.trim()).toBe('Nov 14, 2026');
    expect(line?.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-14');
    expect(line?.querySelector('.relative')?.textContent.trim()).toBe('in 45 days');
    expect(line?.querySelector('ui-chip')).toBeNull();
  });

  it('shows a late milestone as a warning chip with clock-alert and the days since the target', async () => {
    const chip = row(await open('/w/harbor/milestones'), 'harbor-0-9').querySelector('.date-line ui-chip');
    expect(chip?.getAttribute('data-tone')).toBe('warning');
    expect(chip?.querySelector('ui-icon')?.getAttribute('name')).toBe('clock-alert');
    expect(chip?.textContent.trim()).toBe('late · 12 days');
  });

  it('shows a complete milestone as a success chip with circle-check', async () => {
    const root = await open('/w/harbor/milestones');
    const chip = row(root, 'archive-sweep').querySelector('.date-line ui-chip');
    expect(chip?.getAttribute('data-tone')).toBe('success');
    expect(chip?.querySelector('ui-icon')?.getAttribute('name')).toBe('circle-check');
    expect(chip?.textContent.trim()).toBe('complete');
    const fraction = row(root, 'archive-sweep').querySelector('.fraction');
    expect(fraction?.classList.contains('done')).toBe(true);
    expect(fraction?.textContent.trim()).toBe('46/46');
  });

  it('formats the date in the UI language', async () => {
    const root = await open('/w/harbor/milestones', planning(MILESTONES), 'de');
    const line = row(root, 'harbor-1-0').querySelector('.date-line');
    expect(line?.querySelector('time')?.textContent.trim()).toBe(
      new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date('2026-11-14T00:00:00Z')),
    );
    expect(line?.querySelector('.relative')?.textContent.trim()).toBe('in 45 Tagen');
  });

  it('carries the description with its full text in title', async () => {
    const root = await open('/w/harbor/milestones');
    const desc = row(root, 'harbor-0-9').querySelector('p.desc');
    expect(desc?.textContent.trim()).toBe(DESCRIPTION);
    expect(desc?.getAttribute('title')).toBe(DESCRIPTION);
    expect(row(root, 'harbor-1-0').querySelector('p.desc')).toBeNull();
  });

  it('names the cross-feature meter and gives it a value text', async () => {
    const r = row(await open('/w/harbor/milestones'), 'harbor-1-0');
    const meter = r.querySelector('ui-meter');
    expect(meter?.getAttribute('aria-valuetext')).toBe('8 of 10 claims closed');
    expect(meter?.getAttribute('aria-label')).toBe('Harbor 1.0 claims closed');
    expect(r.querySelector('.fraction')?.textContent.trim()).toBe('8/10');
  });

  it('links each feature chip to its row on the Features page with its own count', async () => {
    const r = row(await open('/w/harbor/milestones'), 'harbor-0-9');
    const label = r.querySelector('.chip-row.features dt');
    expect(visible(label)).toBe('Features');
    expect(label?.querySelector('ui-term [role="tooltip"]')?.textContent.trim()).toBe('Epic in a ticket tracker');
    const links = [...r.querySelectorAll<HTMLAnchorElement>('a.feature-chip')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/w/harbor/features#F3', '/w/harbor/features#F0']);
    expect(links[0]?.querySelector('.id')?.textContent.trim()).toBe('F3');
    expect(links[0]?.querySelector('.name')?.textContent.trim()).toBe('Config loader rewrite');
    expect(links[0]?.querySelector('.count')?.textContent.trim()).toBe('0/14');
  });

  it('lists the naming specs as spec chips, archived marked, never main', async () => {
    const r = row(await open('/w/harbor/milestones'), 'harbor-1-0');
    expect(visible(r.querySelector('.chip-row.specs dt'))).toBe('Specs');
    const chips = [...r.querySelectorAll<HTMLElement>('.chip-row.specs app-spec-chip')];
    expect(chips.map((c) => c.dataset['spec'])).toEqual(['002', '001']);
    expect(chips.map((c) => c.querySelector('a')?.dataset['variant'])).toEqual(['other', 'archived']);
    // The stage word comes from the dashboard row, as on Features.
    expect(chips[0]?.querySelector('a')?.getAttribute('aria-label')).toBe('002 Build');
    expect(chips[0]?.querySelector('a')?.getAttribute('href')).toContain('/w/harbor/s/002');
  });

  // An active and an archived folder can share `NNN`; the folder slug is the holder's unique key, so both chips render
  // and Angular reports no duplicate track key (NG0955).
  it('renders two naming specs sharing an id but not a slug as two chips, without a duplicate-track warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const twins = milestone('Twins', {
        target: '2026-10-20',
        closed: 1,
        total: 2,
        specs: [holder('007', { slug: '007-live' }), holder('007', { slug: '007-old', archived: true })],
      });
      const r = row(await open('/w/harbor/milestones', planning([twins])), 'twins');
      // Angular checks track keys only against live items, so the page renders once more (as the next poll does).
      harness.fixture.debugElement.query(By.directive(MilestonesPage)).injector.get(ChangeDetectorRef).markForCheck();
      await settle();
      const chips = [...r.querySelectorAll<HTMLElement>('.chip-row.specs app-spec-chip')];
      expect(chips.map((c) => c.querySelector('a')?.dataset['variant'])).toEqual(['other', 'archived']);
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/NG0955|duplicated keys/);
    } finally {
      warn.mockRestore();
    }
  });

  it('marks and focuses the row the fragment names', async () => {
    const root = await open('/w/harbor/milestones#m-harbor-1-0');
    const target = row(root, 'harbor-1-0');
    expect(target.closest('ui-card')?.hasAttribute('data-arrived')).toBe(true);
    expect(row(root, 'harbor-0-9').closest('ui-card')?.hasAttribute('data-arrived')).toBe(false);
    expect(document.activeElement).toBe(target);
  });

  it('renders the not-found page with a link to Features while no spec names a milestone', async () => {
    const root = await open('/w/harbor/milestones', planning([milestone('Someday', { target: '2026-12-01' })]));
    expect(root.querySelector('app-not-found')).not.toBeNull();
    expect(root.querySelector('h1#milestones')).toBeNull();
    const link = root.querySelector<HTMLAnchorElement>('.absent a');
    expect(link?.getAttribute('href')).toBe('/w/harbor/features');
    expect(link?.textContent.trim()).toBe('Features');
  });

  it('shows skeleton cards until the planning tree answers', async () => {
    let answer: (value: ApiResult<PlanningBody>) => void = () => undefined;
    setUp(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/w/harbor/milestones');
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fixture.detectChanges();
    const root = page(harness.fixture.nativeElement as HTMLElement);
    expect(root.querySelectorAll('.skeleton-card')).toHaveLength(3);
    expect(root.querySelector('ol.rows')).toBeNull();

    answer(ok(planning(MILESTONES)));
    await settle();
    expect(root.querySelectorAll('.skeleton-card')).toHaveLength(0);
    expect(root.querySelectorAll('ol.rows article')).toHaveLength(3);
  });

  it('renders the unavailable line when the planning tree cannot be read', async () => {
    setUp(Promise.resolve({ kind: 'error', status: 500 }));
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/w/harbor/milestones');
    await settle();
    const root = page(harness.fixture.nativeElement as HTMLElement);
    expect(root.querySelector('p.unavailable')).not.toBeNull();
    expect(root.querySelector('ol.rows')).toBeNull();
  });
});

describe('MILESTONES_TODAY default', () => {
  afterEach(() => vi.useRealTimers());

  // The server derives `state` on `localDate()`, the local calendar day; the day count must read the same calendar, or
  // around midnight a late milestone reads "0 days" while the UTC day still equals the target.
  it('is the local calendar day as YYYY-MM-DD, never the UTC one', () => {
    const pad = (n: number): string => String(n).padStart(2, '0');
    const today = TestBed.inject(MILESTONES_TODAY);
    vi.useFakeTimers({ toFake: ['Date'] });
    for (const instant of ['2026-03-15T23:30:00Z', '2026-03-16T00:30:00Z', '2026-12-31T23:59:00Z']) {
      vi.setSystemTime(new Date(instant));
      const now = new Date();
      expect(today()).toBe(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    }
  });
});
