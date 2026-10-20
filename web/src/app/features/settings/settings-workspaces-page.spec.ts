import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkspaceAdminSummary } from '../../../../../server/src/workspace-admin.contract';
import { ApiClient, type ApiResult, type WorkspaceAdminResult, type WorkspaceListEntry } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
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
  remove: () => Promise<WorkspaceAdminResult<'remove'>> = () => Promise.resolve(failed),
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
      return remove();
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
    // '**' lets a probe navigate away from the page's URL and back (ISC-313); the page itself is not routed here.
    providers: [provideRouter([{ path: '**', children: [] }]), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
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

/**
 * Resolutions of `DemoData` while the page renders: the stand-in counts every resolution and throws on any read, so
 * the page neither injects the demo service nor reads from it (ISC-312).
 */
function guardDemoData(): { resolved: number } {
  const seen = { resolved: 0 };
  TestBed.overrideProvider(DemoData, {
    useFactory: () => {
      seen.resolved += 1;
      return new Proxy(
        {},
        {
          // Only the demo service's own members throw: Angular's injector reads `constructor` and `ngOnDestroy`.
          get: (_target, key) => {
            if (key === 'constructor' || !(key in DemoData.prototype)) return undefined;
            throw new Error(`DemoData.${String(key)} read by the workspaces page`);
          },
        },
      );
    },
  });
  return seen;
}

describe('SettingsWorkspacesPage (spec 016, T14, T22, ISC-312)', () => {
  it('ISC-312: renders exactly the stub\'s two rows, no [data-demo] and never resolves DemoData', async () => {
    const calls = setUp();
    const demo = guardDemoData();
    const { root } = await render();

    expect(calls.lists).toBeGreaterThanOrEqual(1);
    const rows = [...root.querySelectorAll<HTMLElement>('[data-ws-row]')];
    expect(rows.map((row) => row.dataset['wsRow'])).toEqual(['harbor', 'quay']);
    expect(rows.map((row) => row.querySelector('[data-ws-name] .ws-label')?.textContent.trim())).toEqual(['Harbor', 'Quay']);
    expect(rows[1]?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('missing');
    expect(root.matches('[data-demo]') || root.querySelector('[data-demo]') !== null).toBe(false);
    expect(root.querySelector('[data-demo-chip]')).toBeNull();
    expect(demo.resolved).toBe(0);
    expect(root.querySelector('[data-ws-toolbar]')?.textContent).toContain('2');
    for (const gone of ['.path-pop', '.upload-off', '.grip', '.reveal', '[data-ws-fab]', 'ui-kbd']) expect(root.querySelector(gone)).toBeNull();
  });

  it('ISC-312: add, row menu, upload entries and the remove dialog\'s Confirm are active and reach the API', async () => {
    const restore = stubDialogApi();
    try {
      const calls = setUp();
      const demo = guardDemoData();
      const { fixture, root } = await render();
      const enabled = (element: Element | null): boolean =>
        element !== null && !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';

      // Add: the submit button is enabled and a submit with a path reaches `addWorkspace`.
      expect(enabled(root.querySelector('form[data-ws-add-row] button[type="submit"][data-ws-add]'))).toBe(true);
      type(root, '[data-ws-add-path]', '/x/pier');
      await fixture.whenStable();
      one<HTMLFormElement>(root, 'form[data-ws-add-row]').dispatchEvent(new Event('submit'));
      await settle(fixture);
      expect(calls.adds).toEqual([{ path: '/x/pier' }]);

      for (const slug of ['harbor', 'quay']) {
        const row = one<HTMLElement>(root, `[data-ws-row="${slug}"]`);
        // The row menu's trigger and both upload entries are enabled, each with its file input.
        expect(enabled(row.querySelector('[data-row-menu]'))).toBe(true);
        for (const act of ['uploadLogo', 'uploadScreenshot']) expect(enabled(row.querySelector(`[data-row-act="${act}"]`))).toBe(true);
        for (const kind of ['logo', 'screenshot']) expect(enabled(row.querySelector(`input[type="file"][data-row-upload="${kind}"]`))).toBe(true);
      }

      // An upload entry opens the file chooser of its kind.
      const harbor = one<HTMLElement>(root, '[data-ws-row="harbor"]');
      const chooser = vi.spyOn(one<HTMLInputElement>(harbor, 'input[data-row-upload="logo"]'), 'click').mockImplementation(() => undefined);
      one<HTMLButtonElement>(harbor, '[data-row-act="uploadLogo"]').click();
      expect(chooser).toHaveBeenCalledTimes(1);

      // Remove from the row menu opens the dialog; its Confirm is enabled and sends the remove.
      one<HTMLButtonElement>(harbor, '[data-row-act="remove"]').click();
      await settle(fixture);
      const dialog = one<HTMLDialogElement>(one(root, '[data-ws-remove-dialog]'), 'dialog');
      expect(dialog.hasAttribute('open')).toBe(true);
      const confirm = one<HTMLButtonElement>(dialog, 'button[data-ws-remove-confirm]');
      expect(enabled(confirm)).toBe(true);
      confirm.click();
      await settle(fixture);
      expect(calls.writes).toEqual(['remove harbor']);

      expect(root.querySelector('[data-demo], [data-demo-chip]')).toBeNull();
      expect(demo.resolved).toBe(0);
    } finally {
      restore();
    }
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

/** The admin methods on `ShellData`, spied so a probe can show sorting calls none of them (ISC-313). */
const ADMIN = ['addWorkspace', 'renameWorkspace', 'rescanWorkspace', 'removeWorkspace', 'uploadWorkspaceImage'] as const;

function spyAdmin(): () => string[] {
  const data = TestBed.inject(ShellData);
  const spies = ADMIN.map((method) => [method, vi.spyOn(data, method)] as const);
  return () => spies.filter(([, spy]) => spy.mock.calls.length > 0).map(([method]) => method);
}

/** Every writing request the HTTP backend saw; the API stub sends none, so any here came from around it. */
function writesSent(http: HttpTestingController): string[] {
  return http.match((request) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)).map(({ request }) => `${request.method} ${request.url}`);
}

function menuOf(fixture: ComponentFixture<SettingsWorkspacesPage>): UiSortMenu {
  return fixture.debugElement.query(By.directive(UiSortMenu)).componentInstance as UiSortMenu;
}

const ORDER = {
  added: ['harbor', 'quay', 'pier'],
  name: ['harbor', 'pier', 'quay'],
  status: ['quay', 'pier', 'harbor'],
} as const;

describe('SettingsWorkspacesPage sort (spec 016, T20, T23, ISC-313)', () => {
  for (const [query, key] of [
    ['', 'added'],
    ['?sort=added', 'added'],
    ['?sort=bogus', 'added'],
    ['?sort=name', 'name'],
    ['?sort=status', 'status'],
  ] as const) {
    it(`ISC-313: orders the rows for "${query || 'no query'}" by ${key}, the menu names that key, and nothing is written`, async () => {
      const calls = setUp(() => Promise.resolve(ok(THREE)));
      const admin = spyAdmin();
      const http = TestBed.inject(HttpTestingController);
      await TestBed.inject(Router).navigateByUrl(`/${query}`);
      const { fixture, root } = await render();
      expect(slugs(root)).toEqual(ORDER[key]);
      const menu = menuOf(fixture);
      expect(menu.value()).toBe(key);
      expect(menu.options().map((option) => option.key)).toEqual(['name', 'status', 'added']);
      expect([calls.adds, calls.renames, calls.writes, admin(), writesSent(http)]).toEqual([[], [], [], [], []]);
    });
  }

  it('ISC-313: a pick writes only ?sort= with replaceUrl, re-reads nothing and sends no POST, PUT, PATCH or DELETE', async () => {
    const calls = setUp(() => Promise.resolve(ok(THREE)));
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const navigate = vi.spyOn(router, 'navigate');
    const admin = spyAdmin();
    const http = TestBed.inject(HttpTestingController);
    const { fixture, root } = await render();
    const lists = calls.lists;

    menuOf(fixture).choose.emit('status');
    await settle(fixture);
    expect(router.url).toBe('/?sort=status');
    expect(navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ replaceUrl: true, queryParamsHandling: 'merge' }));
    expect(slugs(root)).toEqual(ORDER.status);

    menuOf(fixture).choose.emit('name');
    await settle(fixture);
    expect(router.url).toBe('/?sort=name');
    expect(slugs(root)).toEqual(ORDER.name);

    menuOf(fixture).choose.emit('added');
    await settle(fixture);
    expect(router.url).toBe('/');
    expect(slugs(root)).toEqual(ORDER.added);

    expect(calls.lists).toBe(lists);
    expect([calls.adds, calls.renames, calls.writes, admin(), writesSent(http)]).toEqual([[], [], [], [], []]);
  });

  it('ISC-313: the sort survives a reload and a navigation away and back to the same URL', async () => {
    const calls = setUp(() => Promise.resolve(ok(THREE)));
    const router = TestBed.inject(Router);
    const admin = spyAdmin();
    const http = TestBed.inject(HttpTestingController);
    await router.navigateByUrl('/?sort=status');
    const first = await render();
    expect(slugs(first.root)).toEqual(ORDER.status);

    // Reload: the page is created anew on the same URL.
    first.fixture.destroy();
    const { fixture, root } = await render();
    expect(slugs(root)).toEqual(ORDER.status);
    expect(menuOf(fixture).value()).toBe('status');

    // Away, then back: the order follows the URL, so the same URL brings the same order back.
    await router.navigateByUrl('/elsewhere');
    await settle(fixture);
    expect(slugs(root)).toEqual(ORDER.added);
    await router.navigateByUrl('/?sort=status');
    await settle(fixture);
    expect(router.url).toBe('/?sort=status');
    expect(slugs(root)).toEqual(ORDER.status);
    expect(menuOf(fixture).value()).toBe('status');

    expect([calls.adds, calls.renames, calls.writes, admin(), writesSent(http)]).toEqual([[], [], [], [], []]);
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

function removeFrom(fixture: ComponentFixture<SettingsWorkspacesPage>, slug: string): void {
  const row = fixture.debugElement.queryAll(By.directive(WorkspaceRow)).find((found) => (found.nativeElement as HTMLElement).dataset['wsRow'] === slug);
  if (row === undefined) throw new Error(`no row ${slug}`);
  const instance = row.componentInstance as WorkspaceRow;
  instance.remove.emit(instance.entry());
}

describe('SettingsWorkspacesPage remove (spec 016, T21, ISC-314)', () => {
  let restore: () => void;
  beforeEach(() => (restore = stubDialogApi()));
  afterEach(() => {
    restore();
  });

  const dialogOf = (root: HTMLElement): HTMLDialogElement => one<HTMLDialogElement>(one(root, '[data-ws-remove-dialog]'), 'dialog');

  it('remove: opens with the focus on Cancel and a text that names the deleted images and the kept folder', async () => {
    setUp();
    const { fixture, root } = await render();
    removeFrom(fixture, 'harbor');
    await settle(fixture);

    const dialog = dialogOf(root);
    expect(dialog.hasAttribute('open')).toBe(true);
    const cancel = one<HTMLButtonElement>(dialog, 'button[data-ws-remove-cancel]');
    expect(cancel.hasAttribute('data-autofocus')).toBe(true);
    expect(document.activeElement).toBe(cancel);
    const body = one(dialog, '[data-ws-remove-body]').textContent;
    expect(body).toContain('logo and screenshot');
    expect(body).toContain('folder stays');
  });

  it('remove: Cancel and Esc close the dialog, send no DELETE and keep the row', async () => {
    const calls = setUp();
    const { fixture, root } = await render();

    removeFrom(fixture, 'harbor');
    await settle(fixture);
    one<HTMLButtonElement>(dialogOf(root), 'button[data-ws-remove-cancel]').click();
    await settle(fixture);
    expect(dialogOf(root).hasAttribute('open')).toBe(false);

    removeFrom(fixture, 'quay');
    await settle(fixture);
    one(dialogOf(root), 'button[data-ws-remove-cancel]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle(fixture);
    expect(dialogOf(root).hasAttribute('open')).toBe(false);

    expect(calls.writes).toEqual([]);
    expect(slugs(root)).toEqual(['harbor', 'quay']);
  });

  it('remove: Confirm sends exactly one remove of the slug, closes, reloads and focuses the next row', async () => {
    let list: readonly WorkspaceListEntry[] = TWO;
    const calls = setUp(
      () => Promise.resolve(ok(list)),
      undefined,
      undefined,
      () => {
        list = TWO.filter((entry) => entry.slug !== 'harbor');
        return Promise.resolve({ kind: 'ok', body: null });
      },
    );
    const { fixture, root } = await render();
    const before = calls.lists;
    removeFrom(fixture, 'harbor');
    await settle(fixture);
    one<HTMLButtonElement>(dialogOf(root), 'button[data-ws-remove-confirm]').click();
    await settle(fixture);
    await settle(fixture);

    expect(calls.writes).toEqual(['remove harbor']);
    expect(calls.lists).toBe(before + 1);
    expect(dialogOf(root).hasAttribute('open')).toBe(false);
    expect(slugs(root)).toEqual(['quay']);
    expect(document.activeElement).toBe(one(root, '[data-ws-row="quay"] [data-row-menu]'));
  });

  it('remove: a refused remove shows the refusal notice in the dialog and keeps it open', async () => {
    const calls = setUp(undefined, undefined, undefined, () => Promise.resolve({ kind: 'refused', status: 404, body: { error: 'not-found' } }));
    const { fixture, root } = await render();
    removeFrom(fixture, 'quay');
    await settle(fixture);
    one<HTMLButtonElement>(dialogOf(root), 'button[data-ws-remove-confirm]').click();
    await settle(fixture);

    expect(calls.writes).toEqual(['remove quay']);
    const dialog = dialogOf(root);
    expect(dialog.hasAttribute('open')).toBe(true);
    const notice = one(dialog, '[data-ws-remove-error]');
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain('Quay');
    expect(slugs(root)).toEqual(['harbor', 'quay']);
  });
});
