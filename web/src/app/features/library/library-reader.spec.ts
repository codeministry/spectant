import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import type { DocsPage, LibraryCatalog, LibraryDoc } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { MERMAID_LOADER, type MermaidApi } from '../../shared/ui/doc-prose/mermaid';
import { folderOf, LibraryReader, type ProseLinks, type ReaderContext, resolveRelative, rewriteProse, techReading } from './library-reader';

// T34 · ISC-156.3: the library's reader as its own component: Docs prose with its table of contents and mermaid as a
// figure (ISC-154, ISC-154.1) through ui-doc-prose, an image document as a preview, relative images through the file
// route, relative links to catalog documents as cross references that select in place, "Open in spec" only for a
// spec's document outside the spec context; below 1120 px the back button and Escape, and the page's way back that
// restores the list's scroll position and focuses the opened row (DS-APP-35).

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const doc = (path: string, type: LibraryDoc['type'], title: string, extra: Partial<LibraryDoc> = {}): LibraryDoc => ({
  path,
  type,
  spec: path.includes('/') && !path.startsWith('ideas/') ? (path.split('/')[0] ?? path) : 'workspace',
  title,
  modified: '2026-10-12T14:02:00Z',
  state: 'ok',
  media: 'markdown',
  ...extra,
});

const PLAN = doc('002-web-console/plan.md', 'plan', 'Approach');
const SPEC = doc('002-web-console/spec.md', 'spec', 'Web console');
const CONSTITUTION = doc('constitution.md', 'constitution', 'Constitution');
const SHOT = doc('002-web-console/artifacts/board.png', 'artifact', 'Board screenshot', { media: 'image' });
const PROTO = doc('002-web-console/.design/prototype/board', 'prototype', 'board', { media: 'prototype', pages: ['index.html'] });
const DOCS = [SPEC, PLAN, SHOT, PROTO, CONSTITUTION];

const SOURCE = 'flowchart LR\n  a --> b';
const SVG = '<svg data-icon-exempt viewBox="0 0 100 40" width="100%"></svg>';
const PLAN_PAGE: DocsPage = {
  html: [
    '<h2 id="approach">Approach</h2>',
    '<p>See <a href="spec.md#goal">the spec</a>, <a href="../constitution.md">the rules</a>, <a href="notes.txt">notes</a> and <a href="https://example.org/x">a site</a>.</p>',
    '<figure class="image-figure" data-figure="1"><img src="artifacts/board.png" alt="Board" loading="lazy"><figcaption>Board</figcaption></figure>',
    '<h2 id="flow">Flow</h2>',
    `<figure class="mermaid-figure" data-figure="2"><pre class="mermaid">${SOURCE}</pre><figcaption>Flow</figcaption></figure>`,
  ].join('\n'),
  toc: [
    { level: 2, text: 'Approach', anchor: 'approach' },
    { level: 2, text: 'Flow', anchor: 'flow' },
  ],
  frontmatter: null,
  figures: [
    { index: 1, kind: 'image', src: 'artifacts/board.png', alt: 'Board', caption: 'Board' },
    { index: 2, kind: 'mermaid', diagram: 'flowchart', source: SOURCE, caption: 'Flow' },
  ],
  sections: [],
  wordCount: 12,
};

const assetUrl = (ws: string, path: string): string => `/api/workspaces/${ws}/library/asset?path=${encodeURIComponent(path)}`;

describe('resolveRelative / rewriteProse (T34, ISC-156.3)', () => {
  it('resolves a relative reference against the document folder below specs/', () => {
    expect(folderOf('002-web-console/plan.md')).toBe('002-web-console');
    expect(folderOf('constitution.md')).toBe('');
    expect(resolveRelative('002-web-console', 'spec.md#goal')).toBe('002-web-console/spec.md');
    expect(resolveRelative('002-web-console', './.evidence/T1/run.png?x=1')).toBe('002-web-console/.evidence/T1/run.png');
    expect(resolveRelative('002-web-console', '../constitution.md')).toBe('constitution.md');
    expect(resolveRelative('', 'tech/overview%20map.png')).toBe('tech/overview map.png');
    expect(resolveRelative('002-web-console', '../../outside.md')).toBeNull();
    for (const ref of ['https://example.org/a.md', 'mailto:a@b.c', '/abs.md', '//host/a.md', '#goal', '', '%E0%A4%A.md']) {
      expect(resolveRelative('002-web-console', ref), ref).toBeNull();
    }
  });

  it('points relative images at the file route and catalog links at their reader anchor, nothing else', () => {
    const links: ProseLinks = {
      dir: '002-web-console',
      catalog: new Set(DOCS.map((entry) => entry.path)),
      asset: (path) => assetUrl('harbor', path),
      xref: (path) => `/w/harbor/library#${path}`,
    };
    const host = document.createElement('div');
    host.innerHTML = rewriteProse(PLAN_PAGE.html, links);
    expect(host.querySelector('img')?.getAttribute('src')).toBe(assetUrl('harbor', '002-web-console/artifacts/board.png'));
    const xrefs = [...host.querySelectorAll('a[data-library-xref]')].map((a) => [a.getAttribute('data-library-xref'), a.getAttribute('href')]);
    expect(xrefs).toEqual([
      ['002-web-console/spec.md', '/w/harbor/library#002-web-console/spec.md'],
      ['constitution.md', '/w/harbor/library#constitution.md'],
    ]);
    expect(host.querySelector('a[href="notes.txt"]')?.hasAttribute('data-library-xref')).toBe(false);
    expect(host.querySelector('a[href="https://example.org/x"]')).not.toBeNull();
    expect(host.querySelector('figure.mermaid-figure[data-figure="2"] pre.mermaid')?.textContent).toBe(SOURCE);
  });
});

