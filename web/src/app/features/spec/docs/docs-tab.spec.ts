import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import golden from '../../../../../../core/fixtures/harbor.docs.golden.json';
import type { DocAvailability, DocName, DocsPage } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ApiClient, type ApiResult, type DocsResult } from '../../../core/api.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { DocsTab } from './docs-tab';
import { MERMAID_LOADER, type MermaidApi } from './mermaid';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const SPEC_KEYS: Partial<Record<string, string>> = { '002': 'specs/002-web-console', '003': 'specs/003-config-loader', '009': 'specs/009-untyped' };
const TYPES: Partial<Record<string, string | null>> = { '002': 'feature', '003': 'refactor', '009': null };
/** What core's `docsFor` answers for the types used here (the stub computes it from core at runtime). */
const AVAILABILITY: Partial<Record<string, Record<DocName, DocAvailability>>> = {
  feature: { plan: { applies: true, command: '/spec-plan' }, design: { applies: true, command: '/spec-design' }, decisions: { applies: true, command: null }, constitution: { applies: true, command: '/spec-bootstrap' } },
  refactor: { plan: { applies: true, command: '/spec-plan' }, design: { applies: false, command: '/spec-design' }, decisions: { applies: true, command: null }, constitution: { applies: true, command: '/spec-bootstrap' } },
  none: { plan: { applies: false, command: '/spec-plan' }, design: { applies: false, command: '/spec-design' }, decisions: { applies: true, command: null }, constitution: { applies: true, command: '/spec-bootstrap' } },
};

const GOLDEN = golden as unknown as { constitution: DocsPage; specs: Partial<Record<string, Partial<Record<DocName, DocsPage | null>>>> };
let overrides: Partial<Record<string, DocsPage>> = {};

function docs(_ws: string, id: string, name: DocName): Promise<DocsResult> {
  const custom = overrides[`${id}/${name}`];
  if (custom) return Promise.resolve(ok(custom));
  const page = name === 'constitution' ? GOLDEN.constitution : (GOLDEN.specs[SPEC_KEYS[id] ?? '']?.[name] ?? null);
  if (page) return Promise.resolve(ok(page));
  const availability = AVAILABILITY[TYPES[id] ?? 'none']?.[name] ?? { applies: false, command: null };
  return Promise.resolve({ kind: 'doc-missing', body: { error: 'not-found', doc: name, availability } });
}

const api = {
  workspaces: () => Promise.resolve(ok([])),
  dashboard: () => Promise.resolve(ok({ specs: Object.entries(TYPES).map(([id, type]) => ({ id, title: id, type, stage: 'plan' })) })),
  spec: () => Promise.resolve({ kind: 'not-found', served: false }),
  docs,
};

const tab = (name: DocName) => ({ path: name, component: DocsTab, data: { area: 'docs', tab: name } });
const routes: Routes = [{ path: 'w/:ws/s/:id', children: (['plan', 'design', 'decisions', 'constitution'] as const).map(tab) }];

let loader: () => Promise<MermaidApi>;
let harness: RouterTestingHarness | null = null;

