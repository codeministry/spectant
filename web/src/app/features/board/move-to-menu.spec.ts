import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
import { type BoardCard, boardRowsOf, buildBoard } from './board-model';
import { stepTarget } from './move-to-menu';

// T127 · ISC-130: the single-pointer and keyboard path to a move (WCAG 2.5.7). A click on the grip opens "Move to…"
// with one entry per board stage, the current one marked, the allowed ones enabled and the others disabled with the
// drag hint's words; an entry sends the drop's transition; Shift+←/→ on the card moves to the previous or next allowed
// stage without the menu; Esc closes it and focus goes back to the grip. A `<dialog>` sheet at compact, an anchored
// popover at medium and wide. jsdom has neither the Popover API nor `showModal()`: both are stubbed as the browser
// behaves (popover.spec.ts, dialog.spec.ts); top layer and the anchored geometry belong to the browser tier.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const PLANNING = planningGolden as unknown as PlanningBody;
const BOARD = buildBoard({ planning: PLANNING, rows: boardRowsOf(dashboard) });
const cardOf = (key: string): BoardCard => {
  const card = BOARD.cards.find((c) => c.key === key);
  if (!card) throw new Error(`no card ${key}`);
  return card;
};
const C003 = cardOf('spec:003-config-loader'); // tasks; review (earlier on the board) is its only move
const C006 = cardOf('spec:006-partial-push'); // review; build (next on the board) is its only move
const NEW_HASH = 'a'.repeat(64);

type Answer = WriteAnswer<'transition'>;
type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'putBoardQuery' | 'transition'>;

let harness: RouterTestingHarness;
/** Whether the current test opened the page; the pure `stepTarget` test does not. */
let opened = false;
let calls: Array<{ ws: string; id: string; to: WorkflowStage; hash: string }>;
let showPopover: ReturnType<typeof vi.fn>;
let showModal: ReturnType<typeof vi.fn>;

function stubOverlays(): void {
  const el = HTMLElement.prototype as unknown as Record<string, unknown>;
  showPopover = vi.fn(function (this: HTMLElement) {
    this.setAttribute('data-shown', '');
  });
  el['showPopover'] = showPopover;
  el['hidePopover'] = vi.fn(function (this: HTMLElement) {
    this.removeAttribute('data-shown');
    this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
  });
  const dialog = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  dialog['showModal'] = showModal;
  dialog['close'] = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
}

const written = (from: WorkflowStage, to: WorkflowStage): WriteResult<'transition'> => ({
  kind: 'answer',
  answer: {
    status: 200,
    body: { from, to, hash: NEW_HASH, event: { ts: '2026-10-12T10:00:00Z', from, to, command: 'spectant transition', actor: 'a:spectant:app' }, lockSource: 'none' },
  },
});

/** Harbor with 003 held by a running `/spec tasks 003` (spec 040, T58): the dashboard row's state as core serves it. */
const RUNNING = {
  ...dashboard,
  specs: dashboard.specs.map((row) =>
    row.id === '003'
      ? {
          ...row,
          state: {
            kind: 'spec',
            id: '003',
            state: 'running',
            stage: 'tasks',
            run: {
              run: 'r-0308-1452',
              command: '/spec tasks 003',
              session: 'a:claude:sess-32',
              actor: { raw: 'a:claude:sess-32', kind: 'agent', id: 'a:claude:sess-32', legacy: false },
              since: '2026-03-08T14:52:00Z',
              elapsedMs: 480_000,
              openRuns: 1,
              source: 'run',
            },
          },
        }
      : row,
  ),
} as typeof dashboard;

async function open(answer: WriteResult<'transition'>, tier: Tier = 'wide', url = '/w/harbor/board', dash: typeof dashboard = dashboard): Promise<HTMLElement> {
  calls = [];
  stubOverlays();
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(dash)),
    planning: () => Promise.resolve(ok(PLANNING)),
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
  opened = true;
  document.body.appendChild(harness.fixture.nativeElement as HTMLElement);
  await harness.navigateByUrl(url);
  await settle();
  const page = document.querySelector<HTMLElement>('app-board-page');
  if (!page) throw new Error('no board page');
  return page;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  }
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const cardEl = (page: HTMLElement, key: string): HTMLElement => {
  const found = page.querySelector<HTMLElement>(`app-board-card[data-key="${key}"]`);
  if (!found) throw new Error(`no card element ${key}`);
  return found;
};
const gripOf = (page: HTMLElement, key: string): HTMLButtonElement => {
  const grip = cardEl(page, key).querySelector<HTMLButtonElement>('[data-grip]');
  if (!grip) throw new Error(`no grip on ${key}`);
  return grip;
};
const menu = (page: HTMLElement): HTMLElement | null => page.querySelector<HTMLElement>('[data-move-menu]');
const entry = (page: HTMLElement, stage: WorkflowStage): HTMLButtonElement | null =>
  page.querySelector<HTMLButtonElement>(`[data-move-menu] [data-move-to="${stage}"]`);
