import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import type { DocsPage, LibraryCatalog, LibraryDoc } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { RefreshService } from '../../layout/shell/refresh.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { addressParams, controlViews, missingCommand, SEARCH_DEBOUNCE_MS, typeIcon } from './library-page';
import { formatInstant } from '../../shared/time';

// T27 · ISC-156: the library page on the server's catalog: one row per document with its type icon, title, spec and
// meta line, groups workspace-wide first and each spec once, a spec's evidence as one collapsed subgroup with its
// count that reveals blocks of 50 and opens under a search or the type filter Evidence, the type pills of the
// present types only, no demo chip, and the empty state with `/spec init` for a workspace without documents.

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

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'library' | 'libraryDoc' | 'librarySearch'>;

let harness: RouterTestingHarness;
/** Every search text the page sent to `librarySearch`, in order; reset per test. */
let searched: string[] = [];
/** The server's full-text hits the fake answers for any search text (path → snippet); reset per test. */
let serverHits: Record<string, string> = {};
/** How often the page read the catalog and a document; reset per test. */
let libraryReads = 0;
let docReads = 0;

beforeEach(() => {
  searched = [];
  serverHits = {};
  libraryReads = 0;
  docReads = 0;
});

/** A catalog, or a function the fake asks on every read (a catalog that changes between reads). */
type CatalogSource = LibraryCatalog | (() => LibraryCatalog);