@Component({
  selector: 'app-reader-host',
  imports: [LibraryReader],
  template: `<app-library-reader
    workspace="harbor"
    [doc]="doc()"
    [docs]="docs"
    [context]="context()"
    [wide]="wide()"
    (back)="backs = backs + 1"
    (pick)="selected.push($event)"
  />`,
})
class ReaderHost {
  readonly doc = signal<LibraryDoc | null>(PLAN);
  readonly context = signal<ReaderContext>('workspace');
  readonly wide = signal(false);
  readonly docs = DOCS;
  backs = 0;
  readonly selected: string[] = [];
}

// T36 · ISC-157: tech.md in the reader as its four sections, in contract order, each under its stable anchor.
describe('techReading (T36, ISC-157)', () => {
  const page = (html: string): DocsPage => ({ html, toc: [], frontmatter: null, figures: [], sections: [], wordCount: 1 });
  const keys = (html: string): string[] => {
    const template = document.createElement('template');
    template.innerHTML = html;
    return [...template.content.querySelectorAll('[data-library-tech-section]')].map((el) => `${el.getAttribute('data-library-tech-section') ?? ''}:${el.querySelector('h2')?.id ?? ''}`);
  };

  it('orders the named sections overview, stack, architecture, risks, drops the h1 and lists them as contents', () => {
    const reading = techReading(
      page(
        '<h1 id="harbor">Harbor</h1><p>Lead.</p><h2 id="risks">Risks</h2><ul><li>R</li></ul><h2 id="architektur">Architektur</h2><h3 id="flow">Flow</h3><p>A</p>' +
          '<h2 id="uberblick">Überblick</h2><p>O</p><h2 id="tech-stack">Tech stack</h2><table></table><h2 id="glossary">Glossary</h2><p>G</p>',
      ),
    );
    expect(keys(reading.page.html)).toEqual(['overview:overview', 'stack:stack', 'architecture:architecture', 'risks:risks']);
    expect(reading.page.html.startsWith('<p>Lead.</p>')).toBe(true);
    expect(reading.page.html).not.toContain('<h1');
    // An h2 that names no section stays in the section before it.
    expect(reading.page.html).toMatch(/data-library-tech-section="stack">.*Glossary.*<\/section>/u);
    expect(reading.page.toc).toEqual([
      { level: 2, text: 'Überblick', anchor: 'overview' },
      { level: 2, text: 'Tech stack', anchor: 'stack' },
      { level: 2, text: 'Architektur', anchor: 'architecture' },
      { level: 2, text: 'Risks', anchor: 'risks' },
    ]);
    expect(reading.missing).toEqual([]);
  });

  it('names the sections the file has none for, and takes the first four h2 in order when none is named', () => {
    const partial = techReading(page('<h2 id="overview">Overview</h2><p>O</p><h2 id="risks">Risks</h2><p>R</p>'));
    expect(partial.present).toEqual(['overview', 'risks']);
    expect(partial.missing).toEqual(['stack', 'architecture']);
    const unnamed = techReading(page('<h2 id="a">Was</h2><p>1</p><h2 id="b">Womit</h2><p>2</p><h2 id="c">Wie</h2><p>3</p><h2 id="d">Gefahren</h2><p>4</p>'));
    expect(keys(unnamed.page.html)).toEqual(['overview:overview', 'stack:stack', 'architecture:architecture', 'risks:risks']);
  });
});

