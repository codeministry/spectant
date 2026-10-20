import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkspaceAdminSummary } from '../../../../../server/src/workspace-admin.contract';
import { ApiClient, type ApiResult, type WorkspaceAdminResult, type WorkspaceListEntry } from '../../core/api.service';
import { DemoData } from '../../shared/demo/demo-data';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { SettingsWorkspacesPage } from './settings-workspaces-page';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

/** The Api stub's registry: two workspaces, one readable with specs, one whose folder is gone. */
const TWO: readonly WorkspaceListEntry[] = [
  { slug: 'harbor', name: 'Harbor', pathTail: 'harbor', readable: true, counts: { specs: 4, building: 2 }, status: 'ok' },
  { slug: 'quay', name: 'Quay', pathTail: 'quay', readable: false, error: 'missing', counts: null, status: 'missing' },
];

interface Calls {
  lists: number;
  adds: unknown[];
}

function setUp(
  list: () => Promise<ApiResult<readonly WorkspaceListEntry[]>> = () => Promise.resolve(ok(TWO)),
  add: () => Promise<WorkspaceAdminResult<'add'>> = () => Promise.resolve({ kind: 'error', status: 500 }),
): Calls {
  const calls: Calls = { lists: 0, adds: [] };
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
