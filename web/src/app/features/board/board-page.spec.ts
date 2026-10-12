import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';

// T121 · ISC-129: the workspace board page against the harbor goldens: one column per board stage, empty columns as
// stubs with their texts, the stage strip's options, the gate `<dfn>` on review and done, the hourglass on waiting
// stages, swimlane bands from `?group=`, and the empty, loading and error states the planning pages share.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const PLANNING = planningGolden as unknown as PlanningBody;
const EMPTY: PlanningBody = { ...PLANNING, stageCounts: {}, ideas: [], features: [], milestones: [] };

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery'>;

let harness: RouterTestingHarness;

async function open(url: string, plan: Promise<ApiResult<PlanningBody>> = Promise.resolve(ok(PLANNING)), body: unknown = dashboard, tier: Tier = 'wide'): Promise<HTMLElement> {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(body) : { kind: 'not-found', served: true }),
    planning: (ws) => (ws === 'harbor' ? plan : Promise.resolve({ kind: 'not-found', served: true })),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: '' })),
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
  TestBed.inject(ShellState).tier.set(tier);
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
  const page = (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-board-page');
  if (!page) throw new Error('board page missing');
  return page;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const col = (page: HTMLElement, stage: string): HTMLElement | null => page.querySelector<HTMLElement>(`.scroller [data-col="${stage}"]`);

describe('BoardPage (T121, ISC-129)', () => {
  it('renders one column per board stage, in `stages` order, inside the one scroller', async () => {
    const page = await open('/w/harbor/board');
    const cols = [...page.querySelectorAll<HTMLElement>('.scroller [data-col]')].map((c) => c.dataset['col']);
    expect(cols).toEqual(PLANNING.stages);
    expect(page.querySelectorAll('.scroller')).toHaveLength(1);
    expect(text(page.querySelector('.meta'))).toBe('10 cards · 8 specs · 2 ideas');
    expect(page.getAttribute('data-tier')).toBe('wide');
  });

  it('collapses the empty columns (plan, blocked, close) to stubs with their texts and a reserved width', async () => {
    const page = await open('/w/harbor/board');
    const stubs = [...page.querySelectorAll<HTMLElement>('.scroller [data-stub]')].map((c) => c.dataset['col']);
    expect(stubs).toEqual(['plan', 'blocked', 'close']);
    const plan = col(page, 'plan');
    expect(text(plan?.querySelector('.vlabel'))).toBe('Plan');
    expect(text(plan?.querySelector('.count'))).toBe('0');
    expect(text(plan?.querySelector('.vnote'))).toBe('empty');
    const grid = page.querySelector<HTMLElement>('.grid');
    expect(grid?.style.gridTemplateColumns.split(' ').filter((t) => t.includes('--board-stub'))).toHaveLength(3);
    expect(page.querySelectorAll('.scroller [data-col] app-board-card')).toHaveLength(10);
  });

  it('says how many cards a filter hides in a stub', async () => {
    const page = await open('/w/harbor/board?type=bug');
    expect(text(col(page, 'build')?.querySelector('.vnote'))).toBe('2 hidden by filters');
  });

  it('offers one strip segment per column with its label, count and accessible name', async () => {
    const page = await open('/w/harbor/board');
    const strip = page.querySelector('ui-segmented');
    expect(strip?.getAttribute('data-mode')).toBe('strip');
    expect(strip?.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBe('Stages · jump to a column');
    const segs = [...page.querySelectorAll<HTMLElement>('ui-segmented .sseg')];
    expect(segs.map((s) => s.dataset['key'])).toEqual(PLANNING.stages);
    const review = segs.find((s) => s.dataset['key'] === 'review');
    expect(text(review?.querySelector('.sl'))).toBe('Review');
    expect(text(review?.querySelector('.count'))).toBe('2');
    expect(review?.getAttribute('aria-label')).toBe('Review, 2 cards, 2 wait on you');
    expect(review?.querySelector('.dot')).not.toBeNull();
    expect(segs.find((s) => s.dataset['key'] === 'build')?.querySelector('.dot')).toBeNull();
  });

  it('puts the gate dfn on review and done only, with the catalogue gate text, and the hourglass on waiting stages', async () => {
    const page = await open('/w/harbor/board');
    const gated = [...page.querySelectorAll<HTMLElement>('.scroller [data-col]')].filter((c) => c.querySelector('ui-term dfn'));
    expect(gated.map((c) => c.dataset['col'])).toEqual(['review', 'done']);
    expect(text(col(page, 'review')?.querySelector('ui-term [role="tooltip"]'))).toBe('reviewed mark');
    expect(text(col(page, 'done')?.querySelector('ui-term [role="tooltip"]'))).toBe('every claim closed');
    expect(text(col(page, 'review')?.querySelector('dfn'))).toBe('fixed gate');
    expect(col(page, 'build')?.querySelector('ui-term')).toBeNull();
    expect(col(page, 'review')?.querySelector('.wait')).not.toBeNull();
    expect(col(page, 'close-pending')?.querySelector('.wait')).not.toBeNull();
    expect(col(page, 'build')?.querySelector('.wait')).toBeNull();
    expect(text(col(page, 'review')?.querySelector('.head .count'))).toBe('2');
    expect(col(page, 'review')?.getAttribute('aria-label')).toBe('Review, 2 cards, 2 wait on you');
  });

  it('renders swimlane bands with 40 px full-width heads when the query groups by feature', async () => {
    const page = await open('/w/harbor/board?group=feature');
    const heads = [...page.querySelectorAll('.band-head')].map((h) => text(h.querySelector('.mono')) || text(h.querySelector('.name')));
    expect(heads[0]).toBe('F0');
    expect(heads).toContain('F6');
    expect(heads).toContain('F7');
    const f6 = [...page.querySelectorAll('.band-head')].find((h) => text(h.querySelector('.mono')) === 'F6');
    expect(text(f6?.querySelector('.n'))).toBe('2 cards');
    expect(page.querySelectorAll('.cell app-board-card')).toHaveLength(10);
    expect(page.querySelectorAll('.col .cards')).toHaveLength(0);
  });

  it('shows the empty state when the tree holds no spec and no story', async () => {
    const page = await open('/w/harbor/board', Promise.resolve(ok(EMPTY)), { specs: [], archive: [] });
    expect(page.querySelector('ui-empty-state')).not.toBeNull();
    expect(text(page.querySelector('ui-empty-state .title'))).toBe('No specs in harbor yet');
    expect(page.querySelector('.scroller')).toBeNull();
  });

  it('shows skeletons while loading and the unavailable line when the tree cannot be read', async () => {
    let release: (value: ApiResult<PlanningBody>) => void = () => undefined;
    const pending = new Promise<ApiResult<PlanningBody>>((resolve) => (release = resolve));
    const opened = open('/w/harbor/board', pending);
    await new Promise((resolve) => setTimeout(resolve, 50));
    harness.fixture.detectChanges();
    const loading = (harness.fixture.nativeElement as HTMLElement).querySelector('app-board-page');
    expect(loading?.querySelector('.loading ui-skeleton')).not.toBeNull();
    expect(loading?.querySelector('.scroller')).toBeNull();
    release(ok(PLANNING));
    await opened;
    TestBed.resetTestingModule();
    const failed = await open('/w/harbor/board', Promise.resolve({ kind: 'unavailable' } as ApiResult<PlanningBody>));
    expect(text(failed.querySelector('.unavailable'))).toBe('This workspace cannot be read');
  });
});