async function open(url: string, catalog: CatalogSource = CATALOG, tier: Tier = 'medium', lang: 'en' | 'de' = 'en'): Promise<HTMLElement> {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(dashboard)),
    planning: () => Promise.resolve({ kind: 'not-found', served: false }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: '' })),
    library: () => {
      libraryReads += 1;
      return Promise.resolve(ok(typeof catalog === 'function' ? catalog() : catalog));
    },
    libraryDoc: () => {
      docReads += 1;
      return Promise.resolve(ok(PAGE));
    },
    librarySearch: (_ws, q) => {
      searched.push(q);
      return Promise.resolve(ok({ query: q.trim(), hits: Object.entries(serverHits).map(([path, snippet]) => ({ path, snippet })) }));
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
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
  TestBed.inject(ShellState).tier.set(tier);
  TestBed.inject(TranslocoService).setActiveLang(lang);
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

  it('shows the empty state with /spec init for a workspace without documents', async () => {
    const root = await open('/w/harbor/library', EMPTY);
    const none = page(root).querySelector('[data-library-none]');
    expect(none).not.toBeNull();
    expect(text(none?.querySelector('.title'))).toBe('No documents in harbor yet');
    expect(none?.querySelector('ui-command-chip')?.textContent).toContain('/spec init');
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

// T30 · ISC-156.1: the card's first row holds the control counts "missing" and "outdated" from the catalog; a click
// filters the list to exactly those documents (`?state=`), a second lifts it, a zero count is disabled; rows carry the
// chip of their state, a missing row is dimmed by colour and form, and its reader is the empty state with its command.
const CONTROL: LibraryCatalog = {
  docs: [
    doc('002-web-console/spec.md', 'spec', 'Web console'),
    doc('002-web-console/plan.md', 'plan', 'Approach', { state: 'stale' }),
    doc('002-web-console/tasks.md', 'tasks', 'tasks.md', { state: 'missing', modified: null }),
    doc('003-board/spec.md', 'spec', 'Board', { state: 'stale' }),
    doc('003-board/plan.md', 'plan', 'plan.md', { state: 'missing', modified: null }),
    doc('constitution.md', 'constitution', 'Constitution'),
  ],
  groups: [],
  fog: [],
  missing: 2,
  stale: 2,
};

const control = (root: HTMLElement, key: string): HTMLButtonElement => {
  const button = page(root).querySelector<HTMLButtonElement>(`[data-library-control="${key}"]`);
  if (button === null) throw new Error(`no control ${key}`);
  return button;
};
const stateParam = (): string | null => new URLSearchParams(TestBed.inject(Location).path().split('?')[1]?.split('#')[0] ?? '').get('state');

describe('LibraryPage control counts (T30, ISC-156.1)', () => {
  it('shows missing then outdated as the card’s first row, with the catalog’s numbers, icons and names', async () => {
    const root = await open('/w/harbor/library', CONTROL);
    const head = page(root).querySelector('[data-library-list] > .lib-head');
    expect(head).not.toBeNull();
    expect(head?.previousElementSibling).toBeNull();
    expect(Array.from(head?.querySelectorAll('[data-library-control]') ?? []).map((b) => b.getAttribute('data-library-control'))).toEqual(['missing', 'stale']);
    const missing = control(root, 'missing');
    const stale = control(root, 'stale');
    expect(missing.tagName).toBe('BUTTON');
    expect(text(missing.querySelector('[data-library-control-count]'))).toBe('2');
    expect(text(stale.querySelector('[data-library-control-count]'))).toBe('2');
    expect(text(missing.querySelector('.lib-ctl-label'))).toBe('missing');
    expect(text(stale.querySelector('.lib-ctl-label'))).toBe('outdated');
    expect(missing.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('file-x');
    expect(stale.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('triangle-alert');
    expect(missing.getAttribute('aria-label')).toBe('Show 2 missing documents');
    expect(stale.getAttribute('aria-label')).toBe('Show 2 outdated documents');
    expect(missing.getAttribute('aria-pressed')).toBe('false');
    expect(missing.hasAttribute('aria-disabled')).toBe(false);
  });

  it('names the counts in German, plural and singular', async () => {
    const root = await open('/w/harbor/library', { ...CONTROL, stale: 1 }, 'medium', 'de');
    expect(control(root, 'missing').getAttribute('aria-label')).toBe('2 fehlende Dokumente zeigen');
    expect(control(root, 'stale').getAttribute('aria-label')).toBe('1 veraltetes Dokument zeigen');
    expect(text(control(root, 'missing').querySelector('.lib-ctl-label'))).toBe('fehlt');
    expect(text(control(root, 'stale').querySelector('.lib-ctl-label'))).toBe('veraltet');
    expect(text(page(root).querySelector('[data-library-chip="missing"]'))).toBe('fehlt');
  });

  it('filters the list to exactly the counted documents, and a second click lifts the filter', async () => {
    const root = await open('/w/harbor/library', CONTROL);
    const all = entries(root);
    control(root, 'missing').click();
    await settle();
    expect(control(root, 'missing').getAttribute('aria-pressed')).toBe('true');
    expect(stateParam()).toBe('missing');
    expect(entries(root)).toEqual(['002-web-console/tasks.md', '003-board/plan.md']);

    control(root, 'stale').click();
    await settle();
    expect(control(root, 'missing').getAttribute('aria-pressed')).toBe('false');
    expect(control(root, 'stale').getAttribute('aria-pressed')).toBe('true');
    expect(stateParam()).toBe('stale');
    expect(entries(root)).toEqual(['002-web-console/plan.md', '003-board/spec.md']);
    expect(page(root).querySelector<HTMLSelectElement>('[data-library-state-select]')?.value).toBe('stale');

    control(root, 'stale').click();
    await settle();
    expect(control(root, 'stale').getAttribute('aria-pressed')).toBe('false');
    expect(stateParam()).toBeNull();
    expect(entries(root)).toEqual(all);
  });

  it('reads the pressed count from the address', async () => {
    const root = await open('/w/harbor/library?state=missing', CONTROL);
    expect(control(root, 'missing').getAttribute('aria-pressed')).toBe('true');
    expect(entries(root)).toEqual(['002-web-console/tasks.md', '003-board/plan.md']);
  });

  it('keeps a zero count standing: circle-check, aria-disabled, no filter, a singular name in both languages', async () => {
    const root = await open('/w/harbor/library', { ...CATALOG, missing: 0, stale: 1 });
    const missing = control(root, 'missing');
    expect(text(missing.querySelector('[data-library-control-count]'))).toBe('0');
    expect(missing.getAttribute('aria-disabled')).toBe('true');
    expect(missing.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('circle-check');
    expect(missing.getAttribute('aria-label')).toBe('No missing documents');
    missing.click();
    await settle();
    expect(missing.getAttribute('aria-pressed')).toBe('false');
    expect(stateParam()).toBeNull();
    expect(control(root, 'stale').getAttribute('aria-label')).toBe('Show 1 outdated document');
  });

  it('picks the name by the count: none at zero, one, other', () => {
    expect(controlViews({ missing: 5, stale: 0 }, 'all').map((view) => view.labelKey)).toEqual(['library.control.missing.other', 'library.control.stale.none']);
    expect(controlViews({ missing: 1, stale: 3 }, 'stale').map((view) => [view.labelKey, view.pressed, view.icon])).toEqual([
      ['library.control.missing.one', false, 'file-x'],
      ['library.control.stale.other', true, 'triangle-alert'],
    ]);
  });

  it('marks every stale and missing row with its chip and dims a missing row by colour and form', async () => {
    const root = await open('/w/harbor/library', CONTROL);
    const chips = (key: string): string[] =>
      Array.from(page(root).querySelectorAll(`[data-library-chip="${key}"]`)).map((chip) => chip.closest('[data-library-entry]')?.getAttribute('data-library-entry') ?? '');
    expect(chips('missing')).toEqual(['002-web-console/tasks.md', '003-board/plan.md']);
    expect(chips('stale')).toEqual(['002-web-console/plan.md', '003-board/spec.md']);
    const row = page(root).querySelector('[data-library-entry="003-board/plan.md"]');
    expect(row?.getAttribute('data-state')).toBe('missing');
    expect(text(row?.querySelector('[data-library-chip="missing"]'))).toBe('missing');
    expect(row?.querySelector('[data-library-chip="missing"] ui-icon')?.getAttribute('data-icon')).toBe('file-x');
    expect(text(row?.querySelector('.lib-date'))).toBe('');
    // Present documents first, the missing one after them within the spec.
    expect(entries(root).filter((path) => path.startsWith('003-'))).toEqual(['003-board/spec.md', '003-board/plan.md']);
  });

  it("shows a row's date as a time element in the browser's zone, through the shared formatter (spec 006)", async () => {
    const root = await open('/w/harbor/library', CONTROL);
    const time = page(root).querySelector('[data-library-entry="003-board/spec.md"] .lib-date time');
    const iso = time?.getAttribute('datetime') ?? '';
    expect(Number.isNaN(Date.parse(iso))).toBe(false);
    expect(text(time)).toBe(formatInstant(iso, 'en'));
  });

  it('opens a missing document as the empty state with the command that writes it', async () => {
    const root = await open('/w/harbor/library#003-board/plan.md', CONTROL);
    const reader = page(root).querySelector('[data-library-reader]');
    const empty = reader?.querySelector('[data-library-missing]');
    expect(empty).not.toBeNull();
    expect(text(empty?.querySelector('.title'))).toBe('plan.md is missing');
    expect(empty?.querySelector('ui-command-chip')?.textContent).toContain('/spec plan 003');
    expect(reader?.querySelector('[data-library-prose]')).toBeNull();
    expect(missingCommand({ type: 'tasks', spec: '002-web-console' })).toBe('/spec tasks 002');
    expect(missingCommand({ type: 'design', spec: '002-web-console' })).toBeNull();
  });
});

// T32 · ISC-156.2: search text, type, spec, state and the chosen document live in the address (`?q=`, `?type=`,
// `?spec=`, `?state=`, `#path`), read from the route and written through the router, so a reload or a navigation lands
// on the same selection; the state select (All · Outdated · Missing · Open) replaces "Only outdated"; the search
// matches titles and paths at once and the full text through the server after a debounce, with its snippet.
const address = (): { readonly params: URLSearchParams; readonly fragment: string | null } => {
  const router = TestBed.inject(Router);
  const tree = router.parseUrl(router.url);
  const map = tree.queryParamMap;
  return { params: new URLSearchParams(map.keys.map((key) => [key, map.get(key) ?? ''])), fragment: tree.fragment };
};
const select = (root: HTMLElement, hook: string): HTMLSelectElement => {
  const el = page(root).querySelector<HTMLSelectElement>(`[${hook}]`);
  if (el === null) throw new Error(`no select ${hook}`);
  return el;
};
const choose = async (root: HTMLElement, hook: string, value: string): Promise<void> => {
  const el = select(root, hook);
  el.value = value;
  el.dispatchEvent(new Event('change'));
  await settle();
};
const searchBox = (root: HTMLElement): HTMLInputElement => {
  const el = page(root).querySelector<HTMLInputElement>('[data-library-search]');
  if (el === null) throw new Error('no search box');
  return el;
};
/** A keystroke: the input event and one change detection, without waiting for the debounce or the router. */
const type = (root: HTMLElement, value: string): void => {
  const box = searchBox(root);
  box.value = value;
  box.dispatchEvent(new Event('input'));
  harness.fixture.detectChanges();
};
const afterDebounce = async (): Promise<HTMLElement> => {
  await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
  return settle();
};

describe('LibraryPage archived documents (spec 034, ISC-187.1)', () => {
  /** An active spec and an archived one: the archived documents lie below `archive/` and carry the flag. */
  const ARCHIVED: LibraryCatalog = {
    docs: [
      doc('002-web-console/spec.md', 'spec', 'Web console'),
      doc('archive/001-first-light/spec.md', 'spec', 'First light', { spec: '001-first-light', archived: true }),
      doc('archive/001-first-light/.design/prototype', 'prototype', 'prototype', {
        spec: '001-first-light',
        archived: true,
        media: 'prototype',
        pages: ['index.html'],
      }),
    ],
    groups: [],
    fog: [],
    missing: 0,
    stale: 0,
  };

  const groupsOf = (root: HTMLElement): Array<string | null> =>
    Array.from(page(root).querySelectorAll('[data-library-group]')).map((g) => g.getAttribute('data-library-group'));
  const pill = (root: HTMLElement): HTMLButtonElement | null => page(root).querySelector<HTMLButtonElement>('[data-library-archived]');

  it('archived: hidden by default; the pill "Archived" with its count is off and the spec select lacks the archived spec', async () => {
    const root = await open('/w/harbor/library', ARCHIVED);
    expect(groupsOf(root)).toEqual(['workspace', '002']);
    expect(page(root).querySelector('[data-library-chip="archived"]')).toBeNull();
    expect(pill(root)?.getAttribute('aria-pressed')).toBe('false');
    expect(text(pill(root)?.querySelector('[data-library-archived-count]'))).toBe('2');
    expect(pill(root)?.getAttribute('aria-label')).toBe('Documents of archived specs (2)');
    expect(Array.from(select(root, 'data-library-spec').options).map((o) => o.value)).toEqual(['all', '002']);
    expect(text(page(root).querySelector('[data-library-count]'))).toContain('1 of 1 documents');
  });

  it('archived: the pill lists them in their spec group with the chip and writes ?archived=1; a second click hides them', async () => {
    const root = await open('/w/harbor/library', ARCHIVED);
    pill(root)?.click();
    await settle();
    expect(address().params.get('archived')).toBe('1');
    expect(pill(root)?.getAttribute('aria-pressed')).toBe('true');
    expect(groupsOf(root)).toEqual(['workspace', '001', '002']);
    const chips = Array.from(page(root).querySelectorAll('[data-library-chip="archived"]')).map(
      (chip) => chip.closest('[data-library-entry]')?.getAttribute('data-library-entry') ?? '',
    );
    expect(chips).toEqual(['archive/001-first-light/spec.md', 'archive/001-first-light/.design/prototype']);
    const row = page(root).querySelector('[data-library-entry="archive/001-first-light/spec.md"]');
    expect(text(row?.querySelector('[data-library-chip="archived"]'))).toBe('archived');
    expect(row?.querySelector('[data-library-chip="archived"] ui-icon')?.getAttribute('data-icon')).toBe('archive');
    expect(page(root).querySelector('[data-library-entry="002-web-console/spec.md"] [data-library-chip]')).toBeNull();
    expect(text(page(root).querySelector('[data-library-count]'))).toContain('3 of 3 documents');

    pill(root)?.click();
    await settle();
    expect(address().params.has('archived')).toBe(false);
    expect(groupsOf(root)).toEqual(['workspace', '002']);
  });

  it('archived: combines with type, spec and search; hiding them lifts a spec select that named an archived spec', async () => {
    const root = await open('/w/harbor/library?archived=1&type=spec', ARCHIVED);
    expect(entries(root)).toEqual(['archive/001-first-light/spec.md', '002-web-console/spec.md']);
    await harness.navigateByUrl('/w/harbor/library?archived=1&spec=001&q=first');
    await settle();
    expect(entries(root)).toEqual(['archive/001-first-light/spec.md', 'archive/001-first-light/.design/prototype']);
    pill(root)?.click();
    await settle();
    expect(address().params.has('archived')).toBe(false);
    expect(address().params.has('spec')).toBe(false);
    expect(address().params.get('q')).toBe('first');
  });

  it('archived: no pill without archived documents, and none in spec scope, where an archived spec lists its own', async () => {
    expect(pill(await open('/w/harbor/library'))).toBeNull();
    TestBed.resetTestingModule();
    const root = await open('/w/harbor/s/001/library', ARCHIVED);
    expect(pill(root)).toBeNull();
    expect(entries(root)).toContain('archive/001-first-light/spec.md');
  });

  it('archived: the chip and the pill read German', async () => {
    const root = await open('/w/harbor/library?archived=1', ARCHIVED, 'medium', 'de');
    expect(text(page(root).querySelector('[data-library-entry="archive/001-first-light/spec.md"] [data-library-chip="archived"]'))).toBe('archiviert');
    expect(text(pill(root))).toContain('Archiviert');
    expect(pill(root)?.getAttribute('aria-label')).toBe('Dokumente archivierter Specs (2)');
  });
});

describe('LibraryPage address, state select and search (T32, ISC-156.2)', () => {
  it('restores search text, type, spec, state and the document from the address on arrival', async () => {
    const root = await open('/w/harbor/library?q=approach&type=plan&spec=002&state=stale#002-web-console/plan.md', CONTROL, 'wide');
    expect(searchBox(root).value).toBe('approach');
    expect(select(root, 'data-library-spec').value).toBe('002');
    expect(select(root, 'data-library-state-select').value).toBe('stale');
    expect(entries(root)).toEqual(['002-web-console/plan.md']);
    expect(text(page(root).querySelector('[data-library-reader] h2'))).toBe('Approach');
    expect(page(root).querySelector('[data-library-entry="002-web-console/plan.md"]')?.getAttribute('aria-current')).toBe('true');
    expect(control(root, 'stale').getAttribute('aria-pressed')).toBe('true');
  });

  it('writes each change through the router, keeps foreign params, and follows a navigation from outside', async () => {
    const root = await open('/w/harbor/library?keep=1', CONTROL, 'wide');
    await choose(root, 'data-library-state-select', 'missing');
    expect(address().params.get('state')).toBe('missing');
    expect(control(root, 'missing').getAttribute('aria-pressed')).toBe('true');

    await choose(root, 'data-library-spec', '003');
    expect(entries(root)).toEqual(['003-board/plan.md']);
    page(root).querySelector<HTMLButtonElement>('[data-library-entry="003-board/plan.md"]')?.click();
    await settle();
    expect(address().fragment).toBe('003-board/plan.md');
    expect(Object.fromEntries(address().params)).toEqual({ keep: '1', spec: '003', state: 'missing' });

    // Reload: the same address lands on the same selection.
    await harness.navigateByUrl('/w/harbor');
    await harness.navigateByUrl(`/w/harbor/library?keep=1&spec=003&state=missing#003-board/plan.md`);
    await settle();
    expect(entries(root)).toEqual(['003-board/plan.md']);
    expect(select(root, 'data-library-state-select').value).toBe('missing');
    expect(text(page(root).querySelector('[data-library-missing] .title'))).toBe('plan.md is missing');

    // A navigation from outside (back, forward, a link) replaces the shown filter.
    await harness.navigateByUrl('/w/harbor/library?type=spec');
    await settle();
    expect(select(root, 'data-library-state-select').value).toBe('all');
    expect(select(root, 'data-library-spec').value).toBe('all');
    expect(entries(root)).toEqual(['002-web-console/spec.md', '003-board/spec.md']);
    expect(control(root, 'missing').getAttribute('aria-pressed')).toBe('false');
  });

  it('offers the state select All · Outdated · Missing · Open beside the spec select, in place of "Only outdated"', async () => {
    const root = await open('/w/harbor/library', CONTROL);
    const state = select(root, 'data-library-state-select');
    expect(Array.from(state.options).map((option) => [option.value, text(option)])).toEqual([
      ['all', 'All'],
      ['stale', 'Outdated'],
      ['missing', 'Missing'],
      ['open', 'Open'],
    ]);
    expect(state.closest('label')?.classList.contains('lib-select')).toBe(true);
    expect(text(state.closest('label')?.querySelector('.type-eyebrow'))).toBe('State');
    expect(state.closest('.lib-filters')).toBe(select(root, 'data-library-spec').closest('.lib-filters'));
    expect(page(root).querySelector('[data-library-stale], input[type="checkbox"]')).toBeNull();

    control(root, 'stale').click();
    await settle();
    expect(select(root, 'data-library-state-select').value).toBe('stale');
    await choose(root, 'data-library-state-select', 'open');
    expect(address().params.get('state')).toBe('open');
    expect(entries(root)).toEqual([]);
    expect(control(root, 'stale').getAttribute('aria-pressed')).toBe('false');
    await choose(root, 'data-library-state-select', 'all');
    expect(address().params.has('state')).toBe(false);
  });

  it('names the states and the count line in German', async () => {
    const root = await open('/w/harbor/library', CONTROL, 'medium', 'de');
    expect(Array.from(select(root, 'data-library-state-select').options).map((option) => text(option))).toEqual(['Alle', 'Veraltet', 'Fehlt', 'Offen']);
    expect(text(page(root).querySelector('[data-library-count]'))).toBe('harbor · 6 von 6 Dokumenten · 2 veraltet · 2 fehlen');
  });

  it('names the missing documents in the count line', async () => {
    const root = await open('/w/harbor/library?state=stale', CONTROL);
    expect(text(page(root).querySelector('[data-library-count]'))).toBe('harbor · 2 of 6 documents · 2 outdated · 2 missing');
  });

  it('matches titles and paths at once and the full text after the debounce, with one request for the last text', async () => {
    serverHits = { '002-web-console/spec.md': 'the console renders the board of every spec' };
    const root = await open('/w/harbor/library', CONTROL);
    for (const value of ['b', 'bo', 'boa', 'board']) type(root, value);
    expect(entries(root)).toEqual(['003-board/spec.md', '003-board/plan.md']);
    expect(searched).toEqual([]);

    await afterDebounce();
    expect(searched).toEqual(['board']);
    expect(address().params.get('q')).toBe('board');
    expect(entries(root)).toEqual(['002-web-console/spec.md', '003-board/spec.md', '003-board/plan.md']);
    const hit = page(root).querySelector('[data-library-entry="002-web-console/spec.md"] [data-library-meta]');
    expect(hit?.hasAttribute('data-library-snippet')).toBe(true);
    expect(text(hit)).toBe('the console renders the board of every spec');
    expect(text(hit?.querySelector('mark'))).toBe('board');
    const titleOnly = page(root).querySelector('[data-library-entry="003-board/spec.md"] [data-library-meta]');
    expect(titleOnly?.hasAttribute('data-library-snippet')).toBe(false);
    expect(text(titleOnly)).toBe('specs/003-board/spec.md');
  });

  it('sends no request for a blank search text and drops the hits of the last one', async () => {
    serverHits = { '002-web-console/spec.md': 'the board' };
    const root = await open('/w/harbor/library?q=board', CONTROL);
    await afterDebounce();
    expect(searched).toEqual(['board']);
    expect(entries(root)).toContain('002-web-console/spec.md');

    type(root, '  ');
    await afterDebounce();
    expect(searched).toEqual(['board']);
    expect(page(root).querySelector('[data-library-snippet]')).toBeNull();
    expect(entries(root)).toHaveLength(CONTROL.docs.length);
  });

  it('promises a command in the missing reader only when there is one', async () => {
    const odd: LibraryCatalog = { ...CONTROL, docs: [...CONTROL.docs, doc('003-board/design.md', 'design', 'design.md', { state: 'missing', modified: null })], missing: 3 };
    const root = await open('/w/harbor/library#003-board/design.md', odd);
    const empty = page(root).querySelector('[data-library-missing]');
    expect(text(empty)).toContain('The spec’s stage asks for this document.');
    expect(text(empty)).not.toContain('command');
    expect(empty?.querySelector('ui-command-chip')).toBeNull();

    await harness.navigateByUrl('/w/harbor/library#003-board/plan.md');
    await settle();
    const withCommand = page(root).querySelector('[data-library-missing]');
    expect(text(withCommand)).toContain('the command below writes it');
    expect(withCommand?.querySelector('ui-command-chip')?.textContent).toContain('/spec plan 003');
  });

  it('writes a default as null, so the router removes its param', () => {
    expect(addressParams({ query: '', type: 'all', spec: 'all', state: 'all', archived: false })).toEqual({ q: null, type: null, spec: null, state: null, archived: null });
    expect(addressParams({ query: 'x', type: 'plan', spec: '017', state: 'open', archived: true })).toEqual({ q: 'x', type: 'plan', spec: '017', state: 'open', archived: '1' });
  });
});


// T36 · ISC-157: a compact head per spec group (type, stage, claims with meter, tasks, fog count, Goal clamped, Approach
// in a closed disclosure), the filter "open" with every fog line under its spec, and an absent tech.md as a dimmed row
// outside every count whose reader is the empty state, which names no command (spec 031).
const HEADS: LibraryCatalog = {
  ...CATALOG,
  docs: [...CATALOG.docs, doc('003-board/spec.md', 'spec', 'Board'), doc('tech.md', 'tech', 'Harbor tech')],
  groups: [
    {
      spec: '002-web-console',
      type: 'feature',
      stage: 'build',
      claimsClosed: 3,
      claimsTotal: 16,
      tasksDone: 0,
      tasksTotal: 12,
      fog: 2,
      goal: 'Every **workspace** has a library.',
      approach: 'Read the catalog once.',
    },
    { spec: '003-board', type: null, stage: 'done', claimsClosed: 4, claimsTotal: 4, tasksDone: 2, tasksTotal: 2, fog: 0, goal: null, approach: null },
  ],
  fog: [
    { spec: '002-web-console', text: 'Which reader width?' },
    { spec: '002-web-console', text: 'Does `quota` apply?' },
    { spec: '004-retention', text: 'How long?' },
  ],
};

const head = (root: HTMLElement, key: string): Element | null => page(root).querySelector(`[data-library-group="${key}"] [data-library-group-head]`);

describe('LibraryPage group heads, filter "open" and tech.md (T36, ISC-157)', () => {
  it('heads each spec group with type, stage, claims, tasks, fog, Goal and Approach; the workspace keeps its eyebrow', async () => {
    const root = await open('/w/harbor/library', HEADS);
    expect(page(root).querySelector('[data-library-group="workspace"] [data-library-group-head]')).toBeNull();
    expect(page(root).querySelector('[data-library-group="workspace"] .lib-group-head')).not.toBeNull();
    const h = head(root, '002');
    expect(text(h?.querySelector('.lib-ghead-link'))).toBe('002·web-console');
    expect(h?.querySelector('.lib-ghead-link')?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(text(h?.querySelector('[data-library-head="type"]'))).toBe('feature');
    expect(h?.querySelector('[data-library-head="stage"]')?.getAttribute('data-tone')).toBe('primary');
    expect(text(h?.querySelector('[data-library-head="claims"]'))).toBe('3/16');
    expect(h?.querySelector('ui-meter')?.getAttribute('aria-valuetext')).toBe('3 of 16 claims closed');
    expect(text(h?.querySelector('[data-library-head="tasks"]'))).toBe('0/12');
    const fog = h?.querySelector('[data-library-head="fog"]');
    expect(text(fog)).toBe('2 open');
    expect(fog?.getAttribute('href')).toContain('state=open');
    expect(fog?.getAttribute('href')).toContain('spec=002');
    expect(h?.querySelector('[data-library-head="goal"] strong')?.textContent).toBe('workspace');
    const approach = h?.querySelector<HTMLDetailsElement>('details[data-library-head="approach"]');
    expect(approach?.open).toBe(false);
    expect(text(approach?.querySelector('.lib-ghead-approach-body'))).toBe('Read the catalog once.');
    // A done spec: no fog count, no Goal, no Approach, no type; the stage chip in its done tone, the meter full.
    const done = head(root, '003');
    expect(
      done?.querySelector('[data-library-head="fog"], [data-library-head="goal"], [data-library-head="approach"], [data-library-head="type"]'),
    ).toBeNull();
    expect(done?.querySelector('[data-library-head="stage"]')?.getAttribute('data-tone')).toBe('success');
    expect(done?.querySelector('ui-meter')?.hasAttribute('data-full')).toBe(true);
  });

  it('lists every fog line under its spec under the filter "open", hides the type pills, and opens the spec.md', async () => {
    const root = await open('/w/harbor/library?state=open', HEADS);
    expect(entries(root)).toEqual([]);
    expect(page(root).querySelector('[data-library-types]')).toBeNull();
    expect(Array.from(page(root).querySelectorAll('[data-library-fog-group]')).map((g) => g.getAttribute('data-library-fog-group'))).toEqual(['002', '004']);
    const lines = Array.from(page(root).querySelectorAll('[data-library-fog-line]'));
    expect(lines.map((line) => [line.getAttribute('data-library-fog-line'), text(line.querySelector('.lib-fog-text'))])).toEqual([
      ['002', 'Which reader width?'],
      ['002', 'Does `quota` apply?'],
      ['004', 'How long?'],
    ]);
    expect(text(page(root).querySelector('[data-library-count]'))).toBe('3 open points in 2 specs');
    (lines[0] as HTMLButtonElement).click();
    await settle();
    expect(address().fragment).toBe('002-web-console/spec.md');
  });

  it('narrows the fog lines by spec', async () => {
    const root = await open('/w/harbor/library?state=open&spec=004', HEADS);
    expect(page(root).querySelectorAll('[data-library-fog-line]')).toHaveLength(1);
  });

  it('says "Nothing open" when no open spec carries a fog line', async () => {
    const none = await open('/w/harbor/library?state=open', CONTROL);
    expect(text(page(none).querySelector('[data-library-fog-none] .title'))).toBe('Nothing open');
  });

  it('stands an absent tech.md dimmed in the workspace group, uncounted, its reader the empty state without a command', async () => {
    const root = await open('/w/harbor/library', CONTROL);
    const row = page(root).querySelector('[data-library-group="workspace"] [data-library-placeholder="tech.md"]');
    expect(row).not.toBeNull();
    expect(row?.hasAttribute('data-library-entry')).toBe(false);
    expect(row?.hasAttribute('data-state')).toBe(false);
    expect(row?.querySelector('[data-library-chip]')).toBeNull();
    expect(text(row?.querySelector('[data-library-meta]'))).toBe('specs/tech.md · not created yet');
    expect(text(page(root).querySelector('[data-library-count]'))).toContain('6 of 6 documents');
    expect(control(root, 'missing').querySelector('[data-library-control-count]')?.textContent).toBe('2');
    // After the constitution, where tech.md would stand.
    const workspace = Array.from(page(root).querySelectorAll('[data-library-group="workspace"] .lib-row')).map(
      (el) => el.getAttribute('data-library-entry') ?? el.getAttribute('data-library-placeholder'),
    );
    expect(workspace).toEqual(['constitution.md', 'tech.md']);
    (row as HTMLButtonElement).click();
    await settle();
    const empty = page(root).querySelector('[data-library-reader] [data-library-tech-empty]');
    expect(text(empty?.querySelector('.title'))).toBe('No tech documentation yet');
    expect(empty?.querySelector('ui-command-chip')).toBeNull();
  });

  it('hides the tech placeholder under a filter a tech document would not pass', async () => {
    const stale = await open('/w/harbor/library?state=stale', CONTROL);
    expect(page(stale).querySelector('[data-library-placeholder]')).toBeNull();
  });

  it('draws no tech placeholder when tech.md is in the catalog', async () => {
    const present = await open('/w/harbor/library', HEADS);
    expect(page(present).querySelector('[data-library-placeholder]')).toBeNull();
  });
});

// T46 · ISC-158: the same component as the spec area Library at `/w/:ws/s/:id/library`, narrowed to that spec: its
// documents with the missing entries and the evidence, plus the constitution; its group first and headless; no spec
// select and no page head of its own; control counts of the spec alone; no "Open in spec" in the reader.
const SCOPED: LibraryCatalog = {
  ...HEADS,
  docs: [...CONTROL.docs, doc('002-web-console/.evidence/run-001/probe.md', 'evidence', 'Probe run 1'), doc('tech.md', 'tech', 'Harbor tech')],
  missing: 2,
  stale: 2,
};

describe('LibraryPage in the spec area (T46, ISC-158)', () => {
  it('lists the spec’s documents and missing entries first, then the constitution; no other spec and no tech', async () => {
    const root = await open('/w/harbor/s/002/library', SCOPED);
    const host = page(root);
    expect(host.getAttribute('data-scope')).toBe('spec');
    expect(Array.from(host.querySelectorAll('[data-library-group]')).map((group) => group.getAttribute('data-library-group'))).toEqual(['002', 'workspace']);
    expect(entries(root)).toEqual(['002-web-console/spec.md', '002-web-console/plan.md', '002-web-console/tasks.md', 'constitution.md']);
    expect(host.querySelector('[data-library-evidence="002"] [data-library-evidence-count]')?.textContent).toBe('1');
    expect(host.querySelector('[data-library-placeholder]')).toBeNull();
    // The spec head above carries stage, goal and figures: the spec's own group keeps only its eyebrow.
    expect(head(root, '002')).toBeNull();
    expect(host.querySelector('[data-library-group="002"] .lib-group-head')).not.toBeNull();
  });

  it('has no spec select and no page head, counts only the spec and keeps the state select', async () => {
    const root = await open('/w/harbor/s/002/library?spec=003', SCOPED);
    const host = page(root);
    expect(host.querySelector('[data-library-spec]')).toBeNull();
    expect(host.querySelector('[data-library-state-select]')).not.toBeNull();
    expect(host.querySelector('ui-page-head, .lib-page-head')).toBeNull();
    // `?spec=` names no other spec here: the list stays the spec's.
    expect(entries(root)).toContain('002-web-console/spec.md');
    expect(control(root, 'missing').querySelector('[data-library-control-count]')?.textContent).toBe('1');
    expect(control(root, 'stale').querySelector('[data-library-control-count]')?.textContent).toBe('1');
    expect(text(host.querySelector('[data-library-count]'))).toContain('5 of 5 documents');
  });

  it('opens a document in the reader without "Open in spec" (data-context spec)', async () => {
    const root = await open('/w/harbor/s/002/library#002-web-console/plan.md', SCOPED);
    const reader = page(root).querySelector('app-library-reader');
    expect(reader?.getAttribute('data-context')).toBe('spec');
    expect(page(root).querySelector('[data-library-open]')).toBeNull();
  });

  it('shows the fog lines of the spec alone under the filter "open"', async () => {
    const root = await open('/w/harbor/s/002/library?state=open', SCOPED);
    const groups = Array.from(page(root).querySelectorAll('[data-library-fog-group]')).map((group) => group.getAttribute('data-library-fog-group'));
    expect(groups).toEqual(['002']);
  });
});

// Code review 017, #5: the spec area Library resolves the route's spec ref the way the server's `resolveSpec` does
// (core's `specRefMatches`): number, folder and bare slug list the same documents, and the `?doc=` swap follows.
describe('LibraryPage in the spec area, by every spec ref form', () => {
  it('lists the same documents for the number, the folder and the slug', async () => {
    const byNumber = entries(await open('/w/harbor/s/002/library', SCOPED));
    expect(byNumber).toEqual(['002-web-console/spec.md', '002-web-console/plan.md', '002-web-console/tasks.md', 'constitution.md']);
    for (const ref of ['002-web-console', 'web-console']) {
      TestBed.resetTestingModule();
      const root = await open(`/w/harbor/s/${ref}/library`, SCOPED);
      expect(entries(root)).toEqual(byNumber);
      expect(control(root, 'missing').querySelector('[data-library-control-count]')?.textContent).toBe('1');
    }
  });

  it('swaps `?doc=plan` for the plan’s path under the slug form', async () => {
    await open('/w/harbor/s/web-console/library?doc=plan', SCOPED);
    await settle();
    const path = TestBed.inject(Location).path(true);
    expect(path).not.toContain('doc=');
    expect(path).toContain('#002-web-console/plan.md');
  });
});

// Code review 017, #2: the library rides the live refresh (timer, "Refresh now", `r`) like the tech page it replaced:
// the catalog is re-read (ETag, so a 304 costs no body) and the open document with it, each keeping its last value
// while it reloads, so the list and the reader stay in place and only what changed changes.
describe('LibraryPage on the live refresh', () => {
  it('re-reads the catalog and the open document on a refresh, counts updating in place', async () => {
    let current = CONTROL;
    const root = await open('/w/harbor/library#002-web-console/plan.md', () => current, 'wide');
    await settle();
    expect(libraryReads).toBe(1);
    expect(docReads).toBe(1);
    const reader = page(root).querySelector('[data-library-reader]');
    expect(text(reader?.querySelector('[data-library-prose]'))).toBe('Rendered');
    current = { ...CONTROL, docs: [...CONTROL.docs, doc('004-audit/spec.md', 'spec', 'Audit', { state: 'stale' })], stale: 3 };
    TestBed.inject(RefreshService).refresh();
    harness.fixture.detectChanges();
    // While both reload, the reader keeps its document: no loading state, no flicker.
    expect(page(root).querySelector('[data-library-reader]')).toBe(reader);
    expect(text(reader?.querySelector('[data-library-prose]'))).toBe('Rendered');
    await settle();
    expect(libraryReads).toBe(2);
    expect(docReads).toBe(2);
    expect(entries(root)).toContain('004-audit/spec.md');
    expect(control(root, 'stale').querySelector('[data-library-control-count]')?.textContent).toBe('3');
    expect(page(root).querySelector('[data-library-reader]')).toBe(reader);
  });
});
