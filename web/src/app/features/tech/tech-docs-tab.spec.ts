import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harborTech from '../../../../../core/fixtures/harbor.tech.golden.json';
import type { FileDiagnostic, TechModel } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ApiClient } from '../../core/api.service';
import { ICONS } from '../../shared/icons/icons';
import { MERMAID_LOADER, type MermaidApi } from '../../shared/ui/doc-prose/mermaid';
import { type TechDocsPageName, TechDocsTab } from './tech-docs-tab';

// T15 · ISC-134.1: Overview and Architecture against the harbor tech golden: core's pages through ui-doc-prose, one
// warning notice per tech-section finding of the tab, images through the tech asset route; T22 · ISC-134.2: the empty
// state with the /spec-doc chip without specs/tech.md or when every key of the tab is missing.

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

/** The tech empty state (design.md § Leerzustand): book-open, title, body, the /spec-doc chip; no prose, no notice. */
function expectEmptyState(root: HTMLElement): void {
  const empty = root.querySelector('ui-empty-state[data-tech-empty]');
  expect(empty).not.toBeNull();
  const paths = [...(empty?.querySelectorAll('.icon ui-icon svg path') ?? [])].map((path) => path.getAttribute('d'));
  expect(paths).toEqual([...ICONS['book-open'].matchAll(/ d="([^"]+)"/g)].map((match) => match[1]));
  expect(empty?.querySelector('.title')?.textContent.trim()).toBe('No tech.md yet');
  expect(empty?.querySelector('.body')?.textContent.trim()).toBe('Overview and Architecture come from specs/tech.md. Draft it from Claude Code:');
  const chip = empty?.querySelector('.slot ui-command-chip');
  expect(chip?.querySelector('code')?.textContent).toBe('/spec-doc');
  expect(chip?.querySelector('button')?.getAttribute('aria-label')).toBe('Copy /spec-doc');
  expect(root.querySelector('ui-doc-prose')).toBeNull();
  expect(root.querySelector('ui-notice')).toBeNull();
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

  it('shows one warning notice per missing key of the tab, above the prose, while the tab keeps some content', async () => {
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
    // Architecture is made of that one key alone, so the tab is empty and shows the empty state instead (T22).
    expectEmptyState(architecture);
  });

  it('shows the empty state with the /spec-doc chip in both tabs without specs/tech.md (T22, ISC-134.2)', async () => {
    for (const page of ['overview', 'architecture'] as const) {
      TestBed.resetTestingModule();
      const root = await render(page, { ...HARBOR, pages: null });
      expectEmptyState(root);
    }
  });

  it('shows the empty state instead of the notices when every key of the tab is missing', async () => {
    const architecture = await render('architecture', { ...HARBOR, diagnostics: [missing('architecture')] });
    expectEmptyState(architecture);

    TestBed.resetTestingModule();
    const overview = await render('overview', { ...HARBOR, diagnostics: [missing('overview'), missing('stack')] });
    expectEmptyState(overview);
  });

  it('keeps the notice above the prose when only part of the tab is missing', async () => {
    const root = await render('overview', { ...HARBOR, diagnostics: [missing('overview'), missing('architecture')] });
    expect([...root.querySelectorAll('ui-notice')].map((notice) => notice.getAttribute('data-tech-section'))).toEqual(['overview']);
    expect(root.querySelector('ui-doc-prose')).not.toBeNull();
    expect(root.querySelector('[data-tech-empty], ui-empty-state, ui-command-chip')).toBeNull();
  });
});
