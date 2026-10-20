import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkspaceListEntry } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { ToastService } from '../../shared/ui/toast/toast';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { WorkspaceRow } from './workspace-row';

const NO_IMAGES = { logo: null, screenshot: null } as const;

/** One entry per status the server derives (ISC-309): specs, no `specs/`, a deleted folder. */
const ENTRIES: readonly WorkspaceListEntry[] = [
  { slug: 'harbor', name: 'Harbor', pathTail: 'harbor', readable: true, counts: { specs: 4, building: 2 }, status: 'ok', images: NO_IMAGES },
  { slug: 'lantern', name: 'Lantern', pathTail: 'lantern', readable: true, counts: { specs: 0, building: 0 }, status: 'empty', images: NO_IMAGES },
  { slug: 'quay', name: 'Quay', pathTail: 'quay', readable: false, error: 'missing', counts: null, status: 'missing', images: NO_IMAGES },
];

type Act = 'rename' | 'rescan' | 'uploadLogo' | 'uploadScreenshot' | 'remove';

@Component({
  imports: [WorkspaceRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul>
      @for (entry of entries(); track entry.slug) {
        <li
          app-workspace-row
          [entry]="entry"
          (rename)="acts.push(['rename', $event.slug])"
          (rescan)="acts.push(['rescan', $event.slug])"
          (uploadLogo)="acts.push(['uploadLogo', $event.slug])"
          (uploadScreenshot)="acts.push(['uploadScreenshot', $event.slug])"
          (remove)="acts.push(['remove', $event.slug])"
        ></li>
      }
    </ul>
  `,
})
class Host {
  readonly entries = signal<readonly WorkspaceListEntry[]>(ENTRIES);
  readonly acts: Array<[Act, string]> = [];
}

/** A promise the test settles by hand, so the busy state can be read while the write is pending. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** The two `ShellData` writes the row calls itself (T17, T18); each answers what the test hands it. */
const data = {
  rescanWorkspace: vi.fn<(ws: string) => Promise<unknown>>(),
  uploadWorkspaceImage: vi.fn<(ws: string, kind: string, file: Blob) => Promise<unknown>>(),
};
beforeEach(() => {
  data.rescanWorkspace.mockReset();
  data.uploadWorkspaceImage.mockReset();
});

async function render(tier: 'compact' | 'medium' | 'wide' = 'wide') {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ShellData, useValue: data }],
  });
  TestBed.inject(ShellState).tier.set(tier);
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  return { fixture, host: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

/** jsdom has no `showModal()` / `close()`; stubbed as in sheet.spec.ts, restored after each test. */
const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
const native = { showModal: proto['showModal'], close: proto['close'] };
beforeEach(() => {
  proto['showModal'] = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto['close'] = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  proto['showModal'] = native.showModal;
  proto['close'] = native.close;
});

const row = (root: HTMLElement, slug: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(`[data-ws-row="${slug}"]`);
  if (found === null) throw new Error(`no row ${slug}`);
  return found;
};

describe('WorkspaceRow (spec 016, T15, ISC-309)', () => {
  it('renders the status word per ok / empty / missing from the summary status', async () => {
    const { root } = await render();
    const status = (slug: string) => row(root, slug).querySelector('[data-status]');
    expect(status('harbor')?.getAttribute('data-status')).toBe('ok');
    expect(status('harbor')?.textContent.trim()).toBe('readable');
    expect(status('lantern')?.getAttribute('data-status')).toBe('empty');
    expect(status('lantern')?.textContent.trim()).toBe('no specs yet');
    expect(status('quay')?.getAttribute('data-status')).toBe('missing');
    expect(status('quay')?.textContent.trim()).toBe('folder not found');
    expect(row(root, 'harbor').querySelector('[data-ws-counts]')?.textContent).toContain('4 specs · 2 active');
    expect(row(root, 'quay').querySelector('[data-ws-counts]')?.textContent).toContain('no counts');
  });

  it('links the name to /w/<slug> and shows only the path tail', async () => {
    const { root } = await render();
    const link = row(root, 'harbor').querySelector<HTMLAnchorElement>('a[data-ws-name]');
    expect(link?.getAttribute('href')).toBe('/w/harbor');
    expect(link?.textContent).toContain('Harbor');
    expect(link?.getAttribute('title')).toBe('Harbor');
    expect(row(root, 'harbor').querySelector('[data-ws-path]')?.textContent.trim()).toBe('harbor');
    expect(row(root, 'harbor').querySelector('ui-ws-badge')?.textContent.trim()).toBe('HA');
    expect(row(root, 'harbor').querySelector('ui-ws-cover svg')).not.toBeNull();
  });

  it('keeps each accent stable across a reorder (name hash, never the index)', async () => {
    const { fixture, host, root } = await render();
    const accents = () =>
      Object.fromEntries(ENTRIES.map((entry) => [entry.slug, row(root, entry.slug).style.getPropertyValue('--ws')]));
    const before = accents();
    expect(new Set(Object.values(before)).size).toBeGreaterThan(0);
    host.entries.set([...ENTRIES].reverse());
    await fixture.whenStable();
    expect(accents()).toEqual(before);
    expect(row(root, 'quay').style.getPropertyValue('--ws')).not.toBe('');
  });

  it('opens the menu as a popover from medium and as a compact sheet below', async () => {
    const wide = await render('medium');
    expect(row(wide.root, 'harbor').querySelector('ui-popover')).not.toBeNull();
    expect(row(wide.root, 'harbor').querySelector('ui-sheet')).toBeNull();
    TestBed.resetTestingModule();

    const compact = await render('compact');
    const sheet = row(compact.root, 'harbor').querySelector('ui-sheet');
    expect(sheet?.getAttribute('data-tier')).toBe('compact');
    expect(row(compact.root, 'harbor').querySelector('ui-popover')).toBeNull();
    row(compact.root, 'harbor').querySelector<HTMLButtonElement>('[data-row-menu]')?.click();
    await compact.fixture.whenStable();
    expect(sheet?.querySelector('dialog')?.open).toBe(true);
  });

  it('re-scans in the row: aria-busy, "re-reading…" in the counts cell, the entry disabled, then the fresh counts and one announcement (T17, ISC-306)', async () => {
    const { fixture, host, root } = await render('wide');
    const toasts = TestBed.inject(ToastService);
    const pending = deferred<unknown>();
    data.rescanWorkspace.mockReturnValue(pending.promise);
    const harbor = row(root, 'harbor');
    harbor.querySelector<HTMLButtonElement>('[data-row-act="rescan"]')?.click();
    await fixture.whenStable();

    expect(data.rescanWorkspace).toHaveBeenCalledWith('harbor');
    expect(harbor.getAttribute('aria-busy')).toBe('true');
    expect(harbor.querySelector('[data-ws-counts] [data-row-busy]')?.textContent).toContain('re-reading…');
    expect(harbor.querySelector('[data-ws-counts] .loading-spinner')).not.toBeNull();
    expect(harbor.querySelector<HTMLButtonElement>('[data-row-act="rescan"]')?.disabled).toBe(true);
    expect(row(root, 'lantern').hasAttribute('aria-busy')).toBe(false);

    pending.resolve({ kind: 'ok', body: { slug: 'harbor', counts: { specs: 5, building: 2 } } });
    host.entries.set([{ ...ENTRIES[0], counts: { specs: 5, building: 2 } }, ...ENTRIES.slice(1)]);
    await fixture.whenStable();
    expect(harbor.hasAttribute('aria-busy')).toBe(false);
    expect(harbor.querySelector('[data-row-busy]')).toBeNull();
    expect(harbor.querySelector('[data-ws-counts]')?.textContent).toContain('5 specs · 2 active');
    expect(harbor.querySelector<HTMLButtonElement>('[data-row-act="rescan"]')?.disabled).toBe(false);
    expect(toasts.spoken()?.text).toBe('Harbor re-read: 5 specs · 2 active');
    expect(toasts.message()).toBeNull();
  });

  it('shows "Re-reading…" in the status slot on compact and announces a failed re-scan (T17, ISC-306)', async () => {
    const { fixture, root } = await render('compact');
    const toasts = TestBed.inject(ToastService);
    const pending = deferred<unknown>();
    data.rescanWorkspace.mockReturnValue(pending.promise);
    const harbor = row(root, 'harbor');
    harbor.querySelector<HTMLButtonElement>('[data-row-act="rescan"]')?.click();
    await fixture.whenStable();
    expect(harbor.getAttribute('aria-busy')).toBe('true');
    expect(harbor.querySelector('[data-status] [data-row-busy]')?.textContent.trim()).toBe('Re-reading…');

    pending.resolve({ kind: 'error', status: 500 });
    await pending.promise;
    await fixture.whenStable();
    expect(harbor.hasAttribute('aria-busy')).toBe(false);
    expect(toasts.spoken()?.text).toBe('Harbor could not be re-read.');
    expect(toasts.message()).toBeNull();
  });

  it('renders the entry\'s loopback images: the logo in the badge, the screenshot as the 16:10 thumb (T18, ISC-310)', async () => {
    const { fixture, host, root } = await render();
    const images = { logo: '/api/workspaces/harbor/images/logo?v=0123456789abcdef', screenshot: '/api/workspaces/harbor/images/screenshot?v=fedcba9876543210' };
    host.entries.set([{ ...ENTRIES[0], images }, ...ENTRIES.slice(1)]);
    await fixture.whenStable();
    const harbor = row(root, 'harbor');
    expect(harbor.querySelector('ui-ws-badge img')?.getAttribute('src')).toBe(images.logo);
    expect(harbor.querySelector('ui-ws-cover img')?.getAttribute('src')).toBe(images.screenshot);
    expect(harbor.querySelector('ui-ws-cover')?.getAttribute('data-shape')).toBe('thumb');
    expect(row(root, 'lantern').querySelector('ui-ws-badge img')).toBeNull();
    expect(row(root, 'lantern').querySelector('ui-ws-cover svg')).not.toBeNull();
  });

  it('opens one hidden file input per kind from the menu and the thumb, and uploads the chosen file (T18, ISC-310)', async () => {
    const { fixture, root } = await render();
    const toasts = TestBed.inject(ToastService);
    const harbor = row(root, 'harbor');
    const input = (kind: string) => {
      const found = harbor.querySelector<HTMLInputElement>(`input[type="file"][data-row-upload="${kind}"]`);
      if (found === null) throw new Error(`no ${kind} input`);
      return found;
    };
    for (const kind of ['logo', 'screenshot']) {
      expect(input(kind).getAttribute('accept')).toBe('image/png,image/jpeg,image/webp');
      expect(input(kind).hidden).toBe(true);
    }
    const logoClick = vi.spyOn(input('logo'), 'click').mockImplementation(() => undefined);
    const shotClick = vi.spyOn(input('screenshot'), 'click').mockImplementation(() => undefined);
    harbor.querySelector<HTMLButtonElement>('[data-row-act="uploadLogo"]')?.click();
    harbor.querySelector<HTMLButtonElement>('[data-row-act="uploadScreenshot"]')?.click();
    harbor.querySelector<HTMLButtonElement>('button[data-row-thumb]')?.click();
    expect(logoClick).toHaveBeenCalledTimes(1);
    expect(shotClick).toHaveBeenCalledTimes(2);
    expect(harbor.querySelector('button[data-row-thumb]')?.getAttribute('aria-label')).toBe('Upload screenshot for Harbor');

    const choose = async (kind: string, file: File, answer: unknown) => {
      data.uploadWorkspaceImage.mockResolvedValueOnce(answer);
      Object.defineProperty(input(kind), 'files', { configurable: true, value: [file] });
      input(kind).dispatchEvent(new Event('change'));
      await Promise.resolve();
      await Promise.resolve();
      await fixture.whenStable();
    };
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'logo.png', { type: 'image/png' });
    await choose('logo', png, { kind: 'ok', body: { kind: 'logo', url: '/api/workspaces/harbor/images/logo?v=0123456789abcdef' } });
    expect(data.uploadWorkspaceImage).toHaveBeenLastCalledWith('harbor', 'logo', png);
    expect(toasts.spoken()?.text).toBe('Logo of Harbor uploaded.');

    // Server refusals are spoken for now; the persistent ui-notice under the row is T19's.
    await choose('screenshot', png, { kind: 'refused', status: 413, body: { error: 'too-large', maxBytes: 2097152 } });
    expect(data.uploadWorkspaceImage).toHaveBeenLastCalledWith('harbor', 'screenshot', png);
    expect(toasts.spoken()?.text).toBe('Harbor: the image is larger than 2 MB; nothing was stored.');
    await choose('screenshot', png, { kind: 'refused', status: 415, body: { error: 'unsupported-type' } });
    expect(toasts.spoken()?.text).toBe('Harbor: only PNG, JPEG or WebP images; nothing was stored.');
    await choose('logo', png, { kind: 'error', status: 500 });
    expect(toasts.spoken()?.text).toBe('The image for Harbor could not be uploaded.');
    expect(toasts.message()).toBeNull();
  });

  it('emits one output per menu entry with the row entry, and Open is a link to the dashboard', async () => {
    const { fixture, host, root } = await render();
    const harbor = row(root, 'harbor');
    data.rescanWorkspace.mockResolvedValue({ kind: 'ok', body: { slug: 'harbor' } });
    for (const act of ['rename', 'rescan', 'uploadLogo', 'uploadScreenshot', 'remove'] as const) {
      harbor.querySelector<HTMLButtonElement>(`[data-row-act="${act}"]`)?.click();
      await fixture.whenStable();
    }
    expect(host.acts).toEqual([
      ['rename', 'harbor'],
      ['rescan', 'harbor'],
      ['uploadLogo', 'harbor'],
      ['uploadScreenshot', 'harbor'],
      ['remove', 'harbor'],
    ]);
    expect(harbor.querySelector('a[data-row-act="open"]')?.getAttribute('href')).toBe('/w/harbor');
    expect(harbor.querySelector('[data-row-act="uploadLogo"]')?.textContent).toContain('Upload logo…');
  });
});
