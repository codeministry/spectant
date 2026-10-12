import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import type { WorkflowStage } from '../../../../../core/src/files';
import type { WriteAnswer } from '../../../../../server/src/writes.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody, type WriteResult } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { ToastService } from '../../shared/ui/toast/toast';
import { BOARD_DRAG_CONFIG, type BoardDrag, dropHint, withMoves } from './board-drag';
import { type BoardCard, boardRowsOf, buildBoard } from './board-model';
import type { BoardPage } from './board-page';

// T125 / T126 · ISC-130: the drag configuration, the hint per column while a card is lifted, the transition a drop
// sends (with the card's rendered hash) and its answers: 200 moves the card with a toast and morphing counts; 422, 409
// and 423 leave a persistent notice under the card and never a toast, and a 409 reloads the planning tree.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const PLANNING = planningGolden as unknown as PlanningBody;
const BOARD = buildBoard({ planning: PLANNING, rows: boardRowsOf(dashboard) });
const cardOf = (key: string): BoardCard => {
  const card = BOARD.cards.find((c) => c.key === key);
  if (!card) throw new Error(`no card ${key}`);
  return card;
};
const C003 = cardOf('spec:003-config-loader'); // tasks → review is the only row move
const NEW_HASH = 'a'.repeat(64);

type Answer = WriteAnswer<'transition'>;
type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'putBoardQuery' | 'transition'>;

let harness: RouterTestingHarness;
let calls: Array<{ ws: string; id: string; to: WorkflowStage; hash: string }>;
let planningLoads: number;

async function open(answer: WriteResult<'transition'>, tier: Tier = 'wide', url = '/w/harbor/board'): Promise<{ page: HTMLElement; drag: BoardDrag }> {
  calls = [];
  planningLoads = 0;
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(dashboard)),
    planning: () => {
      planningLoads++;
      return Promise.resolve(ok(PLANNING));
    },
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: '' })),
    putBoardQuery: (_ws, query) => Promise.resolve({ kind: 'ok', body: { query } }),
    transition: (ws, id, to, hash) => {
      calls.push({ ws, id, to, hash });
      return Promise.resolve(answer);
    },
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true }),
    ],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
  TestBed.inject(ShellState).tier.set(tier);
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle();
  const el = harness.fixture.debugElement.query(By.css('app-board-page'));
  return { page: el.nativeElement as HTMLElement, drag: (el.componentInstance as BoardPage).drag };
}

