import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import type { DocsPage, LibraryCatalog, LibraryDoc } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { shortDateParts, typeIcon } from './library-page';

// T27 · ISC-156: the library page on the server's catalog: one row per document with its type icon, title, spec and
// meta line, groups workspace-wide first and each spec once, a spec's evidence as one collapsed subgroup with its
// count that reveals blocks of 50 and opens under a search or the type filter Evidence, the type pills of the
// present types only, no demo chip, and the empty state with `/spec-bootstrap` for a workspace without documents.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const doc = (path: string, type: LibraryDoc['type'], title: string, extra: Partial<LibraryDoc> = {}): LibraryDoc => ({
  path,
  type,
  spec: path.includes('/') ? (path.split('/')[0] ?? path) : 'workspace',
  title,
  modified: '2026-10-12T14:02:00Z',
  state: 'ok',
  media: 'markdown',
  ...extra,
});

const EVIDENCE = 120;
const CATALOG: LibraryCatalog = {
  docs: [
    doc('002-web-console/spec.md', 'spec', 'Web console'),
    doc('002-web-console/plan.md', 'plan', 'Approach', { state: 'stale' }),
    ...Array.from({ length: EVIDENCE }, (_, i) => doc(`002-web-console/.evidence/run-${String(i + 1).padStart(3, '0')}/probe.md`, 'evidence', `Probe run ${String(i + 1)}`)),
    doc('002-web-console/.design/prototype/board', 'prototype', 'board', { media: 'prototype', pages: ['index.html', 'list.html'] }),
    doc('constitution.md', 'constitution', 'Constitution'),
    doc('ideas/webhooks.md', 'idea', 'Webhooks', { spec: 'workspace' }),
  ],
  groups: [],
  fog: [],
  missing: 0,
  stale: 1,
};
const EMPTY: LibraryCatalog = { docs: [], groups: [], fog: [], missing: 0, stale: 0 };
const PAGE: DocsPage = { html: '<p>Rendered</p>', toc: [], frontmatter: null, figures: [], sections: [], wordCount: 1 };

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'tech' | 'library' | 'libraryDoc'>;

let harness: RouterTestingHarness;

async function open(url: string, catalog: LibraryCatalog = CATALOG, tier: Tier = 'medium'): Promise<HTMLElement> {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(dashboard)),
    planning: () => Promise.resolve({ kind: 'not-found', served: false }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: '' })),
    tech: () => Promise.resolve({ kind: 'not-found', served: false }),
    library: () => Promise.resolve(ok(catalog)),
    libraryDoc: () => Promise.resolve(ok(PAGE)),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
  TestBed.inject(ShellState).tier.set(tier);
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return settle();
}