describe('LibraryReader (T34, ISC-156.3)', () => {
  let fixture: ComponentFixture<ReaderHost>;
  let requested: string[];
  let rendered: string[];

  beforeEach(() => {
    requested = [];
    rendered = [];
    const api: Pick<ApiClient, 'libraryDoc' | 'libraryAssetUrl' | 'prototypeUrl'> = {
      libraryDoc: (_ws, path) => {
        requested.push(path);
        return Promise.resolve(ok(path === PLAN.path ? PLAN_PAGE : { ...PLAN_PAGE, html: '<p>Other</p>', toc: [], figures: [] }));
      },
      libraryAssetUrl: assetUrl,
      prototypeUrl: (ws, d, page) => ApiClient.prototype.prototypeUrl(ws, d, page),
    };
    const mermaid: MermaidApi = {
      initialize: () => undefined,
      render: (_id, source) => {
        rendered.push(source);
        return Promise.resolve({ svg: SVG });
      },
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiClient, useValue: api },
        { provide: ShellData, useValue: { workspaceName: (slug: string) => slug } },
        { provide: MERMAID_LOADER, useValue: () => Promise.resolve(mermaid) },
      ],
    });
  });

  async function render(change: (host: ReaderHost) => void = () => undefined): Promise<HTMLElement> {
    await TestBed.inject(Router).navigateByUrl('/w/harbor/library?type=plan#002-web-console/plan.md');
    fixture = TestBed.createComponent(ReaderHost);
    change(fixture.componentInstance);
    return settle();
  }

  async function settle(): Promise<HTMLElement> {
    for (let i = 0; i < 4; i += 1) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('app-library-reader') as HTMLElement;
  }

  it('shows a Markdown document as Docs prose with its table of contents and mermaid as a figure', async () => {
    const reader = await render();
    expect(reader.hasAttribute('data-library-reader')).toBe(true);
    expect(requested).toEqual([PLAN.path]);
    const prose = reader.querySelector('ui-doc-prose[data-library-prose]');
    expect(prose).not.toBeNull();
    // Below 1120 px the table of contents is the "On this page" disclosure above the prose (spec 024).
    expect([...(prose?.querySelectorAll('.docs-toc-fold .docs-toc-list a') ?? [])].map((a) => a.getAttribute('href'))).toEqual(['#approach', '#flow']);
    expect(rendered).toEqual([SOURCE]);
    const figure = prose?.querySelector('figure.mermaid-figure[data-figure="2"]');
    expect(figure?.querySelector('svg')).not.toBeNull();
    expect(figure?.querySelector('ui-diagram-toolbar')).not.toBeNull();
    expect(reader.querySelector('.lib-reader-title')?.textContent.trim()).toBe('Approach');
  });

  it('sets the table of contents beside the prose at wide', async () => {
    const reader = await render((host) => host.wide.set(true));
    expect(reader.querySelector('nav.docs-toc .docs-toc-list')).not.toBeNull();
    expect(reader.querySelector('[data-library-back]')).toBeNull();
  });

  it('loads a relatively linked image through the file route', async () => {
    const reader = await render();
    expect(reader.querySelector('[data-library-prose] figure[data-figure="1"] img')?.getAttribute('src')).toBe(
      assetUrl('harbor', '002-web-console/artifacts/board.png'),
    );
  });

  it('turns a relative link to a catalog document into a cross reference that selects it in place', async () => {
    const reader = await render();
    const xref = reader.querySelector<HTMLAnchorElement>('a[data-library-xref="002-web-console/spec.md"]');
    expect(xref).not.toBeNull();
    // The library address with the current filters and the target's path as the fragment.
    expect(xref?.getAttribute('href')).toBe('/w/harbor/library?type=plan#002-web-console/spec.md');
    expect(reader.querySelector('a[data-library-xref="constitution.md"]')).not.toBeNull();
    expect(reader.querySelector('a[href="notes.txt"]')?.hasAttribute('data-library-xref')).toBe(false);
    const url = TestBed.inject(Router).url;
    xref?.click();
    expect(fixture.componentInstance.selected).toEqual(['002-web-console/spec.md']);
    expect(TestBed.inject(Router).url).toBe(url);
  });

  it('keeps the address when the table of contents jumps to a heading', async () => {
    const reader = await render();
    const url = TestBed.inject(Router).url;
    Element.prototype.scrollIntoView = (): void => undefined;
    reader.querySelector<HTMLAnchorElement>('.docs-toc-list a[href="#flow"]')?.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe(url);
    expect(document.activeElement?.id).toBe('flow');
  });

  it('shows an image document as a preview at its natural size, alt its title, from the file route', async () => {
    const reader = await render((host) => host.doc.set(SHOT));
    const img = reader.querySelector<HTMLImageElement>('figure[data-library-preview] img');
    expect(img?.getAttribute('src')).toBe(assetUrl('harbor', SHOT.path));
    expect(img?.getAttribute('alt')).toBe('Board screenshot');
    expect(requested).toEqual([]);
    expect(reader.querySelector('[data-library-prose]')).toBeNull();
  });

  it('shows a prototype as its card with the page list (T38, ISC-159)', async () => {
    const reader = await render((host) => host.doc.set(PROTO));
    expect(reader.querySelector('app-prototype-card[data-library-prototype]')).not.toBeNull();
    expect(reader.querySelector('a[data-library-prototype-page="index.html"]')?.getAttribute('href')).toBe('/proto/harbor/002-web-console/prototype%2Fboard/index.html');
    expect(reader.querySelector('[data-library-image]')).toBeNull();
    expect(reader.querySelector('[data-library-preview]')).toBeNull();
    expect(requested).toEqual([]);
  });

  it('leads a spec document to its spec page, never a workspace-wide one, never in the spec context', async () => {
    let reader = await render();
    const open = reader.querySelector('a[data-library-open]');
    expect(open?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(open?.textContent.trim()).toBe('Open in spec 002');

    fixture.componentInstance.doc.set(CONSTITUTION);
    reader = await settle();
    expect(reader.querySelector('[data-library-open]')).toBeNull();
    expect(reader.querySelector('ui-chip')?.textContent.trim()).toBe('harbor');

    fixture.componentInstance.doc.set(PLAN);
    fixture.componentInstance.context.set('spec');
    reader = await settle();
    expect(reader.querySelector('.lib-reader-title')?.textContent.trim()).toBe('Approach');
    expect(reader.querySelector('[data-library-open]')).toBeNull();
  });

  it('returns to the list with the back button and with Escape below 1120 px', async () => {
    const reader = await render();
    reader.querySelector<HTMLButtonElement>('[data-library-back]')?.click();
    reader.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(fixture.componentInstance.backs).toBe(2);
  });
});