async function settle(): Promise<void> {
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const drops = (page: HTMLElement): Record<string, string | null> =>
  Object.fromEntries(
    [...page.querySelectorAll<HTMLElement>('.scroller [data-col]')].map((c): [string, string | null] => [c.dataset['col'] ?? '', c.getAttribute('data-drop')]),
  );
const answer = (a: Answer): WriteResult<'transition'> => ({ kind: 'answer', answer: a });
const written = (from: WorkflowStage, to: WorkflowStage): Answer => ({
  status: 200,
  body: { from, to, hash: NEW_HASH, event: { ts: '2026-10-12T10:00:00Z', from, to, command: 'spectant transition', actor: 'a:spectant:app' }, lockSource: 'none' },
});

describe('the drag configuration and the hints (T125, ISC-130)', () => {
  it('lifts a touch after 350 ms and a mouse at once, and never sorts', () => {
    expect(BOARD_DRAG_CONFIG.dragStartDelay).toEqual({ touch: 350, mouse: 0 });
    expect(BOARD_DRAG_CONFIG.sortingDisabled).toBe(true);
  });

  it('judges a column by the card: current, allowed by the table, a fixed gate, or not next', () => {
    expect(dropHint(C003, 'tasks')).toBe('current');
    expect(dropHint(C003, 'review')).toBe('allowed');
    expect(dropHint(C003, 'build')).toBe('gate');
    expect(dropHint(C003, 'done')).toBe('gate');
    expect(dropHint(C003, 'close')).toBe('not-next');
    // an allowed fixed gate stays allowed: core may still refuse it (the reviewed mark)
    expect(dropHint(cardOf('spec:006-partial-push'), 'build')).toBe('allowed');
  });

  it('applies an accepted move until the tree shows another hash', () => {
    const hash = C003.hash ?? '';
    const moved = withMoves(PLANNING, [{ slug: C003.slug, from: 'tasks', to: 'review', hash, written: NEW_HASH }]);
    expect(moved.stageCounts.tasks).toBe(0);
    expect(moved.stageCounts.review).toBe(3);
    expect(moved.features.flatMap((f) => f.holders).filter((h) => h.slug === C003.slug).every((h) => h.stage === 'review' && h.hash === NEW_HASH)).toBe(true);
    // the reloaded tree carries the new hash: the move is inert, the server's tree is the truth
    expect(withMoves(moved, [{ slug: C003.slug, from: 'tasks', to: 'review', hash, written: NEW_HASH }])).toBe(moved);
  });
});

describe('BoardDrag on the board page (T125, ISC-130)', () => {
  afterEach(() => TestBed.inject(ToastService).dismiss());

  it('marks the allowed columns and hints the others while a card is lifted, and nothing after', async () => {
    const { page, drag } = await open(answer(written('tasks', 'review')));
    expect(page.hasAttribute('data-dragging')).toBe(false);
    drag.start(C003);
    await settle();
    expect(page.hasAttribute('data-dragging')).toBe(true);
    const hints = drops(page);
    expect(hints['tasks']).toBe('current');
    expect(hints['review']).toBe('allowed');
    expect(hints['build']).toBe('gate');
    expect(hints['close']).toBe('not-next');
    expect(text(page.querySelector('[data-col="close"] [data-hint="not-next"]'))).toBe('not next from Tasks');
    expect(text(page.querySelector('[data-col="build"] [data-hint="gate"]'))).toBe('gate');
    // a stub keeps its fixed track while it shows a hint
    expect(page.querySelector('[data-col="plan"]')?.hasAttribute('data-stub')).toBe(true);
    drag.end();
    await settle();
    expect(Object.values(drops(page)).every((h) => h === null)).toBe(true);
  });

  it('opens the compact tray during a drag and hints its slots', async () => {
    const { page } = await open(answer(written('tasks', 'review')), 'compact', '/w/harbor/board?col=tasks');
    const grip = page.querySelector<HTMLElement>('app-board-card[data-key="spec:003-config-loader"]');
    expect(grip).not.toBeNull();
    const pageCmp = harness.fixture.debugElement.query(By.css('app-board-page')).componentInstance as unknown as { dragStarted(c: BoardCard): void };
    pageCmp.dragStarted(C003);
    await settle();
    const tray = page.querySelector<HTMLElement>('[data-tray]');
    expect(tray?.hasAttribute('data-open')).toBe(true);
    expect(tray?.querySelector('[data-drop-col="review"]')?.getAttribute('data-drop')).toBe('allowed');
    expect(tray?.querySelector('[data-drop-col="done"]')?.getAttribute('data-drop')).toBe('gate');
  });

  it('sends the transition with the rendered hash and, on 200, moves the card with a toast and morphing counts', async () => {
    const { page, drag } = await open(answer(written('tasks', 'review')));
    const loads = planningLoads;
    await drag.drop('harbor', C003, 'review');
    expect(calls).toEqual([{ ws: 'harbor', id: '003', to: 'review', hash: C003.hash }]);
    expect(TestBed.inject(ToastService).message()).toBe('003 → Review');
    expect(drag.morph()).toEqual(['tasks', 'review']);
    expect(drag.moved()).toBe(C003.key);
    harness.fixture.detectChanges();
    expect(page.querySelector('[data-col="review"] app-board-card[data-key="spec:003-config-loader"]')).not.toBeNull();
    expect(text(page.querySelector('[data-col="review"] .head .count'))).toBe('3');
    expect(page.querySelector('[data-col="review"] .head .count')?.hasAttribute('data-morph')).toBe(true);
    expect(page.querySelector('[data-col="tasks"]')?.hasAttribute('data-stub')).toBe(true);
    expect(page.querySelector('li[data-moved] app-board-card')?.getAttribute('data-key')).toBe(C003.key);
    expect(page.querySelector('app-refusal-notice')).toBeNull();
    await settle();
    expect(planningLoads).toBeGreaterThan(loads);
  });

  it('sends nothing for the own column, a story or a card without hash', async () => {
    const { drag } = await open(answer(written('tasks', 'review')));
    await drag.drop('harbor', C003, 'tasks');
    await drag.drop('harbor', cardOf('idea:registry-webhooks'), 'plan');
    await drag.drop('harbor', { ...C003, hash: null }, 'review');
    await drag.drop('harbor', C003, null);
    expect(calls).toEqual([]);
    expect(drag.draggable(cardOf('idea:registry-webhooks'))).toBe(false);
  });
});

describe('the refusal notice (T126, ISC-130)', () => {
  afterEach(() => TestBed.inject(ToastService).dismiss());

  const notice = (page: HTMLElement): HTMLElement | null => page.querySelector<HTMLElement>('[data-key="spec:003-config-loader"] + app-refusal-notice');

  it('422: the card stays, the notice under it carries core\'s phrase and the command chip, and no toast shows', async () => {
    const refused: Answer = { status: 422, body: { error: 'transition-refused', reason: 'waits for its tasks', command: '/spec-tasks 003' } };
    const { page, drag } = await open(answer(refused));
    await drag.drop('harbor', C003, 'build');
    await settle();
    expect(page.querySelector('[data-col="tasks"] app-board-card[data-key="spec:003-config-loader"]')).not.toBeNull();
    const n = notice(page);
    expect(n?.getAttribute('data-refusal')).toBe('refused');
    expect(text(n?.querySelector('[data-head]'))).toBe('Not moved — 003 cannot enter Build');
    expect(text(n?.querySelector('ui-reason .phrase'))).toBe('waits for its tasks');
    expect(text(n?.querySelector('ui-command-chip code'))).toBe('/spec-tasks 003');
    expect(n?.querySelector('ui-notice')?.getAttribute('role')).toBe('alert');
    expect(TestBed.inject(ToastService).message()).toBeNull();
  });

  it('409: the stale text, no command, no toast, and the planning tree reloads', async () => {
    const stale: Answer = { status: 409, body: { error: 'hash-mismatch', files: ['spec.md'], expected: { spec: NEW_HASH } } };
    const { page, drag } = await open(answer(stale));
    const loads = planningLoads;
    await drag.drop('harbor', C003, 'review');
    await settle();
    const n = notice(page);
    expect(n?.getAttribute('data-refusal')).toBe('stale');
    expect(text(n?.querySelector('ui-reason .phrase'))).toBe('003 changed on disk · the board refreshed');
    expect(n?.querySelector('ui-command-chip')).toBeNull();
    expect(planningLoads).toBe(loads + 1);
    expect(TestBed.inject(ToastService).message()).toBeNull();
  });

  it('423: the locked text names the session and the claim; the ✕ closes the notice', async () => {
    const locked: Answer = {
      status: 423,
      body: { error: 'locked', lock: { source: 'activity', claim: 'ISC-74', session: 'a:claude:sess-2', actor: { kind: 'agent', id: 'a:claude:sess-2' }, since: '2026-10-12T09:00:00Z' } },
    } as Answer;
    const { page, drag } = await open(answer(locked));
    await drag.drop('harbor', C003, 'review');
    await settle();
    const n = notice(page);
    expect(n?.getAttribute('data-refusal')).toBe('locked');
    expect(text(n?.querySelector('ui-reason .phrase'))).toBe('writes paused · a:claude:sess-2 holds ISC-74');
    expect(TestBed.inject(ToastService).message()).toBeNull();
    n?.querySelector<HTMLButtonElement>('[data-dismiss]')?.click();
    await settle();
    expect(notice(page)).toBeNull();
  });

  it('survives until the card is lifted again', async () => {
    const refused: Answer = { status: 422, body: { error: 'transition-refused', reason: 'waits for its tasks', command: null } };
    const { page, drag } = await open(answer(refused));
    await drag.drop('harbor', C003, 'close');
    await settle();
    expect(notice(page)?.querySelector('ui-command-chip')).toBeNull();
    harness.fixture.detectChanges();
    expect(notice(page)).not.toBeNull();
    drag.start(C003);
    await settle();
    expect(notice(page)).toBeNull();
  });
});
