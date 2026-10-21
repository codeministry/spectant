import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import type { IdeaPage } from '../../../../../server/src/contracts/spec-routes.contract';
import type { WriteAnswer } from '../../../../../server/src/contracts/writes.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody, type WriteResult } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { ToastService } from '../../shared/ui/toast/toast';
import type { BoardDrag } from './board-drag';
import { type BoardCard, boardRowsOf, buildBoard } from './board-model';
import type { BoardPage } from './board-page';

// T128 · ISC-130.2: a story card is draggable with the board's one configuration, and its only target is the first
// stage of its type. Dropping it there, choosing that stage in "Move to…" or Shift+→ opens a confirmation `<dialog>`
// naming the folder that will be created (`specs/NNN-slug/`, the number the server's) and the story file that will be
// removed. Confirm sends the allocation once with the story file's hash and opens the new spec; a 422 leaves the
// refusal notice with its reason under the card; Cancel and Esc send nothing.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const PLANNING = planningGolden as unknown as PlanningBody;
const BOARD = buildBoard({ planning: PLANNING, rows: boardRowsOf(dashboard) });
const cardOf = (key: string): BoardCard => {
  const card = BOARD.cards.find((c) => c.key === key);
  if (!card) throw new Error(`no card ${key}`);
  return card;
};
const STORY = cardOf('idea:console-audit-log'); // type feature: plan is its first stage
const STORY_HASH = 'b'.repeat(64);

type Answer = WriteAnswer<'allocate'>;
type FakeApi = Pick<
  ApiClient,
  'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'putBoardQuery' | 'transition' | 'allocate' | 'idea'
>;

let harness: RouterTestingHarness;
let allocations: Array<{ ws: string; slug: string; hash: string }>;
let transitions: number;
let planningLoads: number;

