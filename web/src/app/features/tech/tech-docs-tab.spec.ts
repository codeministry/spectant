import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harborTech from '../../../../../core/fixtures/harbor.tech.golden.json';
import type { FileDiagnostic, TechModel } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient } from '../../core/api.service';
import { MERMAID_LOADER, type MermaidApi } from '../../shared/ui/doc-prose/mermaid';
import { type TechDocsPageName, TechDocsTab } from './tech-docs-tab';

// T15 · ISC-134.1: Overview and Architecture against the harbor tech golden: core's pages through ui-doc-prose, one
// warning notice per tech-section finding of the tab, images through the tech asset route, and the seam for T22's
// empty state when specs/tech.md is missing.

const HARBOR = harborTech as unknown as TechModel;

const missing = (key: string): FileDiagnostic => ({
  file: 'specs/tech.md',
  diagnostic: { severity: 'warning', code: 'tech-section', message: `specs/tech.md has no ${key} marker.`, subject: key },
});

async function render(page: TechDocsPageName, model: TechModel = HARBOR): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MERMAID_LOADER, useValue: () => new Promise<MermaidApi>(() => undefined) },
    ],
  });
  const fixture = TestBed.createComponent(TechDocsTab);
  fixture.componentRef.setInput('page', page);
  fixture.componentRef.setInput('model', model);
  fixture.componentRef.setInput('ws', 'harbor');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('TechDocsTab', () => {
  it('renders the overview page (overview and stack in one flow) through ui-doc-prose, no notice', async () => {
    const root = await render('overview');
    expect(root.getAttribute('data-tech-tab')).toBe('overview');
    expect(root.querySelector('ui-doc-prose')).not.toBeNull();
    expect(root.querySelector('h2#tech-overview-overview')).not.toBeNull();
    expect(root.querySelector('h2#tech-overview-stack')).not.toBeNull();
    expect(root.querySelector('div.mdtable[role="region"]')).not.toBeNull();
    expect(root.querySelector('ui-notice')).toBeNull();
    expect(root.querySelector('[data-tech-empty]')).toBeNull();
  });

  it('renders the architecture page with its mermaid figure', async () => {
    const root = await render('architecture');
    expect(root.getAttribute('data-tech-tab')).toBe('architecture');
    expect(root.querySelector('h2#tech-architecture-architecture')).not.toBeNull();
    expect(root.querySelector('figure.mermaid-figure')).not.toBeNull();
    expect(root.querySelector('h2#tech-overview-overview')).toBeNull();
  });

  it('points tech.md images at the tech asset route', async () => {
    const root = await render('overview');
    const img = root.querySelector<HTMLImageElement>('figure.image-figure img');
    expect(img?.getAttribute('src')).toBe(TestBed.inject(ApiClient).techAssetUrl('harbor', 'tech/overview.png'));
    expect(img?.getAttribute('src')).toBe('/api/workspaces/harbor/tech/asset?path=tech%2Foverview.png');
  });

  it('shows one warning notice per missing key of the tab, above the prose', async () => {
    const model: TechModel = { ...HARBOR, diagnostics: [missing('stack'), missing('architecture'), missing('risks')] };
    const overview = await render('overview', model);
    const notices = [...overview.querySelectorAll('ui-notice')];
    expect(notices.map((notice) => notice.getAttribute('data-tech-section'))).toEqual(['stack']);
    expect(notices[0]?.getAttribute('data-tone')).toBe('warning');
    expect(notices[0]?.querySelector('ui-icon')).not.toBeNull();
    expect(notices[0]?.textContent).toContain('specs/tech.md has no stack section.');
    expect(notices[0]?.textContent).toContain('Run /spec-doc to draft it.');
    const prose = overview.querySelector('ui-doc-prose');
    const notice = overview.querySelector('ui-notice');
    expect(prose !== null && notice !== null && (notice.compareDocumentPosition(prose) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);

    TestBed.resetTestingModule();
    const architecture = await render('architecture', model);
    expect([...architecture.querySelectorAll('ui-notice')].map((notice) => notice.getAttribute('data-tech-section'))).toEqual(['architecture']);
  });

  it('renders only [data-tech-empty] without specs/tech.md', async () => {
    const root = await render('overview', { ...HARBOR, pages: null });
    expect(root.querySelector('[data-tech-empty]')).not.toBeNull();
    expect(root.querySelector('ui-doc-prose')).toBeNull();
    expect(root.querySelector('ui-notice')).toBeNull();
  });
});