async function open(url: string): Promise<HTMLElement> {
  harness ??= await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  for (let i = 0; i < 4; i += 1) {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return harness.fixture.nativeElement as HTMLElement;
}

describe('DocsTab', () => {
  beforeEach(() => {
    harness = null;
    overrides = {};
    loader = () => new Promise<MermaidApi>(() => undefined); // held open: the placeholder stays
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiClient, useValue: api },
        { provide: MERMAID_LOADER, useValue: () => loader() },
      ],
    });
  });

  it('renders the plan: headings with TOC anchors, meta row, table regions, mermaid placeholder before the import resolves', async () => {
    TestBed.inject(ShellState).tier.set('wide');
    const root = await open('/w/harbor/s/002/plan');
    const plan = GOLDEN.specs['specs/002-web-console']?.plan as DocsPage;
    const prose = root.querySelector('app-docs-tab .docs-prose') as HTMLElement;
    expect(prose.querySelector('h2#approach')?.textContent).toBe('Approach');
    const links = [...root.querySelectorAll('nav.docs-toc a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(plan.toc.map((entry) => `#${entry.anchor}`));
    for (const entry of plan.toc) expect(prose.querySelector(`[id="${entry.anchor}"]`)).not.toBeNull();
    expect(root.querySelector('[data-docs-meta]')?.textContent).toContain('approved');
    expect(root.querySelector('[data-docs-meta]')?.textContent).toContain('Updated 2026-03-03');
    const regions = [...prose.querySelectorAll('div.mdtable')];
    expect(regions).toHaveLength(2);
    for (const [index, region] of regions.entries()) {
      expect(region.getAttribute('role')).toBe('region');
      expect(region.getAttribute('tabindex')).toBe('0');
      expect(region.getAttribute('aria-label')).toBe(`Table ${index + 1}, scrolls sideways`);
    }
    const figure = prose.querySelector('figure.mermaid-figure[data-figure="1"]') as HTMLElement;
    expect(figure.querySelector('pre.mermaid')?.textContent).toContain('flowchart LR');
    expect(figure.hasAttribute('data-rendered')).toBe(false);
    expect(root.querySelector('[data-diagram-missing]')).toBeNull();
  });

  it('draws mermaid figures with the lazily loaded package: strict security, no auto-start', async () => {
    const initialize = vi.fn();
    const render = vi.fn<MermaidApi['render']>(() => Promise.resolve({ svg: '<svg data-icon-exempt data-test="drawn"></svg>' }));
    loader = () => Promise.resolve({ initialize, render });
    const root = await open('/w/harbor/s/002/plan');
    const figure = root.querySelector('figure.mermaid-figure[data-figure="1"]') as HTMLElement;
    expect(figure.hasAttribute('data-rendered')).toBe(true);
    expect(figure.querySelector('.mermaid-svg svg[data-test="drawn"]')).not.toBeNull();
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: 'strict' }));
    expect(render.mock.calls[0]?.[1]).toContain('flowchart LR');
  });

  it('warns when the plan has no diagram, and shows the TOC as a disclosure below wide', async () => {
    TestBed.inject(ShellState).tier.set('compact');
    const root = await open('/w/harbor/s/003/plan');
    expect(root.querySelector('[data-diagram-missing]')?.textContent).toContain('This plan has no diagram.');
    expect(root.querySelector('nav.docs-toc')).toBeNull();
    expect(root.querySelector('ui-disclosure.docs-toc-fold')?.textContent).toContain('Contents');
  });

  it('marks an image that is not in this checkout', async () => {
    overrides['002/design'] = {
      html: '<h2 id="mobile">Mobile</h2>\n<figure class="image-figure missing" data-figure="1" data-missing><div class="figure-missing" role="img" aria-label="Ist"><code>shots/ist-390.png</code></div><figcaption>Ist</figcaption></figure>',
      toc: [{ level: 2, text: 'Mobile', anchor: 'mobile' }],
      frontmatter: null,
      figures: [{ index: 1, kind: 'image', src: 'shots/ist-390.png', alt: 'Ist', caption: 'Ist', missing: true }],
      sections: [{ id: 'mobile', heading: 'Mobile', level: 2 }],
      wordCount: 1,
    };
    const root = await open('/w/harbor/s/002/design');
    const box = root.querySelector('figure[data-missing] .figure-missing') as HTMLElement;
    expect(box.querySelector('.figure-missing-note')?.textContent).toBe('Image not in this checkout');
    expect(box.querySelector('code')?.textContent).toBe('shots/ist-390.png');
    expect(root.querySelector('figure[data-missing] img')).toBeNull();
  });

  it('shows a type-aware empty state on DocMissing', async () => {
    let root = await open('/w/harbor/s/003/design');
    expect(root.querySelector('[data-docs-empty]')?.textContent).toContain('A refactor has no design.md');
    expect(root.querySelector('[data-docs-empty] ui-command-chip')).toBeNull();

    root = await open('/w/harbor/s/002/design');
    expect(root.querySelector('[data-docs-empty]')?.textContent).toContain('No design.md yet');
    expect(root.querySelector('[data-docs-empty] ui-command-chip')?.textContent).toContain('/spec-design 002');

    root = await open('/w/harbor/s/009/plan');
    expect(root.querySelector('[data-docs-empty]')?.textContent).toContain('A spec without a type has no plan.md');
  });

  it('renders decisions with the same renderer and the constitution with a frontmatter chip row', async () => {
    let root = await open('/w/harbor/s/002/decisions');
    expect(root.querySelector('.docs-prose h1')?.textContent).toContain('Context 002');
    root = await open('/w/harbor/s/002/constitution');
    const chips = [...root.querySelectorAll('[data-docs-meta] ui-chip')].map((chip) => chip.textContent.trim());
    expect(chips).toContain('repo: harbor');
    expect(chips).toContain('design_track: app');
    expect(root.querySelector('[data-diagram-missing]')).toBeNull();
  });
});