async function settle(): Promise<HTMLElement> {
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
  return harness.fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const page = (root: HTMLElement): HTMLElement => {
  const host = root.querySelector<HTMLElement>('app-library-page');
  if (host === null) throw new Error('no app-library-page');
  return host;
};
const entries = (root: HTMLElement): string[] =>
  Array.from(page(root).querySelectorAll('[data-library-entry]')).map((row) => row.getAttribute('data-library-entry') ?? '');
const evidenceEntries = (root: HTMLElement): number => page(root).querySelectorAll('[data-library-evidence] [data-library-entry]').length;

describe('LibraryPage (T27, ISC-156)', () => {
  it('lists the catalog: workspace-wide first, then each spec once, no demo chip and no demo root', async () => {
    const root = await open('/w/harbor/library');
    const host = page(root);
    expect(host.hasAttribute('data-demo')).toBe(false);
    expect(host.querySelector('[data-demo], [data-demo-chip], ui-chip[variant="demo"]')).toBeNull();
    expect(Array.from(host.querySelectorAll('[data-library-group]')).map((group) => group.getAttribute('data-library-group'))).toEqual(['workspace', '002']);
    expect(entries(root)).toEqual([
      'constitution.md',
      'ideas/webhooks.md',
      '002-web-console/spec.md',
      '002-web-console/plan.md',
      '002-web-console/.design/prototype/board',
    ]);
  });

  it('draws every row with its type tag and icon, title, spec and meta line', async () => {
    const root = await open('/w/harbor/library');
    const row = page(root).querySelector('[data-library-entry="002-web-console/plan.md"]');
    expect(row?.getAttribute('data-spec')).toBe('002-web-console');
    expect(row?.querySelector('.lib-type ui-icon svg')).not.toBeNull();
    expect(text(row?.querySelector('.lib-type'))).toBe('Plan');
    expect(text(row?.querySelector('.lib-title'))).toBe('Approach');
    expect(text(row?.querySelector('[data-library-meta]'))).toBe('specs/002-web-console/plan.md');
    expect(text(row?.querySelector('.lib-stale'))).toBe('outdated');
    const proto = page(root).querySelector('[data-library-entry="002-web-console/.design/prototype/board"]');
    expect(text(proto?.querySelector('[data-library-meta]'))).toBe('2 pages · index.html, list.html');
    expect(page(root).querySelector('[data-library-group="002"]')?.getAttribute('aria-label')).toBe('002 · web-console');
  });

  it('maps every type to its icon, an image to image whatever its type', () => {
    expect(typeIcon({ type: 'tasks', media: 'markdown' })).toBe('list-checks');
    expect(typeIcon({ type: 'design', media: 'markdown' })).toBe('palette');
    expect(typeIcon({ type: 'prototype', media: 'prototype' })).toBe('app-window');
    expect(typeIcon({ type: 'tech', media: 'markdown' })).toBe('book-open');
    expect(typeIcon({ type: 'idea', media: 'markdown' })).toBe('lightbulb');
    expect(typeIcon({ type: 'evidence', media: 'image' })).toBe('image');
  });

  it('shows the type pills of the present types only, All first', async () => {
    const root = await open('/w/harbor/library');
    const pills = Array.from(page(root).querySelectorAll('[data-library-types] button')).map((button) => text(button));
    expect(pills).toEqual(['All', 'Spec', 'Plan', 'Prototype', 'Evidence', 'Constitution', 'Idea']);
  });

  it('keeps a spec’s evidence in one collapsed subgroup with its count that reveals blocks of 50', async () => {
    const root = await open('/w/harbor/library');
    const group = page(root).querySelector('[data-library-evidence="002"]');
    const toggle = group?.querySelector<HTMLButtonElement>('[data-library-evidence-toggle]');
    expect(text(group?.querySelector('[data-library-evidence-count]'))).toBe(String(EVIDENCE));
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(evidenceEntries(root)).toBe(0);

    toggle?.click();
    await settle();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(evidenceEntries(root)).toBe(50);
    const more = (): HTMLButtonElement | null => page(root).querySelector<HTMLButtonElement>('[data-library-evidence-more]');
    expect(text(more())).toBe('Show 50 more');

    more()?.click();
    await settle();
    expect(evidenceEntries(root)).toBe(100);
    expect(text(more())).toBe('Show 20 more');

    more()?.click();
    await settle();
    expect(evidenceEntries(root)).toBe(EVIDENCE);
    expect(more()).toBeNull();
  });

  it('opens the evidence subgroup under a search and under the type filter Evidence', async () => {
    const root = await open('/w/harbor/library?q=probe%20run%201');
    expect(page(root).querySelector('[data-library-evidence-toggle]')?.getAttribute('aria-expanded')).toBe('true');
    expect(evidenceEntries(root)).toBeGreaterThan(0);
    expect(entries(root).every((path) => path.includes('.evidence/'))).toBe(true);

    await harness.navigateByUrl('/w/harbor');
    await harness.navigateByUrl('/w/harbor/library?type=evidence');
    await settle();
    expect(page(root).querySelector('[data-library-evidence-toggle]')?.getAttribute('aria-expanded')).toBe('true');
    expect(evidenceEntries(root)).toBe(50);
  });

  it('shows the empty state with /spec-bootstrap for a workspace without documents', async () => {
    const root = await open('/w/harbor/library', EMPTY);
    const none = page(root).querySelector('[data-library-none]');
    expect(none).not.toBeNull();
    expect(text(none?.querySelector('.title'))).toBe('No documents in harbor yet');
    expect(none?.querySelector('ui-command-chip')?.textContent).toContain('/spec-bootstrap');
    expect(page(root).querySelector('[data-library-search], [data-library-list]')).toBeNull();
  });

  it('renders the chosen Markdown document in the reader at wide', async () => {
    const root = await open('/w/harbor/library', CATALOG, 'wide');
    await settle();
    expect(text(page(root).querySelector('[data-library-reader] h2'))).toBe('Constitution');
    expect(text(page(root).querySelector('[data-library-prose]'))).toBe('Rendered');
    expect(page(root).querySelector('[data-library-open]')).toBeNull();
  });
});

describe('shortDateParts (T27)', () => {
  const now = new Date('2026-10-13T09:00:00Z');
  it('reads day, month and time, the year only outside the current one', () => {
    expect(shortDateParts('2026-10-12T14:02:00Z', now, 'en')).toEqual({ date: 'Oct 12', time: '14:02' });
    expect(shortDateParts('2026-10-12T14:02:00Z', now, 'de')).toEqual({ date: '12.10.', time: '14:02' });
    expect(shortDateParts('2025-03-07T09:05:00Z', now, 'en')).toEqual({ date: 'Mar 7, 2025', time: '09:05' });
    expect(shortDateParts('2025-03-07T09:05:00Z', now, 'de')).toEqual({ date: '07.03.2025', time: '09:05' });
  });
});