// The page's way back below 1120 px (DS-APP-35), through the real route.
describe('LibraryPage with the reader below 1120 px (T34)', () => {
  const CATALOG: LibraryCatalog = { docs: DOCS, groups: [], fog: [], missing: 0, stale: 0 };
  let harness: RouterTestingHarness;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function settle(): Promise<HTMLElement> {
    for (let i = 0; i < 3; i += 1) {
      await harness.fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    harness.fixture.detectChanges();
    return harness.fixture.nativeElement as HTMLElement;
  }

  it('opens the reader with the focus on it and comes back to the list at its scroll position, the row focused', async () => {
    const api: Partial<ApiClient> = {
      workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
      dashboard: () => Promise.resolve(ok(dashboard)),
      planning: () => Promise.resolve({ kind: 'not-found', served: false }),
      spec: () => Promise.resolve({ kind: 'not-found', served: false }),
      actors: () => Promise.resolve(ok([])),
      boardQuery: () => Promise.resolve(ok({ query: '' })),
      library: () => Promise.resolve(ok(CATALOG)),
      libraryDoc: () => Promise.resolve(ok({ ...PLAN_PAGE, toc: [], figures: [], html: '<p>See <a href="../constitution.md">the rules</a>.</p>' })),
      librarySearch: (_ws, q) => Promise.resolve(ok({ query: q, hits: [] })),
      libraryAssetUrl: assetUrl,
      prototypeUrl: (ws, d, page) => ApiClient.prototype.prototypeUrl(ws, d, page),
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
    });
    TestBed.inject(ShellState).tier.set('medium');
    const scrolled: number[] = [];
    vi.spyOn(window, 'scrollTo').mockImplementation(((options: ScrollToOptions) => {
      scrolled.push(options.top ?? 0);
    }) as typeof window.scrollTo);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(420);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/w/harbor/library');
    let root = await settle();

    root.querySelector<HTMLButtonElement>(`[data-library-entry="${PLAN.path}"]`)?.click();
    root = await settle();
    expect(root.querySelector('[data-library-list]')).toBeNull();
    const reader = root.querySelector<HTMLElement>('[data-library-reader]');
    expect(document.activeElement).toBe(reader);
    expect(scrolled).toEqual([0]);

    // A cross reference keeps the reader and selects its document; the way back still leads to the opened row's list.
    root.querySelector<HTMLAnchorElement>('a[data-library-xref="constitution.md"]')?.click();
    root = await settle();
    expect(root.querySelector('.lib-reader-title')?.textContent.trim()).toBe('Constitution');
    expect(new URL(TestBed.inject(Router).url, 'http://x').hash).toBe('#constitution.md');

    root.querySelector<HTMLButtonElement>('[data-library-back]')?.click();
    root = await settle();
    expect(root.querySelector('[data-library-list]')).not.toBeNull();
    expect(scrolled).toEqual([0, 0, 420]);
    expect(document.activeElement?.getAttribute('data-library-entry')).toBe('constitution.md');
  });
});