function stubOverlays(): void {
  const el = HTMLElement.prototype as unknown as Record<string, unknown>;
  el['showPopover'] = vi.fn(function (this: HTMLElement) {
    this.setAttribute('data-shown', '');
  });
  el['hidePopover'] = vi.fn(function (this: HTMLElement) {
    this.removeAttribute('data-shown');
    this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
  });
  const dialog = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dialog['showModal'] = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  dialog['close'] = vi.fn(function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
}

const allocated: Answer = {
  status: 200,
  body: {
    id: '010',
    folder: 'specs/010-console-audit-log/',
    files: ['specs/010-console-audit-log/context.md', 'specs/010-console-audit-log/spec.md', 'specs/010-console-audit-log/events.jsonl'],
    removed: 'specs/ideas/console-audit-log.md',
    lockSource: 'none',
  },
};

async function open(answer: WriteResult<'allocate'>, tier: Tier = 'wide', url = '/w/harbor/board'): Promise<{ page: HTMLElement; drag: BoardDrag }> {
  allocations = [];
  transitions = 0;
  planningLoads = 0;
  stubOverlays();
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
    transition: () => {
      transitions++;
      return Promise.resolve({ kind: 'error', status: 500 });
    },
    idea: (_ws, slug) => {
      const idea = PLANNING.ideas.find((i) => i.slug === slug);
      if (!idea) return Promise.resolve({ kind: 'not-found', served: true });
      const page = { title: idea.title, html: '', headings: [], frontmatter: {} } as unknown as IdeaPage['page'];
      return Promise.resolve(ok({ idea, page, hash: STORY_HASH }));
    },
    allocate: (ws, slug, hash) => {
      allocations.push({ ws, slug, hash });
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
  document.body.appendChild(harness.fixture.nativeElement as HTMLElement);
  await harness.navigateByUrl(url);
  await settle();
  const el = harness.fixture.debugElement.query(By.css('app-board-page'));
  return { page: el.nativeElement as HTMLElement, drag: (el.componentInstance as BoardPage).drag };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
  }
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const dialogOf = (page: HTMLElement): HTMLElement | null => page.querySelector<HTMLElement>('[data-allocate-dialog]');
const button = (page: HTMLElement, attr: string): HTMLButtonElement | null => page.querySelector<HTMLButtonElement>(`[${attr}]`);
const notice = (page: HTMLElement): HTMLElement | null => page.querySelector<HTMLElement>(`[data-key="${STORY.key}"] + app-refusal-notice`);

afterEach(() => {
  TestBed.inject(ToastService).dismiss();
  (harness.fixture.nativeElement as HTMLElement).remove();
});

describe('a story on the board (T128, ISC-130.2)', () => {
  it('is draggable, and its one target is the first stage of its type', async () => {
    const { drag } = await open({ kind: 'answer', answer: allocated });
    expect(STORY.targets).toEqual(['plan']);
    expect(drag.draggable(STORY)).toBe(true);
    expect(drag.draggable({ ...STORY, targets: [] })).toBe(false);
  });

  it('dropped anywhere but its target asks nothing and sends nothing', async () => {
    const { page, drag } = await open({ kind: 'answer', answer: allocated });
    expect(await drag.move('harbor', STORY, 'build')).toBe('none');
    expect(await drag.move('harbor', STORY, 'idea')).toBe('none');
    await settle();
    expect(dialogOf(page)).toBeNull();
    expect(allocations).toEqual([]);
    expect(transitions).toBe(0);
  });
});

describe('the allocation dialog (T128, ISC-130.2)', () => {
  it('a drop on the first stage opens the dialog naming the folder it creates and the story file it removes', async () => {
    const { page, drag } = await open({ kind: 'answer', answer: allocated });
    expect(await drag.move('harbor', STORY, 'plan')).toBe('asked');
    await settle();
    const d = dialogOf(page);
    expect(d).not.toBeNull();
    expect(d?.closest('dialog')?.hasAttribute('open')).toBe(true);
    expect(text(d?.closest('dialog')?.querySelector('h2'))).toBe('Make this idea a spec?');
    expect(text(d?.querySelector('[data-allocate-folder]'))).toBe('specs/NNN-console-audit-log/');
    expect([...(d?.querySelectorAll('[data-allocate-file]') ?? [])].map(text)).toEqual(['context.md', 'spec.md', 'events.jsonl']);
    expect(text(d?.querySelector('[data-allocate-number]'))).toBe('NNN is the next free spec number; it is set when the folder is written.');
    expect(text(d?.querySelector('[data-allocate-story]'))).toBe('specs/ideas/console-audit-log.md');
    expect(button(page, 'data-allocate-confirm')?.getAttribute('aria-disabled')).toBeNull();
    expect(transitions).toBe(0);
  });

  it('Cancel and Esc close it and send nothing', async () => {
    const { page, drag } = await open({ kind: 'answer', answer: allocated });
    await drag.move('harbor', STORY, 'plan');
    await settle();
    button(page, 'data-allocate-cancel')?.click();
    await settle();
    expect(dialogOf(page)).toBeNull();
    expect(drag.allocating()).toBeNull();

    await drag.move('harbor', STORY, 'plan');
    await settle();
    const d = dialogOf(page)?.closest('dialog');
    d?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(dialogOf(page)).toBeNull();
    expect(allocations).toEqual([]);
  });

  it('Confirm sends the allocation once with the story file\'s hash and opens the new spec', async () => {
    const { page, drag } = await open({ kind: 'answer', answer: allocated });
    const loads = planningLoads;
    await drag.move('harbor', STORY, 'plan');
    await settle();
    button(page, 'data-allocate-confirm')?.click();
    button(page, 'data-allocate-confirm')?.click();
    await settle();
    expect(allocations).toEqual([{ ws: 'harbor', slug: 'console-audit-log', hash: STORY_HASH }]);
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/010');
    expect(planningLoads).toBeGreaterThan(loads);
  });

  it('a 422 closes the dialog and leaves the refusal notice with its reason under the card', async () => {
    const refused: Answer = { status: 422, body: { error: 'allocate-refused', reason: 'not-in-index', folder: 'specs/010-console-audit-log/' } };
    const { page, drag } = await open({ kind: 'answer', answer: refused });
    await drag.move('harbor', STORY, 'plan');
    await settle();
    button(page, 'data-allocate-confirm')?.click();
    await settle();
    expect(allocations).toHaveLength(1);
    expect(dialogOf(page)).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/w/harbor/board');
    const n = notice(page);
    expect(n?.getAttribute('data-refusal')).toBe('unallocated');
    expect(text(n?.querySelector('[data-head]'))).toBe('Not allocated — console-audit-log stays an idea');
    expect(text(n?.querySelector('ui-reason .phrase'))).toBe('The ideas index specs/ideas/README.md does not name console-audit-log');
    expect(document.activeElement).toBe(page.querySelector(`app-board-card[data-key="${STORY.key}"] [data-grip]`));
  });

  it('a folder-exists 422 names the folder; a 409 reloads the board', async () => {
    const exists: Answer = { status: 422, body: { error: 'allocate-refused', reason: 'folder-exists', folder: 'specs/010-console-audit-log/' } };
    let { page, drag } = await open({ kind: 'answer', answer: exists });
    await drag.move('harbor', STORY, 'plan');
    await settle();
    button(page, 'data-allocate-confirm')?.click();
    await settle();
    expect(text(notice(page)?.querySelector('ui-reason .phrase'))).toBe('specs/010-console-audit-log/ already exists');
    (harness.fixture.nativeElement as HTMLElement).remove();
    TestBed.resetTestingModule();

    const stale: Answer = { status: 409, body: { error: 'hash-mismatch', files: ['specs/ideas/console-audit-log.md'], expected: { idea: 'c'.repeat(64) } } };
    ({ page, drag } = await open({ kind: 'answer', answer: stale }));
    const loads = planningLoads;
    await drag.move('harbor', STORY, 'plan');
    await settle();
    button(page, 'data-allocate-confirm')?.click();
    await settle();
    expect(planningLoads).toBe(loads + 1);
    expect(notice(page)?.getAttribute('data-refusal')).toBe('stale');
  });

  it('the story\'s "Move to…" entry and Shift+→ open the same dialog', async () => {
    const { page, drag } = await open({ kind: 'answer', answer: allocated });
    const card = page.querySelector<HTMLElement>(`app-board-card[data-key="${STORY.key}"]`);
    card?.querySelector<HTMLElement>('[data-grip]')?.click();
    await settle();
    const plan = page.querySelector<HTMLButtonElement>('[data-move-menu] [data-move-to="plan"]');
    expect(plan?.getAttribute('aria-disabled')).toBeNull();
    expect(page.querySelector('[data-move-menu] [data-move-to="build"]')?.getAttribute('aria-disabled')).toBe('true');
    plan?.click();
    await settle();
    expect(dialogOf(page)).not.toBeNull();
    expect(page.querySelector('[popover][data-shown]')).toBeNull();
    button(page, 'data-allocate-cancel')?.click();
    await settle();
    expect(drag.allocating()).toBeNull();

    card?.querySelector<HTMLElement>('[data-grip]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(dialogOf(page)).not.toBeNull();
    expect(allocations).toEqual([]);
    expect(transitions).toBe(0);
  });
});