const shiftArrow = (target: HTMLElement, key: 'ArrowLeft' | 'ArrowRight'): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true, cancelable: true }));
};
const escape = (page: HTMLElement): void => {
  (document.activeElement ?? page).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};
const restart = (): void => {
  (harness.fixture.nativeElement as HTMLElement).remove();
  TestBed.resetTestingModule();
};

afterEach(() => {
  if (!opened) return;
  opened = false;
  TestBed.inject(ToastService).dismiss();
  (harness.fixture.nativeElement as HTMLElement).remove();
});

describe('stepTarget (T127)', () => {
  it('names the previous or next allowed stage in board order, or null', () => {
    expect(stepTarget(C006, BOARD.stages, 1)).toBe('build');
    expect(stepTarget(C006, BOARD.stages, -1)).toBeNull();
    expect(stepTarget(C003, BOARD.stages, -1)).toBe('review');
    expect(stepTarget(C003, BOARD.stages, 1)).toBeNull();
    // build → blocked and code-review: the nearest one wins
    expect(stepTarget(cardOf('spec:002-web-console'), BOARD.stages, 1)).toBe('blocked');
    // a story's one target is the first stage of its type
    expect(stepTarget(cardOf('idea:registry-webhooks'), BOARD.stages, 1)).toBe('plan');
  });
});

