import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { boardQueryString, EMPTY_BOARD_QUERY, parseBoardQuery } from './board-model';

// T121 · ISC-129: the workspace board page against the harbor goldens: one column per board stage, empty columns as
// stubs with their texts, the stage strip's options, the gate `<dfn>` on review and done, the hourglass on waiting
// stages, swimlane bands from `?group=`, and the empty, loading and error states the planning pages share.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const PLANNING = planningGolden as unknown as PlanningBody;
const EMPTY: PlanningBody = { ...PLANNING, stageCounts: {}, ideas: [], features: [], milestones: [] };

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'putBoardQuery'>;

let harness: RouterTestingHarness;
/** Every `PUT …/board-query` the page sent, as `ws|query`. */
let saved: string[] = [];

async function open(
  url: string,
  plan: Promise<ApiResult<PlanningBody>> = Promise.resolve(ok(PLANNING)),
  body: unknown = dashboard,
  tier: Tier = 'wide',
  remembered = '',
): Promise<HTMLElement> {
  saved = [];
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(body) : { kind: 'not-found', served: true }),
    planning: (ws) => (ws === 'harbor' ? plan : Promise.resolve({ kind: 'not-found', served: true })),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: remembered })),
    putBoardQuery: (ws, query) => {
      saved.push(`${ws}|${query}`);
      return Promise.resolve({ kind: 'ok', body: { query } });
    },
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
    const strip = page.querySelector('ui-segmented[data-mode="strip"]');
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

// T123 · ISC-129.1: filters and swimlanes live in the URL query; the bare route restores the remembered query once and
// every other query the page shows is saved through `saveBoardQuery`.

const settle = async (): Promise<void> => {
  await harness.fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
};
const url = (): string => TestBed.inject(Router).url;
const searchOf = (): string => url().split('?')[1] ?? '';
const group = (page: HTMLElement, key: string): HTMLElement | null => page.querySelector<HTMLElement>(`app-board-filters [data-filter="${key}"]`);
const chip = (page: HTMLElement, key: string, label: string): HTMLButtonElement | undefined =>
  [...(group(page, key)?.querySelectorAll<HTMLButtonElement>('button.chip') ?? [])].find((b) => text(b).startsWith(label));
const pressed = (page: HTMLElement, key: string): string[] =>
  [...(group(page, key)?.querySelectorAll<HTMLButtonElement>('button[aria-pressed="true"]') ?? [])].map((b) => text(b));

