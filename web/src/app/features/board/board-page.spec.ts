import { type CdkDrag, type CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { provideHttpClient } from '@angular/common/http';
import { By } from '@angular/platform-browser';
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
import { boardQueryString, EMPTY_BOARD_QUERY, parseBoardQuery } from '../../core/model/board-query';

// T121 · ISC-129: the workspace board page against the harbor goldens: one column per board stage, empty columns as
// stubs with their texts, the stage strip's options, the gate `<dfn>` on review and done, the hourglass on waiting
// stages, swimlane bands from `?group=`, and the empty, loading and error states the planning pages share.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const PLANNING = planningGolden as unknown as PlanningBody;
const EMPTY: PlanningBody = { ...PLANNING, stageCounts: {}, ideas: [], features: [], milestones: [] };

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'putBoardQuery' | 'backlog'>;
type BacklogResult = Awaited<ReturnType<ApiClient['backlog']>>;

/** Every backlog write the page sent (spec 037) as `feature>before|hash`, and the fake's answer, a 200 by default. */
let backlogCalls: string[] = [];
const WRITTEN = { kind: 'answer', answer: { status: 200, body: { hash: 'h2', event: {} } } } as unknown as BacklogResult;
let backlogAnswer: BacklogResult = WRITTEN;

let harness: RouterTestingHarness;

/**
 * jsdom has no Popover API: `showPopover` / `hidePopover` are stubbed as the browser behaves (popover.spec.ts), hiding
 * fires the closing `toggle`; top layer and the anchored geometry belong to the browser tier.
 */
function stubPopovers(): void {
  const el = HTMLElement.prototype as unknown as Record<string, unknown>;
  el['showPopover'] = vi.fn(function (this: HTMLElement) {
    this.setAttribute('data-shown', '');
  });
  el['hidePopover'] = vi.fn(function (this: HTMLElement) {
    this.removeAttribute('data-shown');
    this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
  });
}
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
  stubPopovers();
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
    backlog: (_ws, op, hash) => {
      backlogCalls.push(op.op === 'move' ? `${op.feature}>${op.before ?? 'end'}|${hash}` : `${op.feature}=${op.priority}|${hash}`);
      return Promise.resolve(backlogAnswer);
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

  it('names every open column in its own head with the stage and count, and draws no separate stage strip', async () => {
    const page = await open('/w/harbor/board');
    expect(page.querySelector('ui-segmented[data-mode="strip"]')).toBeNull();
    const review = col(page, 'review');
    expect(text(review?.querySelector('.head h2'))).toBe('Review');
    expect(text(review?.querySelector('.head .count'))).toBe('2');
    expect(review?.querySelector('.head [data-fold-toggle]')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds a column with cards on its head button (?fold=) and opens an empty one from its stub (?open=)', async () => {
    const page = await open('/w/harbor/board');
    const review = col(page, 'review');
    review?.querySelector<HTMLButtonElement>('.head [data-fold-toggle]')?.click();
    await settle();
    expect(url()).toContain('fold=review');
    expect(col(page, 'review')?.hasAttribute('data-stub')).toBe(true);
    expect(text(col(page, 'review')?.querySelector('.count'))).toBe('2');
    const empty = page.querySelector<HTMLElement>('.scroller [data-stub]:not([data-col="review"])');
    const stage = empty?.dataset['col'] ?? '';
    empty?.querySelector<HTMLButtonElement>('[data-fold-toggle]')?.click();
    await settle();
    expect(url()).toContain(`open=${stage}`);
    expect(col(page, stage)?.hasAttribute('data-stub')).toBe(false);
  });

  // Spec 040 (T48, ISC-224): a run never hides behind a fold; the stub says "1 running" under its count.
  it('shows the half glyph and "1 running" in a folded column\'s stub when a card in it runs, nothing otherwise', async () => {
    const run = { kind: 'spec', id: '006', state: 'running', stage: 'review' };
    const body = { ...dashboard, specs: dashboard.specs.map((r) => (r.id === '006' ? { ...r, state: run } : r)) };
    const page = await open('/w/harbor/board?fold=review&fold=build', undefined, body);
    const note = col(page, 'review')?.querySelector('[data-stub-running]');
    expect(text(note)).toBe('1 running');
    expect(note?.querySelector('ui-glyph svg')?.getAttribute('data-state')).toBe('running');
    expect(col(page, 'build')?.hasAttribute('data-stub')).toBe(true);
    expect(col(page, 'build')?.querySelector('[data-stub-running]')).toBeNull();
  });

  it('unfolds the last folded column and closes the last opened one, dropping ?fold= and ?open= from the URL', async () => {
    const page = await open('/w/harbor/board?fold=review&open=plan');
    expect(col(page, 'review')?.hasAttribute('data-stub')).toBe(true);
    col(page, 'review')?.querySelector<HTMLButtonElement>('[data-fold-toggle]')?.click();
    await settle();
    expect(url()).not.toContain('fold=');
    expect(col(page, 'review')?.hasAttribute('data-stub')).toBe(false);
    col(page, 'plan')?.querySelector<HTMLButtonElement>('.head [data-fold-toggle]')?.click();
    await settle();
    expect(url()).not.toContain('open=');
    expect(col(page, 'plan')?.hasAttribute('data-stub')).toBe(true);
  });

  it('puts the gate dfn on review and done only; the ring of open on a stage that waits on you, the hourglass on a wait on others', async () => {
    const page = await open('/w/harbor/board');
    const gated = [...page.querySelectorAll<HTMLElement>('.scroller [data-col]')].filter((c) => c.querySelector('ui-term dfn'));
    expect(gated.map((c) => c.dataset['col'])).toEqual(['review', 'done']);
    expect(text(col(page, 'review')?.querySelector('ui-term [role="tooltip"]'))).toBe('reviewed mark');
    expect(text(col(page, 'done')?.querySelector('ui-term [role="tooltip"]'))).toBe('every claim closed');
    expect(text(col(page, 'review')?.querySelector('dfn'))).toBe('fixed gate');
    expect(col(page, 'build')?.querySelector('ui-term')).toBeNull();
    // Spec 020 (T24): the hourglass on review gives way to 040's ring of open, with no count of its own.
    const ring = col(page, 'review')?.querySelector('.head [data-open-stage]');
    expect(ring?.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('ring');
    expect(text(ring)).toBe('a stage that waits on you');
    expect(col(page, 'review')?.querySelector('.head ui-icon[data-icon="hourglass"]')).toBeNull();
    expect(col(page, 'close-pending')?.querySelector('.head ui-icon[data-icon="hourglass"]')).not.toBeNull();
    expect(col(page, 'close-pending')?.querySelector('.head [data-open-stage]')).toBeNull();
    expect(col(page, 'build')?.querySelector('.wait')).toBeNull();
    expect(text(col(page, 'review')?.querySelector('.head .count'))).toBe('2');
    expect(col(page, 'review')?.getAttribute('aria-label')).toBe('Review, 2 cards, 2 wait on you');
  });

  it('renders swimlane bands with 40 px full-width heads when the query groups by feature', async () => {
    const page = await open('/w/harbor/board?group=feature');
    const heads = [...page.querySelectorAll('.band-head')].map((h) => text(h.querySelector('.mono')) || text(h.querySelector('.name')));
    expect(heads[0]).toBe('F3');
    expect(heads).toContain('F6');
    expect(heads).toContain('F7');
    const f6 = [...page.querySelectorAll('.band-head')].find((h) => text(h.querySelector('.mono')) === 'F6');
    expect(text(f6?.querySelector('.n'))).toBe('2 cards');
    expect(page.querySelectorAll('.cell app-board-card')).toHaveLength(10);
    expect(page.querySelectorAll('.col .cards')).toHaveLength(0);
  });

  it("writes a milestone band's target as a calendar day in the short date form (spec 006, ISC-114.3)", async () => {
    const page = await open('/w/harbor/board?group=milestone');
    const head = [...page.querySelectorAll('.band-head')].find((h) => text(h.querySelector('.name')) === 'Harbor 0.9');
    const day = head?.querySelector('time');
    expect(day?.getAttribute('datetime')).toBe('2026-03-15');
    expect(text(day)).toBe('03/15/2026');
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
    expect(loading?.querySelector('.board-loading ui-skeleton')).not.toBeNull();
    expect(loading?.querySelector('.scroller')).toBeNull();
    release(ok(PLANNING));
    await opened;
    TestBed.resetTestingModule();
    const failed = await open('/w/harbor/board', Promise.resolve({ kind: 'unavailable' } as ApiResult<PlanningBody>));
    expect(text(failed.querySelector('.unavailable'))).toBe('This workspace cannot be read');
  });
});

// T123 · ISC-129.1: filters and swimlanes live in the URL query; the bare route restores the remembered query once and
// every other query the page shows is saved through `saveBoardQuery`. T163 · ISC-133.1: the controls are the toolbar:
// four triggers, each a popover checkbox list, the active selections as removable chips, the swimlane switch, "n of m
// cards" while filtering and Clear; and the source chip beside the title.

const settle = async (): Promise<void> => {
  await harness.fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
};
const url = (): string => TestBed.inject(Router).url;
const searchOf = (): string => url().split('?')[1] ?? '';
const trigger = (page: HTMLElement, key: string): HTMLButtonElement | null => page.querySelector<HTMLButtonElement>(`app-board-filters [data-trigger="${key}"]`);
const list = (page: HTMLElement, key: string): HTMLElement | null => page.querySelector<HTMLElement>(`app-board-filters ui-popover[data-filter="${key}"]`);
const panel = (page: HTMLElement, key: string): HTMLElement | null => list(page, key)?.querySelector<HTMLElement>('[popover]') ?? null;
const rows = (page: HTMLElement, key: string): HTMLElement[] => [...(list(page, key)?.querySelectorAll<HTMLElement>('[data-value]') ?? [])];
const box = (page: HTMLElement, key: string, value: string): HTMLInputElement | null | undefined =>
  rows(page, key)
    .find((r) => r.dataset['value'] === value)
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
const checked = (page: HTMLElement, key: string): string[] =>
  rows(page, key)
    .filter((r) => r.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked === true)
    .map((r) => r.dataset['value'] ?? '?');
const chips = (page: HTMLElement): string[] => [...page.querySelectorAll<HTMLElement>('app-board-filters [data-chip]')].map((c) => c.dataset['chip'] ?? '?');
const toggle = async (page: HTMLElement, key: string, value: string): Promise<void> => {
  box(page, key, value)?.click();
  await settle();
};

describe('BoardPage toolbar (T123, T163, ISC-129.1, ISC-133.1)', () => {
  it('renders the four triggers with a caret in toolbar order, each naming its key and "· n" once values are selected', async () => {
    const page = await open('/w/harbor/board');
    const triggers = [...page.querySelectorAll<HTMLButtonElement>('app-board-filters [data-trigger]')];
    expect(triggers.map((t) => t.dataset['trigger'])).toEqual(['feature', 'milestone', 'type', 'assignee']);
    expect(triggers.map((t) => text(t))).toEqual(['Feature', 'Milestone', 'Type', 'Assignee']);
    for (const t of triggers) {
      expect(t.querySelector('ui-icon.caret')).not.toBeNull();
      expect(t.getAttribute('aria-expanded')).toBe('false');
      expect(t.getAttribute('aria-haspopup')).toBe('dialog');
      expect(t.getAttribute('aria-controls')).toBe(panel(page, t.dataset['trigger'] ?? '')?.id);
      expect(t.hasAttribute('data-active')).toBe(false);
    }
    TestBed.resetTestingModule();
    const filtered = await open('/w/harbor/board?type=spike&type=bug&milestone=none');
    expect(text(trigger(filtered, 'type'))).toBe('Type · 2');
    expect(text(trigger(filtered, 'milestone'))).toBe('Milestone · 1');
    expect(text(trigger(filtered, 'feature'))).toBe('Feature');
    expect(trigger(filtered, 'type')?.hasAttribute('data-active')).toBe(true);
  });

  it('lists the values the cards carry in model order, the none value last, with their counts and the type glyphs', async () => {
    const page = await open('/w/harbor/board');
    const values = (key: string): string[] => rows(page, key).map((r) => r.dataset['value'] ?? '?');
    const counts = (key: string): string[] => rows(page, key).map((r) => text(r.querySelector('.n')));
    expect(values('feature')).toEqual(['F0', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']);
    expect(counts('feature')).toEqual(['1', '2', '2', '1', '1', '2', '1']);
    expect(text(rows(page, 'feature')[5]?.querySelector('.fid'))).toBe('F6');
    expect(text(rows(page, 'feature')[5]?.querySelector('.name'))).toBe('Registry compatibility');
    expect(values('milestone')).toEqual(['Harbor 0.9', 'Harbor 1.0', 'Harbor 2.0', 'none']);
    expect(text(rows(page, 'milestone')[3]?.querySelector('.name'))).toBe('No milestone');
    expect(counts('milestone')).toEqual(['1', '3', '1', '5']);
    expect(values('type')).toEqual(['feature', 'refactor', 'bug', 'spike', 'chore', 'idea']);
    expect(rows(page, 'type').map((r) => r.querySelector('ui-type-glyph')?.getAttribute('data-type'))).toEqual(values('type'));
    expect(rows(page, 'type').map((r) => text(r.querySelector('.name')))).toEqual(['feature', 'refactor', 'bug', 'spike', 'chore', 'idea']);
    expect(counts('type')).toEqual(['2', '1', '1', '3', '1', '2']);
    expect(values('assignee')).toEqual(['u:3f9c0a7d', 'unassigned']);
    expect(rows(page, 'assignee')[0]?.querySelector('ui-actor-chip')?.getAttribute('data-kind')).toBe('person');
    expect(text(rows(page, 'assignee')[1]?.querySelector('.name'))).toBe('Unassigned');
    expect(counts('assignee')).toEqual(['4', '6']);
    for (const key of ['feature', 'milestone', 'type', 'assignee']) {
      expect(checked(page, key)).toEqual([]);
      expect(panel(page, key)?.getAttribute('aria-label')).toBe(text(trigger(page, key)));
    }
  });

  it('reads the assignee list as people, then agents, then unassigned', async () => {
    const agent = { raw: 'a:claude:sess-9', kind: 'agent', id: 'a:claude:sess-9', legacy: false };
    const planning = structuredClone(PLANNING) as unknown as { features: Array<{ holders: Array<{ id: string; assignee: unknown }> }> };
    for (const f of planning.features) for (const h of f.holders) if (h.id === '004') h.assignee = agent;
    const page = await open('/w/harbor/board', Promise.resolve(ok(planning as unknown as PlanningBody)));
    expect(rows(page, 'assignee').map((r) => r.dataset['value'])).toEqual(['u:3f9c0a7d', 'a:claude:sess-9', 'unassigned']);
    expect([...(list(page, 'assignee')?.querySelectorAll('.section') ?? [])].map((h) => text(h))).toEqual(['People', 'Agents']);
    expect(rows(page, 'assignee')[1]?.querySelector('ui-actor-chip')?.getAttribute('data-kind')).toBe('agent');
  });

  it('a trigger opens its list with focus inside; Escape closes it and focus returns to the trigger', async () => {
    const page = await open('/w/harbor/board');
    const type = trigger(page, 'type');
    type?.click();
    await settle();
    expect(panel(page, 'type')?.hasAttribute('data-shown')).toBe(true);
    expect(type?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(box(page, 'type', 'feature'));
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(panel(page, 'type')?.hasAttribute('data-shown')).toBe(false);
    expect(type?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(type);
  });

  it('checks several values of one key into the query with replaceUrl, keeps the lanes, and the list stays open', async () => {
    const page = await open('/w/harbor/board?group=feature');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    trigger(page, 'type')?.click();
    await settle();
    await toggle(page, 'type', 'spike');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'merge' }));
    await toggle(page, 'type', 'bug');
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, type: ['spike', 'bug'], group: 'feature' });
    expect(saved.at(-1)).toBe('harbor|type=spike&type=bug&group=feature');
    expect(checked(page, 'type')).toEqual(['bug', 'spike']);
    expect(text(trigger(page, 'type'))).toBe('Type · 2');
    expect(panel(page, 'type')?.hasAttribute('data-shown')).toBe(true);
    expect(page.querySelectorAll('.scroller app-board-card')).toHaveLength(4);
    await toggle(page, 'type', 'spike');
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, type: ['bug'], group: 'feature' });
    expect(saved.at(-1)).toBe('harbor|type=bug&group=feature');
  });

  it("shows the active selections as chips in key order; a chip's remove button drops that one value", async () => {
    const page = await open('/w/harbor/board?feature=F6&type=spike&type=bug&assignee=unassigned&group=milestone');
    expect(chips(page)).toEqual(['feature:F6', 'type:spike', 'type:bug', 'assignee:unassigned']);
    const chip = (key: string): HTMLElement | null => page.querySelector<HTMLElement>(`app-board-filters [data-chip="${key}"]`);
    expect(text(chip('feature:F6')?.querySelector('.cl'))).toBe('F6');
    expect(text(chip('assignee:unassigned')?.querySelector('.cl'))).toBe('Unassigned');
    expect(chip('type:spike')?.querySelector('ui-type-glyph')?.getAttribute('data-type')).toBe('spike');
    const remove = chip('type:spike')?.querySelector<HTMLButtonElement>('button[data-remove]');
    expect(remove?.getAttribute('aria-label')).toBe('Remove filter spike');
    remove?.click();
    await settle();
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, feature: ['F6'], type: ['bug'], assignee: ['unassigned'], group: 'milestone' });
    expect(chips(page)).toEqual(['feature:F6', 'type:bug', 'assignee:unassigned']);
    expect(document.activeElement).toBe(page.querySelector('app-board-filters [data-chip="type:bug"] button[data-remove]'));
    TestBed.resetTestingModule();
    const bare = await open('/w/harbor/board');
    expect(chips(bare)).toEqual([]);
  });

  it('reflects the query in the lists and the lane switch, and counts what the filters let through only while filtering', async () => {
    const bare = await open('/w/harbor/board');
    expect(bare.querySelector('app-board-filters [data-shown]')).toBeNull();
    expect(bare.querySelector('app-board-filters [data-clear]')).toBeNull();
    TestBed.resetTestingModule();
    const page = await open('/w/harbor/board?type=spike&milestone=none&group=milestone');
    expect(checked(page, 'type')).toEqual(['spike']);
    expect(checked(page, 'milestone')).toEqual(['none']);
    expect(checked(page, 'feature')).toEqual([]);
    const lanes = page.querySelector('app-board-filters [data-group] ui-segmented');
    expect(text(lanes?.querySelector('[aria-checked="true"]'))).toBe('Milestone');
    expect(text(page.querySelector('app-board-filters [data-group] .filter-label'))).toBe('Swimlanes');
    expect(text(page.querySelector('app-board-filters [data-shown] [data-count]'))).toBe('3 of 10 cards');
    expect(text(page.querySelector('app-board-filters [data-shown] [data-clear]'))).toBe('Clear');
  });

  it('round-trips the whole query: the URL stays as written and the canonical string is saved', async () => {
    const query = 'feature=F6&feature=none&milestone=Harbor+1.0&type=spike&assignee=u%3A3f9c0a7d&group=feature&col=build';
    await open(`/w/harbor/board?${query}`);
    await settle();
    expect(parseBoardQuery(searchOf())).toEqual(parseBoardQuery(query));
    expect(saved).toEqual([`harbor|${boardQueryString(parseBoardQuery(query))}`]);
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

  it('Clear drops every filter value but keeps the lanes and the column', async () => {
    const page = await open('/w/harbor/board?type=bug&assignee=unassigned&group=milestone&col=review');
    page.querySelector<HTMLButtonElement>('app-board-filters [data-shown] [data-clear]')?.click();
    await settle();
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, group: 'milestone', col: 'review' });
    expect(saved.at(-1)).toBe('harbor|group=milestone&col=review');
    expect(page.querySelector('app-board-filters [data-shown]')).toBeNull();
    expect(chips(page)).toEqual([]);
  });

  it('the bare route restores the remembered query once, without saving it back', async () => {
    await open('/w/harbor/board', undefined, undefined, 'wide', 'type=bug&group=feature');
    await settle();
    expect(parseBoardQuery(searchOf())).toEqual({ ...EMPTY_BOARD_QUERY, type: ['bug'], group: 'feature' });
    expect(saved).toEqual([]);
    const page = (harness.fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-board-page');
    expect(page && checked(page, 'type')).toEqual(['bug']);
    expect(page && text(trigger(page, 'type'))).toBe('Type · 1');
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

  it('renders the same toolbar at the compact tier, its lists still popovers', async () => {
    const page = await open('/w/harbor/board?type=spike', undefined, undefined, 'compact');
    expect(page.querySelectorAll('app-board-filters [data-trigger]')).toHaveLength(4);
    expect(page.querySelectorAll('app-board-filters ui-popover [popover]')).toHaveLength(4);
    expect(chips(page)).toEqual(['type:spike']);
  });
});

describe('BoardPage source chip (T163, ISC-133.1)', () => {
  it('names specs/workflow.md in mono beside the title when the workspace has its own table', async () => {
    const page = await open('/w/harbor/board');
    const chip = page.querySelector<HTMLElement>('.title-row [data-source]');
    expect(chip?.dataset['source']).toBe('file');
    expect(text(chip)).toBe('specs/workflow.md');
    expect(chip?.classList.contains('mono')).toBe(true);
    expect(text(page.querySelector('.title-row h1'))).toBe('Board');
  });

  it('says "default workflow", muted, when the file is missing', async () => {
    const page = await open('/w/harbor/board', Promise.resolve(ok({ ...PLANNING, workflow: { ...PLANNING.workflow, source: 'default' } })));
    const chip = page.querySelector<HTMLElement>('.title-row [data-source]');
    expect(chip?.dataset['source']).toBe('default');
    expect(text(chip)).toBe('default workflow');
    expect(chip?.classList.contains('mono')).toBe(false);
  });

  it('shows no chip while the planning tree is loading', async () => {
    let release: (value: ApiResult<PlanningBody>) => void = () => undefined;
    const pending = new Promise<ApiResult<PlanningBody>>((resolve) => (release = resolve));
    const opened = open('/w/harbor/board', pending);
    await new Promise((resolve) => setTimeout(resolve, 50));
    harness.fixture.detectChanges();
    const loading = (harness.fixture.nativeElement as HTMLElement).querySelector('app-board-page');
    expect(loading?.querySelector('[data-source]')).toBeNull();
    release(ok(PLANNING));
    await opened;
  });
});

// T124 · ISC-129.2: at the compact tier the board is one column picked by a wrapping radio `ui-segmented`; the strip
// and the horizontal scroller are not rendered, so nothing on the page can scroll sideways.

describe('BoardPage "Waits on you" sheet bar (spec 020, T24, ISC-240)', () => {
  it('counts every guidance.waits entry in the secondary link to the dashboard\'s #waiting; the start still opens the sheet', async () => {
    const page = await open('/w/harbor/board', undefined, undefined, 'compact');
    const bar = page.querySelector<HTMLElement>('[data-sheet-bar]');
    const link = bar?.querySelector<HTMLAnchorElement>('a[data-waits-link]');
    expect(text(link)).toBe(`Waits on you ${String(dashboard.guidance.waits.length)}`);
    // Spec 070 (ISC-568): one entry per spec, the spec's later items folded under it; the link counts the entries.
    expect(dashboard.guidance.waits.length).toBe(4);
    expect(link?.getAttribute('href')).toBe('/w/harbor#waiting');
    expect(bar?.querySelector('button.bar-open')?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(bar?.querySelector('button a')).toBeNull();
    expect(text(bar)).not.toContain('Needs you');
  });

  it('without guidance (a server without a clock) the bar counts the cards waiting on you', async () => {
    const bare: Record<string, unknown> = { ...dashboard };
    delete bare['guidance'];
    const page = await open('/w/harbor/board', undefined, bare, 'compact');
    expect(text(page.querySelector('[data-sheet-bar] a[data-waits-link]'))).toBe('Waits on you 3');
  });
});

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

// Spec 037 · T32-T34 · ISC-197: with feature swimlanes the bands stand in milestone then rank order, "No feature" last,
// a quiet divider between the milestone groups; each feature band's head starts with a grip button that moves it
// within its milestone through the backlog route (Alt+↑/↓, its "Move" menu, a drop), on a drop list of its own.

describe('board band reorder', () => {
  const HASHED = { ...PLANNING, backlogHash: 'h1' } as PlanningBody;
  /** Harbor with the story `registry-webhooks` taken off F7, so the board holds a band without a feature. */
  const LOOSE = {
    ...HASHED,
    ideas: PLANNING.ideas.map((idea) => (idea.slug === 'registry-webhooks' ? { ...idea, feature: null } : idea)),
  } as PlanningBody;
  const openBands = (planning: PlanningBody = HASHED, tier: Tier = 'wide'): Promise<HTMLElement> =>
    open('/w/harbor/board?group=feature', Promise.resolve(ok(planning)), dashboard, tier);
  const heads = (page: HTMLElement): HTMLElement[] => [...page.querySelectorAll<HTMLElement>('.band-list > .band-head')];
  const ids = (page: HTMLElement): string[] => heads(page).map((h) => text(h.querySelector('.bh .mono')) || '-');
  const grip = (page: HTMLElement, id: string): HTMLButtonElement | null => page.querySelector<HTMLButtonElement>(`[data-band-grip="${id}"]`);
  const press = (el: Element | null, key: string): void => {
    el?.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }));
  };

  beforeEach(() => {
    backlogCalls = [];
    backlogAnswer = WRITTEN;
  });

  it('orders the bands by milestone, then rank, the band without a feature last, a divider only between milestone groups', async () => {
    const page = await openBands(LOOSE);
    expect(ids(page)).toEqual(['F3', 'F2', 'F4', 'F0', 'F5', 'F6', '-']);
    const dividers = [...page.querySelectorAll<HTMLElement>('[data-band-divider]')].map((d) => text(d));
    expect(dividers).toHaveLength(2);
    expect(dividers[0]).toContain('Harbor 1.0');
    expect(dividers[1]).toContain('No milestone');
  });

  it('starts every feature band head with a grip button named after the move; the band without a feature keeps an empty slot', async () => {
    const page = await openBands(LOOSE);
    const f3 = grip(page, 'F3');
    expect(f3?.tagName).toBe('BUTTON');
    expect(f3?.classList.contains('cdk-drag-handle')).toBe(true);
    expect(f3?.getAttribute('aria-label')).toBe('Move F3 · in Harbor 0.9');
    expect(grip(page, 'F0')?.getAttribute('aria-label')).toBe('Move F0 · no milestone');
    expect(heads(page)[0]?.querySelector('.band-sticky')?.firstElementChild).toBe(f3);
    const loose = heads(page).at(-1);
    expect(loose?.querySelector('button')).toBeNull();
    expect(loose?.querySelector('.grip-gap')).not.toBeNull();
  });

  it('Alt+ArrowDown on a grip moves the band below its neighbour, keeps focus on the grip and announces the place', async () => {
    const page = await openBands();
    press(grip(page, 'F0'), 'ArrowDown');
    await settle();
    expect(backlogCalls).toEqual(['F0>F6|h1']);
    expect(ids(page)).toEqual(['F3', 'F2', 'F4', 'F5', 'F0', 'F6', 'F7']);
    expect(document.activeElement).toBe(grip(page, 'F0'));
    expect(text(page.querySelector('[data-band-live]'))).toBe('F0 at position 2 of 4, no milestone');
  });

  // T39 · ISC-198: a refused band move leaves the notice under the band head, with core's phrase; nothing anticipated stays.
  it('board refusal: a 422 leaves the notice under the band head with the reason, the order unmoved, and ✕ dismisses it', async () => {
    backlogAnswer = { kind: 'answer', answer: { status: 422, body: { error: 'backlog-refused', reason: 'F0 already stands there: nothing to move' } } } as unknown as BacklogResult;
    const page = await openBands();
    press(grip(page, 'F0'), 'ArrowDown');
    await settle();
    expect(backlogCalls).toEqual(['F0>F6|h1']);
    expect(ids(page)).toEqual(['F3', 'F2', 'F4', 'F0', 'F5', 'F6', 'F7']);
    const head = heads(page).find((h) => h.dataset['band'] === 'F0');
    const notice = head?.querySelector<HTMLElement>('app-refusal-notice[data-band-refusal]');
    expect(text(notice)).toContain('F0 not moved');
    expect(text(notice)).toContain('F0 already stands there: nothing to move');
    expect(notice?.getAttribute('data-refusal')).toBe('refused');
    notice?.querySelector<HTMLButtonElement>('[data-dismiss]')?.click();
    await settle();
    expect(page.querySelector('app-refusal-notice[data-band-refusal]')).toBeNull();
  });

  it('Alt+ArrowUp at the first band of its milestone sends nothing, and a card does not take Alt+arrows', async () => {
    const page = await openBands();
    press(grip(page, 'F2'), 'ArrowUp');
    press(page.querySelector('.cell app-board-card'), 'ArrowUp');
    await settle();
    expect(backlogCalls).toEqual([]);
  });

  it('a click on the grip opens the move menu for that band; "Move to the end" sends before null', async () => {
    const page = await openBands();
    const f2 = grip(page, 'F2');
    f2?.click();
    await settle();
    expect(f2?.getAttribute('aria-expanded')).toBe('true');
    expect(f2?.getAttribute('aria-haspopup')).toBe('dialog');
    page.querySelector<HTMLButtonElement>('app-reorder-menu [data-step="last"]')?.click();
    await settle();
    expect(backlogCalls).toEqual(['F2>end|h1']);
    expect(ids(page).slice(1, 3)).toEqual(['F4', 'F2']);
    expect(text(page.querySelector('[data-band-live]'))).toBe('F2 at position 2 of 2 in Harbor 1.0');
  });

  it('a drop in its own milestone takes the gap under the pointer; a drop over another milestone sends nothing', async () => {
    const page = await openBands();
    heads(page).forEach((h, i) => {
      h.getBoundingClientRect = () => ({ top: i * 100, bottom: i * 100 + 44, height: 44, left: 0, right: 400, width: 400, x: 0, y: i * 100 }) as DOMRect;
    });
    const bandList = harness.fixture.debugElement.query(By.css('.band-list')).injector.get(CdkDropList);
    const drop = (feature: string, y: number): void =>
      bandList.dropped.emit({ item: { data: feature }, dropPoint: { x: 10, y } } as unknown as CdkDragDrop<unknown>);
    drop('F0', 150);
    await settle();
    expect(backlogCalls).toEqual([]);
    drop('F0', 560);
    await settle();
    expect(backlogCalls).toEqual(['F0>F7|h1']);
  });

  it('keeps the band list apart from the card lists: its own group, and it admits band drags only', async () => {
    const page = await openBands();
    const bandList = harness.fixture.debugElement.query(By.css('.band-list')).injector.get(CdkDropList);
    const pageGroup = harness.fixture.debugElement.query(By.css('app-board-page')).injector.get(CdkDropListGroup);
    expect((pageGroup as unknown as { _items: Set<unknown> })._items.has(bandList)).toBe(false);
    expect(bandList.connectedTo).toEqual([]);
    expect(bandList.enterPredicate({ data: 'F0' } as CdkDrag, bandList)).toBe(true);
    expect(bandList.enterPredicate({ data: { key: 'spec:006' } } as CdkDrag, bandList)).toBe(false);
    expect(page.querySelectorAll('.cell.cdk-drop-list').length).toBeGreaterThan(0);
  });
});
