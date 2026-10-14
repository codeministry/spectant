import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { LibraryDoc } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient } from '../../core/api.service';
import { pageOrder, PrototypeCard, specRelative } from './prototype-card';

// T38 · ISC-159: the prototype card in the library's reader: one link per HTML page (`index.html` first) with
// `target="_blank"` and `rel="noopener"` on the server's prototype read route, `app-window` and `external-link` on each
// row; the preview from the spec's `.design/` only when core names one, through the library's file route, and gone
// without a placeholder when it is absent or does not load; the read-only footer. Layout (two columns from 1120 px,
// 44 px rows) is CSS the e2e and visual suites check in a real browser.

const proto = (extra: Partial<LibraryDoc> = {}): LibraryDoc => ({
  path: '004-retention-policies/.design/prototype/board',
  type: 'prototype',
  spec: '004-retention-policies',
  title: 'board',
  modified: '2026-10-12T14:02:00Z',
  state: 'ok',
  media: 'prototype',
  pages: ['detail.html', 'index.html', 'list.html'],
  preview: '004-retention-policies/.design/mobile-ist.png',
  ...extra,
});

@Component({
  imports: [PrototypeCard],
  template: `<app-prototype-card workspace="harbor" [doc]="doc()" />`,
})
class CardHost {
  readonly doc = signal<LibraryDoc>(proto());
}

describe('pageOrder / specRelative (T38, ISC-159)', () => {
  it('lists index.html first, then the pages in the order core gives (name order)', () => {
    expect(pageOrder(['about.html', 'index.html', 'list.html'])).toEqual(['index.html', 'about.html', 'list.html']);
    expect(pageOrder(['a.html', 'b.html'])).toEqual(['a.html', 'b.html']);
    expect(pageOrder([])).toEqual([]);
  });

  it('names a screenshot below its spec folder', () => {
    expect(specRelative('004-x/.design/tablet-prototype.png', '004-x')).toBe('.design/tablet-prototype.png');
    expect(specRelative('other/.design/a.png', '004-x')).toBe('other/.design/a.png');
  });
});

describe('PrototypeCard (T38, ISC-159)', () => {
  let fixture: ComponentFixture<CardHost>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function render(doc: LibraryDoc = proto()): Promise<HTMLElement> {
    fixture = TestBed.createComponent(CardHost);
    fixture.componentInstance.doc.set(doc);
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('app-prototype-card') as HTMLElement;
  }

  it('links every page in a new tab on the prototype read route, index.html first', async () => {
    const card = await render();
    expect(card.hasAttribute('data-library-prototype')).toBe(true);
    const links = [...card.querySelectorAll<HTMLAnchorElement>('a[data-library-prototype-page]')];
    expect(links.map((a) => a.dataset['libraryPrototypePage'])).toEqual(['index.html', 'detail.html', 'list.html']);
    for (const link of links) {
      const page = link.dataset['libraryPrototypePage'] ?? '';
      expect(link.getAttribute('href')).toBe(`/proto/harbor/004-retention-policies/prototype%2Fboard/${page}`);
      expect(link.getAttribute('href')).toBe(TestBed.inject(ApiClient).prototypeUrl('harbor', proto(), page));
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener');
      expect(link.getAttribute('aria-label')).toBe(`${page}, opens in a new tab`);
      expect(link.querySelector('.proto-file')?.textContent.trim()).toBe(page);
    }
    expect(card.querySelector('.proto-eyebrow')?.textContent.replace(/\s+/gu, ' ').trim()).toBe('Pages3');
    expect(card.querySelector('.proto-foot')?.textContent.trim()).toBe('Opens read-only in a new tab · local files only');
  });

  it('draws app-window and external-link on each row', async () => {
    const card = await render();
    const row = card.querySelector('a[data-library-prototype-page="index.html"]');
    const svgs = row?.querySelectorAll('ui-icon svg') ?? [];
    expect(svgs).toHaveLength(2);
    expect(row?.querySelector('ui-icon:first-child')?.innerHTML).toContain('<rect x="2" y="4" width="20" height="16" rx="2"');
    expect(row?.querySelector('ui-icon:last-child')?.innerHTML).toContain('M15 3h6v6');
  });

  it('builds the read route of a subfolder of the root prototype folder, and of the root itself', async () => {
    let card = await render(proto({ path: '004-retention-policies/.design/prototype', pages: ['index.html'] }));
    expect(card.querySelector('a[data-library-prototype-page]')?.getAttribute('href')).toBe('/proto/harbor/004-retention-policies/prototype/index.html');
    card = await render(proto({ path: '004-retention-policies/.design/prototype/a b/c', pages: ['ü.html'] }));
    expect(card.querySelector('a[data-library-prototype-page]')?.getAttribute('href')).toBe(
      '/proto/harbor/004-retention-policies/prototype%2Fa%20b%2Fc/%C3%BC.html',
    );
  });

  it('shows the preview from the spec’s .design/ through the file route, with alt and the path below the spec', async () => {
    const card = await render();
    const figure = card.querySelector('figure[data-library-prototype-preview]');
    const img = figure?.querySelector('img');
    expect(img?.getAttribute('src')).toBe(TestBed.inject(ApiClient).libraryAssetUrl('harbor', '004-retention-policies/.design/mobile-ist.png'));
    expect(img?.getAttribute('alt')).toBe('Screenshot of the prototype board');
    expect(figure?.querySelector('figcaption')?.textContent.trim()).toBe('Preview · .design/mobile-ist.png');
  });

  it('leaves the figure out without a screenshot, and when the screenshot does not load', async () => {
    let card = await render(proto({ preview: null }));
    expect(card.querySelector('[data-library-prototype-preview]')).toBeNull();
    expect(card.querySelectorAll('a[data-library-prototype-page]')).toHaveLength(3);

    card = await render(proto({ preview: undefined }));
    expect(card.querySelector('[data-library-prototype-preview]')).toBeNull();

    card = await render();
    card.querySelector('[data-library-prototype-preview] img')?.dispatchEvent(new Event('error'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(card.querySelector('[data-library-prototype-preview]')).toBeNull();

    // Another prototype brings its preview back.
    fixture.componentInstance.doc.set(proto({ preview: '004-retention-policies/.design/prototype-board.png' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(card.querySelector('[data-library-prototype-preview] img')).not.toBeNull();
  });

  it('lists no page for a document the contract names no prototype folder for', async () => {
    const card = await render(proto({ path: '004-retention-policies/.design/elsewhere', pages: ['index.html'] }));
    expect(card.querySelectorAll('a[data-library-prototype-page]')).toHaveLength(0);
  });

  it('speaks German', async () => {
    TestBed.inject(TranslocoService).setActiveLang('de');
    const card = await render();
    expect(card.querySelector('a[data-library-prototype-page="index.html"]')?.getAttribute('aria-label')).toBe('index.html, öffnet in neuem Tab');
    expect(card.querySelector('.proto-eyebrow span')?.textContent.trim()).toBe('Seiten');
    expect(card.querySelector('figcaption')?.textContent.trim()).toBe('Vorschau · .design/mobile-ist.png');
    expect(card.querySelector('.proto-foot')?.textContent.trim()).toBe('Öffnet schreibgeschützt in neuem Tab · nur lokale Dateien');
  });
});