describe('the Move to… menu (T127, ISC-130)', () => {
  it('a grip click opens one entry per board stage: the current marked, allowed enabled, the rest disabled with the hint', async () => {
    const page = await open(written('tasks', 'review'));
    const grip = gripOf(page, C003.key);
    expect(grip.tagName).toBe('BUTTON');
    expect(grip.getAttribute('aria-label')).toBe('Move 003');
    grip.click();
    await settle();
    const m = menu(page);
    expect(m).not.toBeNull();
    const stages = [...(m?.querySelectorAll<HTMLElement>('[data-move-to]') ?? [])].map((e) => e.dataset['moveTo']);
    expect(stages).toEqual([...PLANNING.stages]);
    expect(entry(page, 'tasks')?.getAttribute('aria-current')).toBe('true');
    expect(entry(page, 'tasks')?.getAttribute('aria-disabled')).toBe('true');
    expect(text(entry(page, 'tasks'))).toBe('Tasks current');
    expect(entry(page, 'review')?.getAttribute('aria-disabled')).toBeNull();
    expect(text(entry(page, 'review'))).toBe('Review');
    expect(entry(page, 'build')?.getAttribute('aria-disabled')).toBe('true');
    expect(text(entry(page, 'build'))).toBe('Build gate');
    expect(entry(page, 'close')?.getAttribute('aria-disabled')).toBe('true');
    expect(text(entry(page, 'close'))).toBe('Close not next from Tasks');
    // the first allowed entry takes focus
    expect(document.activeElement).toBe(entry(page, 'review'));
  });

  it('is a popover anchored to the grip at wide and medium, a modal <dialog> at compact', async () => {
    let page = await open(written('tasks', 'review'), 'medium');
    gripOf(page, C003.key).click();
    await settle();
    expect(menu(page)?.closest('[popover]')).not.toBeNull();
    expect(menu(page)?.closest('dialog')).toBeNull();
    expect(showPopover).toHaveBeenCalledTimes(1);
    expect(menu(page)?.getAttribute('data-surface')).toBe('popover');
    restart();

    page = await open(written('tasks', 'review'), 'compact', '/w/harbor/board?col=tasks');
    gripOf(page, C003.key).click();
    await settle();
    const dialog = menu(page)?.closest('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(menu(page)?.getAttribute('data-surface')).toBe('sheet');
    expect(text(dialog?.querySelector('h2'))).toBe(`Move 003 · ${C003.title}`);
  });

  it('a disabled entry sends nothing', async () => {
    const page = await open(written('tasks', 'review'));
    gripOf(page, C003.key).click();
    await settle();
    entry(page, 'close')?.click();
    entry(page, 'tasks')?.click();
    await settle();
    expect(calls).toEqual([]);
  });

  it("choosing an allowed entry sends the drop's transition once with the card's hash, closes, and focuses the moved grip", async () => {
    const page = await open(written('tasks', 'review'));
    gripOf(page, C003.key).click();
    await settle();
    entry(page, 'review')?.click();
    await settle();
    expect(calls).toEqual([{ ws: 'harbor', id: '003', to: 'review', hash: C003.hash }]);
    expect(TestBed.inject(ToastService).message()).toBe('003 → Review');
    expect(page.querySelector('[popover][data-shown]')).toBeNull();
    const moved = page.querySelector<HTMLElement>('[data-col="review"] app-board-card[data-key="spec:003-config-loader"] [data-grip]');
    expect(moved).not.toBeNull();
    expect(document.activeElement).toBe(moved);
  });

  it('a refused entry keeps the menu open with the refusal notice under that entry', async () => {
    const refused: Answer = { status: 422, body: { error: 'transition-refused', reason: 'waits for its tasks', command: '/spec tasks 003' } };
    const page = await open({ kind: 'answer', answer: refused });
    gripOf(page, C003.key).click();
    await settle();
    entry(page, 'review')?.click();
    await settle();
    expect(calls).toHaveLength(1);
    expect(page.querySelector('[popover][data-shown]')).not.toBeNull();
    const notice = entry(page, 'review')?.parentElement?.querySelector('app-refusal-notice');
    expect(notice?.getAttribute('data-refusal')).toBe('refused');
    expect(text(notice?.querySelector('ui-reason .phrase'))).toBe('waits for its tasks');
    expect(TestBed.inject(ToastService).message()).toBeNull();
  });

  it('Esc closes the menu and returns focus to the grip, at wide and at compact', async () => {
    let page = await open(written('tasks', 'review'));
    let grip = gripOf(page, C003.key);
    grip.click();
    await settle();
    expect(document.activeElement).not.toBe(grip);
    escape(page);
    await settle();
    expect(page.querySelector('[popover][data-shown]')).toBeNull();
    expect(document.activeElement).toBe(grip);
    expect(calls).toEqual([]);
    restart();

    page = await open(written('tasks', 'review'), 'compact', '/w/harbor/board?col=tasks');
    grip = gripOf(page, C003.key);
    grip.click();
    await settle();
    const dialog = menu(page)?.closest('dialog');
    expect(dialog?.hasAttribute('open')).toBe(true);
    escape(page);
    await settle();
    expect(dialog?.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(grip);
  });
});

describe('Shift+←/→ on a focused card (T127, ISC-130)', () => {
  it('Shift+→ moves to the next allowed stage through the same transition, without a menu, and focuses the moved grip', async () => {
    const page = await open(written('review', 'build'));
    const link = cardEl(page, C006.key).querySelector<HTMLElement>('a.title');
    link?.focus();
    shiftArrow(link ?? page, 'ArrowRight');
    await settle();
    expect(calls).toEqual([{ ws: 'harbor', id: '006', to: 'build', hash: C006.hash }]);
    expect(menu(page)).toBeNull();
    expect(showPopover).not.toHaveBeenCalled();
    const moved = page.querySelector<HTMLElement>('[data-col="build"] app-board-card[data-key="spec:006-partial-push"] [data-grip]');
    expect(moved).not.toBeNull();
    expect(document.activeElement).toBe(moved);
  });

  it('Shift+← moves to the previous allowed stage; no allowed stage that way sends nothing', async () => {
    const page = await open(written('tasks', 'review'));
    const grip = gripOf(page, C003.key);
    grip.focus();
    shiftArrow(grip, 'ArrowRight');
    await settle();
    expect(calls).toEqual([]);
    shiftArrow(grip, 'ArrowLeft');
    await settle();
    expect(calls).toEqual([{ ws: 'harbor', id: '003', to: 'review', hash: C003.hash }]);
  });

  it('at compact the board follows the moved card to its column and focuses its grip', async () => {
    const page = await open(written('review', 'build'), 'compact', '/w/harbor/board?col=review');
    const grip = gripOf(page, C006.key);
    grip.focus();
    shiftArrow(grip, 'ArrowRight');
    await settle();
    await settle();
    expect(page.querySelector('section.one')?.getAttribute('data-col')).toBe('build');
    const moved = page.querySelector('section.one app-board-card[data-key="spec:006-partial-push"] [data-grip]');
    expect(moved).not.toBeNull();
    expect(document.activeElement).toBe(moved);
  });
});

// Spec 040 (T58, ISC-225.1): at compact a running card's ellipsis still opens "Move to…", every entry disabled, the
// run's refusal (the notice the drag and the keys show) above them without its ✕; nothing is sent.
describe('Move to… for a card a running run holds (T58, ISC-225.1)', () => {
  it('every entry is disabled and the run refusal stands above them; a choice sends nothing', async () => {
    const page = await open(written('tasks', 'review'), 'compact', '/w/harbor/board?col=tasks', RUNNING);
    gripOf(page, C003.key).click();
    await settle();
    const list = menu(page);
    expect(list).not.toBeNull();
    const entries = [...(list?.querySelectorAll<HTMLButtonElement>('[data-move-to]') ?? [])];
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.every((e) => e.getAttribute('aria-disabled') === 'true')).toBe(true);
    const notice = list?.parentElement?.querySelector<HTMLElement>('app-refusal-notice[data-move-run]');
    expect(notice?.getAttribute('data-refusal')).toBe('run-locked');
    expect(notice?.compareDocumentPosition(list as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(text(notice?.querySelector('[data-head]'))).toBe('Not moved — 003 is running: /spec tasks 003 · a:claude:sess-32 · since 8 min');
    expect(notice?.querySelector('[data-dismiss]')).toBeNull();
    entry(page, 'review')?.click();
    await settle();
    expect(calls).toEqual([]);
  });

  it('a card no run holds shows no run notice', async () => {
    const page = await open(written('tasks', 'review'), 'compact', '/w/harbor/board?col=review', RUNNING);
    gripOf(page, C006.key).click();
    await settle();
    expect(menu(page)).not.toBeNull();
    expect(page.querySelector('app-refusal-notice[data-move-run]')).toBeNull();
  });
});