describe('BoardPage query (T123, ISC-129.1)', () => {
  it('offers one chip group per filter key with the values the cards carry, "All" first', async () => {
    const page = await open('/w/harbor/board');
    expect([...page.querySelectorAll<HTMLElement>('app-board-filters [data-filter]')].map((g) => g.dataset['filter'])).toEqual(['feature', 'milestone', 'type', 'assignee']);
    const labels = (key: string): string[] => [...(group(page, key)?.querySelectorAll('button.chip') ?? [])].map((b) => text(b));
    expect(labels('feature')).toEqual(['All 10', 'F0 1', 'F2 2', 'F3 2', 'F4 1', 'F5 1', 'F6 2', 'F7 1']);
    expect(labels('milestone')).toEqual(['All 10', 'Harbor 0.9 1', 'Harbor 1.0 3', 'Harbor 2.0 1', 'No milestone 5']);
    expect(labels('type')).toEqual(['All 10', 'feature 2', 'refactor 1', 'bug 1', 'spike 3', 'chore 1', 'idea 2']);
    expect(labels('assignee')).toEqual(['All 10', 'u:3f9c0a7d 4', 'Unassigned 6']);
    for (const key of ['feature', 'milestone', 'type', 'assignee']) expect(pressed(page, key)).toEqual([expect.stringMatching(/^All/)]);
    expect(page.querySelector('[data-shown]')).toBeNull();
    expect(saved).toEqual([]);
  });

  it('reflects the query in the chips and the lane switch, and counts what the filters let through', async () => {
    const page = await open('/w/harbor/board?type=spike&milestone=none&group=milestone');
    expect(pressed(page, 'type')).toEqual(['spike 3']);
    expect(pressed(page, 'milestone')).toEqual(['No milestone 5']);
    expect(pressed(page, 'feature')).toEqual(['All 10']);
    const lanes = page.querySelector('app-board-filters [data-group] ui-segmented');
    expect(text(lanes?.querySelector('[aria-checked="true"]'))).toBe('Milestone');
    expect(text(page.querySelector('[data-shown] span'))).toBe('3 of 10 cards');
  });

  it('round-trips the whole query: the URL stays as written and the canonical string is saved', async () => {
    const query = 'feature=F6&feature=none&milestone=Harbor+1.0&type=spike&assignee=u%3A3f9c0a7d&group=feature&col=build';
    await open(`/w/harbor/board?${query}`);
    await settle();
    expect(parseBoardQuery(searchOf())).toEqual(parseBoardQuery(query));
    expect(saved).toEqual([`harbor|${boardQueryString(parseBoardQuery(query))}`]);
  });

  it('a filter click navigates with replaceUrl, keeps the lanes, and saves the new query', async () => {
    const page = await open('/w/harbor/board?group=feature');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    chip(page, 'type', 'bug')?.click();
    await settle();
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'merge' }));
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, type: ['bug'], group: 'feature' });
    expect(saved.at(-1)).toBe('harbor|type=bug&group=feature');
    expect(pressed(page, 'type')).toEqual(['bug 1']);
    chip(page, 'type', 'All')?.click();
    await settle();
    expect(searchOf()).toBe('group=feature');
    expect(saved.at(-1)).toBe('harbor|group=feature');
  });

  it('the lane switch writes ?group and renders the bands', async () => {
    const page = await open('/w/harbor/board');
    const feature = [...page.querySelectorAll<HTMLElement>('app-board-filters [data-group] [role="radio"]')].find((b) => text(b) === 'Feature');
    feature?.click();
    await settle();
    expect(searchOf()).toBe('group=feature');
    expect(page.querySelectorAll('.band-head').length).toBeGreaterThan(0);
    expect(saved).toEqual(['harbor|group=feature']);
  });

  it('"Clear filters" drops every filter value but keeps the lanes and the column', async () => {
    const page = await open('/w/harbor/board?type=bug&assignee=unassigned&group=milestone&col=review');
    page.querySelector<HTMLButtonElement>('app-board-filters [data-clear]')?.click();
    await settle();
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, group: 'milestone', col: 'review' });
    expect(saved.at(-1)).toBe('harbor|group=milestone&col=review');
    expect(page.querySelector('[data-shown]')).toBeNull();
  });

  it('the bare route restores the remembered query once, without saving it back', async () => {
    await open('/w/harbor/board', undefined, undefined, 'wide', 'type=bug&group=feature');
    await settle();
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, type: ['bug'], group: 'feature' });
    expect(saved).toEqual([]);
    const page = (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-board-page');
    expect(page && pressed(page, 'type')).toEqual(['bug 1']);
  });

  it('a route with a query wins over the remembered one and becomes the remembered query', async () => {
    await open('/w/harbor/board?type=spike', undefined, undefined, 'wide', 'type=bug');
    await settle();
    expect(searchOf()).toBe('type=spike');
    expect(saved).toEqual(['harbor|type=spike']);
  });

  it('the bare route stays bare when nothing is remembered', async () => {
    await open('/w/harbor/board');
    await settle();
    expect(url()).toBe('/w/harbor/board');
    expect(saved).toEqual([]);
  });

  it('the no-match line clears the filters in place', async () => {
    const page = await open('/w/harbor/board?type=bug&feature=F7');
    expect(text(page.querySelector('.no-match'))).toContain('No cards match');
    page.querySelector<HTMLButtonElement>('.no-match [data-clear]')?.click();
    await settle();
    expect(url()).toBe('/w/harbor/board');
    expect(saved.at(-1)).toBe('harbor|');
  });
});

// T124 · ISC-129.2: at the compact tier the board is one column picked by a wrapping radio `ui-segmented`; the strip
// and the horizontal scroller are not rendered, so nothing on the page can scroll sideways.