// T42 · ISC-157.1: the former tech tabs Overview and Architecture land on tech.md at their section (`?section=`), the
// reader scrolls there and focuses its heading; opening another document drops the section from the address.
describe('LibraryPage on a former tech address (T42, ISC-157.1)', () => {
  const TECH = doc('tech.md', 'tech', 'Tech');
  const CATALOG: LibraryCatalog = { docs: [TECH, ...DOCS], groups: [], fog: [], missing: 0, stale: 0 };
  const TECH_PAGE: DocsPage = {
    html: ['Overview', 'Stack', 'Architecture', 'Risks'].map((name) => `<h2 id="${name.toLowerCase()}">${name}</h2><p>${name} text</p>`).join('\n'),
    toc: [],
    frontmatter: null,
    figures: [],
    sections: [],
    wordCount: 8,
  };
  let harness: RouterTestingHarness;
  let jumped: string[];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function settle(): Promise<HTMLElement> {
    for (let i = 0; i < 4; i += 1) {
      await harness.fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    harness.fixture.detectChanges();
    return harness.fixture.nativeElement as HTMLElement;
  }

  async function land(url: string, tier: 'medium' | 'wide'): Promise<HTMLElement> {
    const api: Partial<ApiClient> = {
      workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
      dashboard: () => Promise.resolve(ok(dashboard)),
      planning: () => Promise.resolve({ kind: 'not-found', served: false }),
      spec: () => Promise.resolve({ kind: 'not-found', served: false }),
      actors: () => Promise.resolve(ok([])),
      boardQuery: () => Promise.resolve(ok({ query: '' })),
      library: () => Promise.resolve(ok(CATALOG)),
      libraryDoc: (_ws, path) => Promise.resolve(ok(path === TECH.path ? TECH_PAGE : { ...PLAN_PAGE, toc: [], figures: [], html: '<p>Other</p>' })),
      librarySearch: (_ws, q) => Promise.resolve(ok({ query: q, hits: [] })),
      libraryAssetUrl: assetUrl,
      prototypeUrl: (ws, d, page) => ApiClient.prototype.prototypeUrl(ws, d, page),
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
    });
    TestBed.inject(ShellState).tier.set(tier);
    jumped = [];
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    Element.prototype.scrollIntoView = function (this: Element): void {
      jumped.push(this.id);
    };
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return settle();
  }

  for (const tier of ['medium', 'wide'] as const) {
    it(`opens tech.md at the Architecture section from /tech/architecture, the heading focused (${tier})`, async () => {
      const root = await land('/w/harbor/tech/architecture', tier);
      expect(TestBed.inject(Router).url).toBe('/w/harbor/library?section=architecture#tech.md');
      // Below 1120 px the address lands in the reader directly, no list beside it.
      if (tier === 'medium') expect(root.querySelector('[data-library-list]')).toBeNull();
      expect(root.querySelector('.lib-reader-title')?.textContent.trim()).toBe('Tech');
      expect(jumped).toEqual(['architecture']);
      expect(document.activeElement?.id).toBe('architecture');
      expect(document.activeElement?.closest('[data-library-tech-section]')?.getAttribute('data-library-tech-section')).toBe('architecture');
    });
  }

  it('opens tech.md at the Overview section from /tech, and jumps once, not again on a later render', async () => {
    await land('/w/harbor/tech', 'wide');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/library?section=overview#tech.md');
    expect(jumped).toEqual(['overview']);
    harness.fixture.detectChanges();
    await settle();
    expect(jumped).toEqual(['overview']);
  });

  it('drops the section from the address when another document opens', async () => {
    const root = await land('/w/harbor/tech/overview', 'wide');
    root.querySelector<HTMLButtonElement>(`[data-library-entry="${PLAN.path}"]`)?.click();
    await settle();
    const url = new URL(TestBed.inject(Router).url, 'http://x');
    expect(url.searchParams.has('section')).toBe(false);
    expect(url.hash).toBe(`#${PLAN.path}`);
  });

  it('ignores a section on any document but tech.md', async () => {
    await land(`/w/harbor/library?section=architecture#${PLAN.path}`, 'wide');
    expect(jumped).toEqual([]);
  });
});
