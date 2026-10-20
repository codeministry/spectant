import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkspaceListEntry } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
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

async function render(tier: 'compact' | 'medium' | 'wide' = 'wide') {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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

  it('emits one output per menu entry with the row entry, and Open is a link to the dashboard', async () => {
    const { fixture, host, root } = await render();
    const harbor = row(root, 'harbor');
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