describe('BoardPage compact (T124, ISC-129.2)', () => {
  const radios = (page: HTMLElement): HTMLButtonElement[] => [...page.querySelectorAll<HTMLButtonElement>('.colswitch [role="radio"]')];

  it('renders exactly one column and neither the strip nor the scroller', async () => {
    const page = await open('/w/harbor/board', undefined, undefined, 'compact');
    expect(page.getAttribute('data-tier')).toBe('compact');
    expect(page.querySelector('.scroller')).toBeNull();
    expect(page.querySelector('ui-segmented[data-mode="strip"]')).toBeNull();
    const shown = [...page.querySelectorAll<HTMLElement>('section[data-col]')];
    expect(shown.map((s) => s.dataset['col'])).toEqual(['build']);
    expect(shown[0]?.querySelectorAll('app-board-card')).toHaveLength(2);
    expect(text(shown[0]?.querySelector('.head h2'))).toBe('Build');
  });

  it('offers one radio per stage with its count, the default column checked, a dot where cards wait on you', async () => {
    const page = await open('/w/harbor/board', undefined, undefined, 'compact');
    const segs = radios(page);
    expect(segs).toHaveLength(PLANNING.stages.length);
    expect(segs.filter((s) => s.getAttribute('aria-checked') === 'true').map((s) => text(s))).toEqual(['Build 2']);
    expect(text(segs.find((s) => text(s).startsWith('Review')))).toBe('Review 2');
    expect(page.querySelector('.colswitch [role="radiogroup"]')?.getAttribute('aria-label')).toBe('Stages · show one column');
    expect(segs.find((s) => text(s).startsWith('Review'))?.querySelector('.dot')).not.toBeNull();
    expect(segs.find((s) => text(s).startsWith('Build'))?.querySelector('.dot')).toBeNull();
  });

  it('a segment switch writes ?col and shows that column', async () => {
    const page = await open('/w/harbor/board', undefined, undefined, 'compact');
    radios(page).find((s) => text(s).startsWith('Review'))?.click();
    await settle();
    expect(searchOf()).toBe('col=review');
    expect([...page.querySelectorAll<HTMLElement>('section[data-col]')].map((s) => s.dataset['col'])).toEqual(['review']);
    expect(saved.at(-1)).toBe('harbor|col=review');
  });

  it('the sticky bar steps to the neighbouring columns and is disabled at the ends', async () => {
    const page = await open('/w/harbor/board?col=idea', undefined, undefined, 'compact');
    expect(page.querySelector('[data-colbar] [data-prev]')?.getAttribute('aria-disabled')).toBe('true');
    expect(text(page.querySelector('[data-colbar] .barname .sl'))).toBe('Idea');
    expect(text(page.querySelector('[data-colbar] .barname .count'))).toBe('2');
    page.querySelector<HTMLButtonElement>('[data-colbar] [data-next]')?.click();
    await settle();
    expect(searchOf()).toBe('col=plan');
    expect(page.querySelector('[data-colbar] [data-next]')?.getAttribute('aria-label')).toBe('Next column: Review');
  });

  it('lays out the drop tray with one placeholder per stage, closed until a drag opens it', async () => {
    const page = await open('/w/harbor/board?col=review', undefined, undefined, 'compact');
    const tray = page.querySelector<HTMLElement>('[data-colbar] [data-tray]');
    expect(tray?.hasAttribute('data-open')).toBe(false);
    expect(tray?.getAttribute('aria-hidden')).toBe('true');
    const slots = [...(tray?.querySelectorAll<HTMLElement>('[data-drop-col]') ?? [])];
    expect(slots.map((s) => s.dataset['dropCol'])).toEqual(PLANNING.stages);
    expect(slots.filter((s) => s.hasAttribute('data-current')).map((s) => s.dataset['dropCol'])).toEqual(['review']);
  });

  it('an empty column says so and offers to clear the filters that hide its cards', async () => {
    const page = await open('/w/harbor/board?type=bug', undefined, undefined, 'compact');
    // build holds no bug: the default column falls back to the first non-empty one (review, holding 006)
    expect([...page.querySelectorAll<HTMLElement>('section[data-col]')].map((s) => s.dataset['col'])).toEqual(['review']);
    TestBed.resetTestingModule();
    const empty = await open('/w/harbor/board?type=bug&col=build', undefined, undefined, 'compact');
    expect(text(empty.querySelector('.empty-col'))).toBe('No card in Build · 2 hidden by filters · Clear');
  });

  it('stacks swimlane bands inside the one column, with the omitted-band line', async () => {
    const page = await open('/w/harbor/board?group=feature&col=build', undefined, undefined, 'compact');
    const heads = [...page.querySelectorAll('section[data-col="build"] .band-head')].map((h) => text(h.querySelector('.mono')));
    expect(heads).toEqual(['F2', 'F6']);
    expect(text(page.querySelector('.omitted'))).toBe('6 features have no card in Build');
  });
});
