import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { DocsPage } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiDocProse } from './doc-prose';
import { MERMAID_LOADER, MIN_DIAGRAM_LABEL_PX, mermaidKeepsNaturalWidth, type MermaidApi } from './mermaid';

/** Stands in for the browser's ResizeObserver: the test decides when the figure's container changed. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.all.push(this);
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  unobserve(): void {
    // Nothing to release.
  }
  disconnect(): void {
    this.targets.length = 0;
  }
  fire(): void {
    this.callback(this.targets.map((target) => ({ target }) as ResizeObserverEntry), this);
  }
}

const SOURCE = 'flowchart LR\n  a --> b --> c --> d --> e';

function page(caption: string): DocsPage {
  const figcaption = caption ? `<figcaption>${caption}</figcaption>` : '';
  return {
    html: `<h2 id="approach">Approach</h2>\n<figure class="mermaid-figure" data-figure="1"><pre class="mermaid">${SOURCE}</pre>${figcaption}</figure>`,
    toc: [],
    frontmatter: null,
    figures: [{ index: 1, kind: 'mermaid', diagram: 'flowchart', source: SOURCE, caption }],
    sections: [{ id: 'approach', heading: 'Approach', level: 2 }],
    wordCount: 1,
  };
}

/** A drawn `flowchart LR` of five nodes: 812 user units wide at mermaid's 16 px label size. */
const SVG = '<svg data-icon-exempt viewBox="-8 -8 812 120" width="100%" style="max-width: 812px; font-size: 16px"></svg>';

let containerWidth = 0;

async function render(caption = 'Approach'): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(UiDocProse);
  fixture.componentRef.setInput('page', page(caption));
  for (let i = 0; i < 4; i += 1) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return fixture.nativeElement as HTMLElement;
}

describe('UiDocProse mermaid width', () => {
  beforeEach(() => {
    containerWidth = 0;
    FakeResizeObserver.all = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('mermaid-svg') ? containerWidth : 0;
    });
    const loader: () => Promise<MermaidApi> = () => Promise.resolve({ initialize: vi.fn(), render: () => Promise.resolve({ svg: SVG }) });
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: MERMAID_LOADER, useValue: loader }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps scaling while the scaled labels stay at or above 12 px', () => {
    expect(MIN_DIAGRAM_LABEL_PX).toBe(12);
    expect(mermaidKeepsNaturalWidth(812, 358, 16)).toBe(true); // 16 × 358 / 812 ≈ 7 px
    expect(mermaidKeepsNaturalWidth(812, 609, 16)).toBe(false); // exactly 12 px
    expect(mermaidKeepsNaturalWidth(812, 600, 16)).toBe(true);
    expect(mermaidKeepsNaturalWidth(400, 358, 16)).toBe(false); // ≈ 14 px
    expect(mermaidKeepsNaturalWidth(300, 358, 16)).toBe(false); // not scaled at all
    expect(mermaidKeepsNaturalWidth(812, 0, 16)).toBe(false); // not laid out: no decision
    expect(mermaidKeepsNaturalWidth(0, 358, 16)).toBe(false);
  });

  it('keeps a wide figure at its natural width as a labelled scroll region in a narrow container', async () => {
    containerWidth = 358;
    const root = await render();
    const scroller = root.querySelector('figure[data-rendered] > .mermaid-svg') as HTMLElement;
    expect(scroller.hasAttribute('data-natural')).toBe(true);
    expect(scroller.style.getPropertyValue('--mermaid-natural-width')).toBe('812px');
    expect(scroller.getAttribute('role')).toBe('region');
    expect(scroller.getAttribute('tabindex')).toBe('0');
    expect(scroller.getAttribute('aria-label')).toBe('Approach');
  });

  it('names an uncaptioned figure region from the catalog', async () => {
    containerWidth = 358;
    const root = await render('');
    expect(root.querySelector('.mermaid-svg')?.getAttribute('aria-label')).toBe('Diagram 1, scrolls sideways');
  });

  it('scales a figure that stays legible, and follows its container both ways', async () => {
    containerWidth = 1000;
    const root = await render();
    const scroller = root.querySelector('.mermaid-svg') as HTMLElement;
    expect(scroller.hasAttribute('data-natural')).toBe(false);
    expect(scroller.hasAttribute('role')).toBe(false);
    expect(scroller.hasAttribute('tabindex')).toBe(false);
    expect(scroller.hasAttribute('aria-label')).toBe(false);

    const observer = FakeResizeObserver.all.find((candidate) => candidate.targets.includes(scroller));
    expect(observer).toBeDefined();
    containerWidth = 358;
    observer?.fire();
    expect(scroller.getAttribute('role')).toBe('region');
    expect(scroller.getAttribute('tabindex')).toBe('0');

    containerWidth = 1000;
    observer?.fire();
    expect(scroller.hasAttribute('data-natural')).toBe(false);
    expect(scroller.hasAttribute('tabindex')).toBe(false);
    expect(scroller.style.getPropertyValue('--mermaid-natural-width')).toBe('');
  });
});

// Spec 057, ISC-381: the full screen view draws under the page's mermaid configuration; only drawMermaid sets it.
describe('UiDocProse full screen diagram', () => {
  const initialize = vi.fn();
  const draw = vi.fn(() => Promise.resolve({ svg: SVG }));

  beforeEach(() => {
    initialize.mockClear();
    draw.mockClear();
    containerWidth = 1000;
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const loader: () => Promise<MermaidApi> = () => Promise.resolve({ initialize, render: draw });
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: MERMAID_LOADER, useValue: loader }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fullscreen no initialize: opening a diagram full screen draws it again without calling mermaid.initialize', async () => {
    const root = await render();
    expect(initialize).toHaveBeenCalledTimes(1); // the page's own draw
    expect(draw).toHaveBeenCalledTimes(1);
    const tools = root.querySelectorAll<HTMLButtonElement>('figure[data-rendered] ui-diagram-toolbar button.diagram-tool');
    const toggle = tools.item(tools.length - 1);
    expect(toggle.getAttribute('aria-label')).toBe('Full screen');
    toggle.click();
    for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(draw).toHaveBeenCalledTimes(2); // the full screen draw ran
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});

// T68 · ISC-251: a document drawn as several proses (the library reader's sections) numbers its tables across them.
describe('UiDocProse table regions', () => {
  const TABLE = '<div class="mdtable"><table><thead><tr><th>a</th></tr></thead><tbody></tbody></table></div>';
  const tables: DocsPage = { html: `${TABLE}\n${TABLE}`, toc: [], frontmatter: null, figures: [], sections: [], wordCount: 1 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: MERMAID_LOADER, useValue: () => Promise.reject(new Error('unused')) }],
    });
  });

  async function labels(start?: number): Promise<Array<string | null>> {
    const fixture = TestBed.createComponent(UiDocProse);
    fixture.componentRef.setInput('page', tables);
    if (start !== undefined) fixture.componentRef.setInput('tableStart', start);
    await fixture.whenStable();
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('div.mdtable[role="region"]')].map((region) => region.getAttribute('aria-label'));
  }

  it('numbers its tables from 1 on its own', async () => {
    expect(await labels()).toEqual(['Table 1, scrolls sideways', 'Table 2, scrolls sideways']);
  });

  it('numbers on after the tables before it in the document', async () => {
    expect(await labels(3)).toEqual(['Table 4, scrolls sideways', 'Table 5, scrolls sideways']);
  });
});
