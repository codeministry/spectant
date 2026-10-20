import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkspaceAdminSummary } from '../../../../../server/src/workspace-admin.contract';
import { ApiClient, type ApiResult, type WorkspaceAdminResult, type WorkspaceListEntry } from '../../core/api.service';
import { DemoData } from '../../shared/demo/demo-data';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { SettingsService } from '../../core/settings.service';
import { UiSortMenu } from '../../shared/ui/sort-menu/sort-menu';
import { SettingsWorkspacesPage } from './settings-workspaces-page';
import { WorkspaceRow } from './workspace-row';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

/** The Api stub's registry: two workspaces, one readable with specs, one whose folder is gone. */
const TWO: readonly WorkspaceListEntry[] = [
  { slug: 'harbor', name: 'Harbor', pathTail: 'harbor', readable: true, counts: { specs: 4, building: 2 }, status: 'ok' },
  { slug: 'quay', name: 'Quay', pathTail: 'quay', readable: false, error: 'missing', counts: null, status: 'missing' },
];

interface Calls {
  lists: number;
  adds: unknown[];
  renames: Array<readonly [string, string]>;
  /** Every other admin call: re-scan, remove and the uploads. */
  writes: string[];
}

const failed = { kind: 'error', status: 500 } as const;

function setUp(
  list: () => Promise<ApiResult<readonly WorkspaceListEntry[]>> = () => Promise.resolve(ok(TWO)),
  add: () => Promise<WorkspaceAdminResult<'add'>> = () => Promise.resolve(failed),
  rename: () => Promise<WorkspaceAdminResult<'rename'>> = () => Promise.resolve(failed),
): Calls {
  const calls: Calls = { lists: 0, adds: [], renames: [], writes: [] };
  const api: Partial<ApiClient> = {
    workspaces: () => {
      calls.lists += 1;
      return list();
    },
    actors: () => Promise.resolve(ok([])),
    addWorkspace: (request) => {
      calls.adds.push(request);
      return add();
    },
    // The slug and the name only: the client builds the PATCH body `{name}` from them (api-workspace-admin.spec.ts).
    renameWorkspace: (ws, name) => {
      calls.renames.push([ws, name]);
      return rename();
    },
    rescanWorkspace: (ws) => {
      calls.writes.push(`rescan ${ws}`);
      return Promise.resolve(failed);
    },
    removeWorkspace: (ws) => {
      calls.writes.push(`remove ${ws}`);
      return Promise.resolve(failed);
    },
    uploadWorkspaceImage: (ws) => {
      calls.writes.push(`upload ${ws}`);
      return Promise.resolve(failed);
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
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
  return calls;
}

async function render() {
  const fixture = TestBed.createComponent(SettingsWorkspacesPage);
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the element type it queries
function one<T extends Element>(root: Element, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}

function type(root: HTMLElement, selector: string, value: string): void {
  const input = one<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('SettingsWorkspacesPage (spec 016, T14, ISC-312)', () => {
  it('renders the rows from the API stub, no [data-demo], no DemoData', async () => {
    setUp();
    const demo = TestBed.inject(DemoData);
    const read = vi.spyOn(demo, 'workspaces');
    const { root } = await render();

    const rows = [...root.querySelectorAll<HTMLElement>('[data-ws-row]')];
    expect(rows.map((row) => row.dataset['wsRow'])).toEqual(['harbor', 'quay']);
    expect(rows[0]?.textContent).toContain('Harbor');
    expect(rows[1]?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('missing');
    expect(root.matches('[data-demo]') || root.querySelector('[data-demo]') !== null).toBe(false);
    expect(root.querySelector('[data-demo-chip]')).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(root.querySelector('[data-ws-toolbar]')?.textContent).toContain('2');
    for (const gone of ['.path-pop', '.upload-off', '.grip', '.reveal', '[data-ws-fab]', 'ui-kbd']) expect(root.querySelector(gone)).toBeNull();
  });

  it('refuses an empty path inline without a request', async () => {
    const calls = setUp();
    const { fixture, root } = await render();
    one<HTMLFormElement>(root, 'form[data-ws-add-row]').dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(calls.adds).toEqual([]);
    const path = one<HTMLInputElement>(root, '[data-ws-add-path]');
    expect(path.getAttribute('aria-invalid')).toBe('true');
    const error = root.querySelector(`#${path.getAttribute('aria-describedby') ?? 'none'}`);
    expect(error?.textContent).toContain('Enter the path');
  });

  it('shows not-a-directory and duplicate-path inline from the contract codes', async () => {
    let answer: WorkspaceAdminResult<'add'> = { kind: 'refused', status: 422, body: { error: 'not-a-directory' } };
    const calls = setUp(undefined, () => Promise.resolve(answer));
    const { fixture, root } = await render();
    const form = one<HTMLFormElement>(root, 'form[data-ws-add-row]');

    type(root, '[data-ws-add-path]', '/nope');
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    expect(calls.adds).toEqual([{ path: '/nope' }]);
    expect(root.querySelector('[data-ws-add-error]')?.textContent).toContain('No folder');

    answer = { kind: 'refused', status: 422, body: { error: 'duplicate-path', slug: 'harbor' } };
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await fixture.whenStable();
    expect(root.querySelector('[data-ws-add-error]')?.textContent).toContain('Harbor');
    expect(root.querySelector('[data-ws-add-path]')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the form and reloads the list after an accepted add', async () => {
    const summary: WorkspaceAdminSummary = {
      slug: 'pier',
      name: 'Pier',
      pathTail: 'pier',
      readable: true,
      counts: null,
      status: 'empty',
      images: { logo: null, screenshot: null },
    };
    const calls = setUp(undefined, () => Promise.resolve({ kind: 'ok', body: summary }));
    const { fixture, root } = await render();
    const before = calls.lists;

    type(root, '[data-ws-add-path]', '/x/pier');
    type(root, '[data-ws-add-name]', 'Pier');
    // The fields render what was typed before the submit, as they would between a keystroke and a click.
    await fixture.whenStable();
    one<HTMLFormElement>(root, 'form[data-ws-add-row]').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(calls.adds).toEqual([{ path: '/x/pier', name: 'Pier' }]);
    expect(calls.lists).toBe(before + 1);
    expect(one<HTMLInputElement>(root, '[data-ws-add-path]').value).toBe('');
    expect(root.querySelector('[data-ws-add-path]')?.hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows the empty state with the CLI command when the registry is empty', async () => {
    setUp(() => Promise.resolve(ok([])));
    const { root } = await render();
    expect(root.querySelector('[data-ws-row]')).toBeNull();
    expect(root.querySelector('ui-empty-state ui-command-chip')?.textContent).toContain('spectant add <path>');
  });

  it('shows an error notice with Retry when the list fails, and Retry reads again', async () => {
    const calls = setUp(() => Promise.resolve({ kind: 'error', status: 500 }));
    const { fixture, root } = await render();
    const notice = root.querySelector('ui-notice[data-ws-load-error]');
    expect(notice).not.toBeNull();
    const before = calls.lists;
    one<HTMLButtonElement>(one(root, 'ui-notice[data-ws-load-error]'), 'button[data-ws-retry]').click();
    await fixture.whenStable();
    expect(calls.lists).toBe(before + 1);
    expect(root.querySelector('form[data-ws-add-row]')).not.toBeNull();
  });

  it('shows three skeleton rows only once loading takes longer than 150 ms', () => {
    vi.useFakeTimers();
    try {
      setUp(() => new Promise(() => undefined));
      const fixture = TestBed.createComponent(SettingsWorkspacesPage);
      fixture.detectChanges();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelectorAll('[data-ws-skeleton]')).toHaveLength(0);
      vi.advanceTimersByTime(160);
      fixture.detectChanges();
      expect(root.querySelectorAll('[data-ws-skeleton]')).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** Three entries in the registry's order of adding, each key sorting them differently. */
const THREE: readonly WorkspaceListEntry[] = [
  ...TWO,
  { slug: 'pier', name: 'pier', pathTail: 'pier', readable: true, counts: { specs: 0, building: 0 }, status: 'empty' },
];

function slugs(root: HTMLElement): Array<string | undefined> {
  return [...root.querySelectorAll<HTMLElement>('[data-ws-row]')].map((row) => row.dataset['wsRow']);
}

describe('SettingsWorkspacesPage sort (spec 016, T20, ISC-313)', () => {
  for (const [query, order] of [
    ['', ['harbor', 'quay', 'pier']],
    ['?sort=added', ['harbor', 'quay', 'pier']],
    ['?sort=bogus', ['harbor', 'quay', 'pier']],
    ['?sort=name', ['harbor', 'pier', 'quay']],
    ['?sort=status', ['quay', 'pier', 'harbor']],
  ] as const) {
    it(`sort: orders the rows for "${query || 'no query'}" and the menu names that key`, async () => {
      setUp(() => Promise.resolve(ok(THREE)));
      await TestBed.inject(Router).navigateByUrl(`/${query}`);
      const { fixture, root } = await render();
      expect(slugs(root)).toEqual(order);
      const menu = fixture.debugElement.query(By.directive(UiSortMenu)).componentInstance as UiSortMenu;
      expect(menu.value()).toBe(query === '' || query === '?sort=bogus' ? 'added' : query.slice('?sort='.length));
      expect(menu.options().map((option) => option.key)).toEqual(['name', 'status', 'added']);
    });
  }

  it('sort: a pick writes only ?sort= with replaceUrl, keeps it in the URL and sends no request', async () => {
    const calls = setUp(() => Promise.resolve(ok(THREE)));
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const navigate = vi.spyOn(router, 'navigate');
    const http = TestBed.inject(HttpTestingController);
    const { fixture, root } = await render();
    const lists = calls.lists;
    const menu = (): UiSortMenu => fixture.debugElement.query(By.directive(UiSortMenu)).componentInstance as UiSortMenu;

    menu().choose.emit('status');
    await settle(fixture);
    expect(router.url).toBe('/?sort=status');
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'merge' }));
    expect(slugs(root)).toEqual(['quay', 'pier', 'harbor']);

    menu().choose.emit('name');
    await settle(fixture);
    expect(router.url).toBe('/?sort=name');
    expect(slugs(root)).toEqual(['harbor', 'pier', 'quay']);

    expect(calls.lists).toBe(lists);
    expect(calls.adds).toEqual([]);
    expect(calls.renames).toEqual([]);
    expect(calls.writes).toEqual([]);
    expect(http.match((request) => request.method !== 'GET')).toEqual([]);
  });

  it('sort: hidden in the empty state', async () => {
    setUp(() => Promise.resolve(ok([])));
    const { root } = await render();
    expect(root.querySelector('ui-sort-menu')).toBeNull();
  });
});

/** jsdom has no `showModal()` / `close()`: stubbed on the prototype the way a browser behaves (as dialog.spec.ts). */
function stubDialogApi(): () => void {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const before = { showModal: proto['showModal'], close: proto['close'] };
  proto['showModal'] = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto['close'] = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  return () => Object.assign(proto, before);
}

async function settle(fixture: ComponentFixture<SettingsWorkspacesPage>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
}

function renameFrom(fixture: ComponentFixture<SettingsWorkspacesPage>, slug: string): void {
  const row = fixture.debugElement.queryAll(By.directive(WorkspaceRow)).find((found) => (found.nativeElement as HTMLElement).dataset['wsRow'] === slug);
  if (row === undefined) throw new Error(`no row ${slug}`);
  const instance = row.componentInstance as WorkspaceRow;
  instance.rename.emit(instance.entry());
}

describe('SettingsWorkspacesPage rename (spec 016, T16, ISC-305)', () => {
  let restore: () => void;
  beforeEach(() => (restore = stubDialogApi()));
  afterEach(() => {
    restore();
  });

  it('rename: opens the dialog from the row, prefilled, the slug an immutable line; Save sends the name only', async () => {
    const summary: WorkspaceAdminSummary = {
      slug: 'harbor',
      name: 'Harbor Two',
      pathTail: 'harbor',
      readable: true,
      counts: null,
      status: 'ok',
      images: { logo: null, screenshot: null },
    };
    const calls = setUp(undefined, undefined, () => Promise.resolve({ kind: 'ok', body: summary }));
    const { fixture, root } = await render();
    const before = calls.lists;
    renameFrom(fixture, 'harbor');
    await settle(fixture);

    const dialog = one<HTMLDialogElement>(one(root, '[data-ws-rename-dialog]'), 'dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    const field = one<HTMLInputElement>(dialog, 'input[data-ws-rename-name]');
    expect(field.value).toBe('Harbor');
    const slug = one(dialog, '[data-ws-rename-slug]');
    expect(slug.textContent).toContain('/w/harbor');
    expect(dialog.querySelectorAll('input')).toHaveLength(1);

    type(dialog, 'input[data-ws-rename-name]', '  Harbor Two ');
    await fixture.whenStable();
    one<HTMLFormElement>(dialog, 'form[data-ws-rename-form]').dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(calls.renames).toEqual([['harbor', 'Harbor Two']]);
    expect(calls.writes).toEqual([]);
    expect(calls.adds).toEqual([]);
    expect(calls.lists).toBe(before + 1);
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('rename: shows invalid-name inline in the dialog and keeps it open', async () => {
    const calls = setUp(undefined, undefined, () => Promise.resolve({ kind: 'refused', status: 400, body: { error: 'invalid-name' } }));
    const { fixture, root } = await render();
    renameFrom(fixture, 'harbor');
    await settle(fixture);
    const dialog = one<HTMLDialogElement>(one(root, '[data-ws-rename-dialog]'), 'dialog');

    type(dialog, 'input[data-ws-rename-name]', 'x');
    await fixture.whenStable();
    one<HTMLFormElement>(dialog, 'form[data-ws-rename-form]').dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(calls.renames).toEqual([['harbor', 'x']]);
    const field = one<HTMLInputElement>(dialog, 'input[data-ws-rename-name]');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector(`#${field.getAttribute('aria-describedby') ?? 'none'}`)?.textContent).toContain('Enter a name');
    expect(dialog.hasAttribute('open')).toBe(true);

    // A blank name is refused the same way, without a request.
    type(dialog, 'input[data-ws-rename-name]', '   ');
    await fixture.whenStable();
    one<HTMLFormElement>(dialog, 'form[data-ws-rename-form]').dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(calls.renames).toHaveLength(1);
    expect(one(dialog, '[data-ws-rename-error]').textContent).toContain('Enter a name');
  });

  it('rename: Esc and Cancel close the dialog and send nothing', async () => {
    const calls = setUp();
    const { fixture, root } = await render();
    const dialog = (): HTMLDialogElement => one<HTMLDialogElement>(one(root, '[data-ws-rename-dialog]'), 'dialog');

    renameFrom(fixture, 'harbor');
    await settle(fixture);
    type(dialog(), 'input[data-ws-rename-name]', 'Changed');
    one(dialog(), 'input[data-ws-rename-name]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(dialog().hasAttribute('open')).toBe(false);

    renameFrom(fixture, 'quay');
    await settle(fixture);
    expect(one<HTMLInputElement>(dialog(), 'input[data-ws-rename-name]').value).toBe('Quay');
    one<HTMLButtonElement>(dialog(), 'button[data-ws-rename-cancel]').click();
    await settle(fixture);
    expect(dialog().hasAttribute('open')).toBe(false);

    expect(calls.renames).toEqual([]);
    expect(calls.writes).toEqual([]);
  });

  it('rename: e on a focused row opens the same dialog, unless single-key shortcuts are off', async () => {
    setUp();
    const { fixture, root } = await render();
    const press = (target: Element): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    const dialog = (): HTMLDialogElement => one<HTMLDialogElement>(one(root, '[data-ws-rename-dialog]'), 'dialog');

    const settings = TestBed.inject(SettingsService);
    void settings.update({ singleKeyShortcuts: false });
    expect(press(one(root, '[data-ws-row="quay"] [data-ws-name]')).defaultPrevented).toBe(false);
    await settle(fixture);
    expect(dialog().hasAttribute('open')).toBe(false);

    void settings.update({ singleKeyShortcuts: true });
    expect(press(one(root, '[data-ws-row="quay"] [data-row-menu]')).defaultPrevented).toBe(true);
    await settle(fixture);
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(one<HTMLInputElement>(dialog(), 'input[data-ws-rename-name]').value).toBe('Quay');
  });
});
