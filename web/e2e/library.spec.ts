/**
 * Spec 017 · the workspace library `/w/:ws/library` against the stub API, on harbor. `bun run e2e -- library -g <group>`.
 *
 * Group `list` (T29, ISC-156): the page lists the catalog the read route `GET /api/workspaces/:ws/library` answers,
 * every document exactly once with its type tag (icon), title, spec and meta line, in the workspace-wide group first and
 * then one group per spec in ascending number; no demo element anywhere. A spec's evidence documents stand in one
 * collapsed subgroup with their count that reveals blocks of 50; the type filter `evidence` and a search open it. A
 * workspace without one document (`X-Spectant-Stub-Library: empty`) shows the empty state.
 *
 * Every expected value comes from the route's answer (the stub's `STUB_LIBRARY` on harbor: 57 evidence documents in
 * 002, a stale plan, a missing tasks.md, a prototype) and `src/i18n/en.json`, never a literal count.
 *
 * Page hooks: `[data-library-group]` = the group key (`workspace` or the spec number), `[data-library-entry]` = the
 * document's path with `data-spec` and `data-state`, `[data-library-meta]`, `[data-library-evidence]` = the group key
 * with `[data-library-evidence-toggle]` (`aria-expanded`), `[data-library-evidence-count]` and
 * `[data-library-evidence-more]`, `[data-library-none]` (the empty state), `[data-library-error]`.
 *
 * Group `control` (T31, ISC-156.1): the card's first row `[data-library-controls]` shows the catalog's `missing` and
 * `stale` counts as `[data-library-control="missing"|"stale"]` (`aria-pressed`, `aria-disabled` at zero) with their
 * `[data-library-control-count]`; each such row carries its chip `[data-library-chip="missing"|"stale"]`, an `ok` row
 * none. A click filters the list to exactly those documents (`?state=`), a second click lifts it, a reload keeps it; a
 * zero count (a catalog without stale documents, intercepted in the test) filters nothing. A missing row opens the
 * reader's empty state `[data-library-missing]`.
 *
 * Group `search` (T33, ISC-156.2): the search `[data-library-search]` matches titles and paths and, through
 * `GET …/library/search?q=`, the full text; a row the server found shows its snippet `[data-library-snippet]`. The type
 * pills `[data-library-types]`, the spec select `[data-library-spec]` and the state select `[data-library-state-select]`
 * narrow the list, alone and combined. Search text, filters and the picked document stand in the address (`?q=`,
 * `?type=`, `?spec=`, `?state=`, `#path`); a reload and a step back from another page restore the same input, filters,
 * rows and selection. The full-text word is one the stub's search finds while no title or path of the catalog holds it;
 * the test checks both against the routes before it relies on them.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import type { LibraryCatalog, LibraryDoc } from '../../core/src/files';
import { type LibrarySearchResult, workspaceRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LIBRARY_HEADER } from './stub-api';

/** The two control counts of the card's first row, in their order (design.md 017 § Viewport-übergreifend). */
const CONTROL_KEYS = ['missing', 'stale'] as const;
type ControlKey = (typeof CONTROL_KEYS)[number];

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const EN = read('../src/i18n/en.json') as {
  library: {
    meta: { image: string; prototype: string };
    outdated: string;
    missing: string;
    control: Record<ControlKey, { word: string; one: string; other: string; none: string }>;
    reader: { missingHeading: string };
    types: Record<string, string>;
    filters: { all: string };
  };
};

const WS = 'harbor';
const ROUTE = `/api/workspaces/${WS}/library`;
const PAGE = `/w/${WS}/library`;
/** The evidence subgroup reveals this many documents per block (plan 017 § Risks, design.md). */
const BLOCK = 50;

const ENTRY = '[data-library-entry]';
const DEMO = '[data-demo], [data-demo-chip]';

const template = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/gu, (_, key: string) => String(values[key]));
const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** The group key of a document: the spec folder's number, `workspace` as it is. */
const keyOf = (spec: string): string => /^(\d+)-/u.exec(spec)?.[1] ?? spec;

/** One row as the page draws it. */
interface Row {
  readonly path: string | null;
  readonly spec: string | null;
  readonly state: string | null;
  readonly group: string | null;
  readonly evidence: boolean;
  readonly type: string | null;
  readonly icon: boolean;
  readonly title: string;
  readonly meta: string | null;
}

/** The row a catalog document should be drawn as. */
function expectedRow(doc: LibraryDoc): Row {
  const file = `specs/${doc.path}`;
  const meta =
    doc.media === 'prototype'
      ? template(EN.library.meta.prototype, { count: doc.pages?.length ?? 0, pages: (doc.pages ?? []).join(', ') })
      : doc.media === 'image'
        ? template(EN.library.meta.image, { path: file })
        : file;
  return {
    path: doc.path,
    spec: doc.spec,
    state: doc.state,
    group: keyOf(doc.spec),
    evidence: doc.type === 'evidence',
    type: doc.type,
    icon: true,
    title: squash(doc.title),
    meta: squash(meta),
  };
}

const byPath = (a: Row, b: Row): number => ((a.path ?? '') < (b.path ?? '') ? -1 : (a.path ?? '') > (b.path ?? '') ? 1 : 0);

/** Every row the list draws, in document order. */
async function rows(page: Page): Promise<Row[]> {
  return page.locator(ENTRY).evaluateAll((elements) =>
    elements.map((el) => {
      const text = (node: Element | null | undefined): string | null => (node ? node.textContent.replace(/\s+/gu, ' ').trim() : null);
      return {
        path: el.getAttribute('data-library-entry'),
        spec: el.getAttribute('data-spec'),
        state: el.getAttribute('data-state'),
        group: el.closest('[data-library-group]')?.getAttribute('data-library-group') ?? null,
        evidence: el.closest('[data-library-evidence]') !== null,
        type: el.querySelector('.lib-type')?.getAttribute('data-type') ?? null,
        icon: el.querySelector('.lib-type svg') !== null,
        title: text(el.querySelector('.lib-title')) ?? '',
        meta: text(el.querySelector('[data-library-meta]')),
      };
    }),
  );
}

async function catalogOf(request: APIRequestContext): Promise<LibraryCatalog> {
  const answer = await request.get(ROUTE);
  expect(answer.status()).toBe(200);
  return (await answer.json()) as LibraryCatalog;
}

/** The evidence documents of each spec, by group key, in catalog order. */
function evidenceGroups(catalog: LibraryCatalog): Map<string, LibraryDoc[]> {
  const groups = new Map<string, LibraryDoc[]>();
  for (const doc of catalog.docs.filter((d) => d.type === 'evidence')) {
    const key = keyOf(doc.spec);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }
  return groups;
}

/** The spec with the most evidence: the subgroup that loads in more than one block. */
function biggestEvidence(catalog: LibraryCatalog): { key: string; docs: LibraryDoc[] } {
  const [key, docs] = [...evidenceGroups(catalog)].sort((a, b) => b[1].length - a[1].length)[0] ?? ['', []];
  return { key, docs };
}

const subgroup = (page: Page, key: string): Locator => page.locator(`[data-library-evidence="${key}"]`);
const toggleOf = (page: Page, key: string): Locator => subgroup(page, key).locator('[data-library-evidence-toggle]');

test.describe('list', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('every catalog document from the read route, evidence collapsed and loaded in blocks, no demo element', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const evidence = evidenceGroups(catalog);
    const biggest = biggestEvidence(catalog);
    // The fixture must exercise the block loading, or the block assertions below prove nothing.
    expect(biggest.docs.length).toBeGreaterThan(BLOCK);
    const listed = catalog.docs.filter((doc) => doc.type !== 'evidence');
    expect(listed.length).toBeGreaterThan(0);

    const answered = page.waitForResponse((r) => new URL(r.url()).pathname === ROUTE && r.request().method() === 'GET');
    await page.goto(PAGE);
    expect((await answered).status()).toBe(200);

    // Collapsed: the rows are exactly the catalog without its evidence, each once, each with tag, icon, title, meta.
    await expect(page.locator(ENTRY)).toHaveCount(listed.length);
    const shown = await rows(page);
    expect(new Set(shown.map((row) => row.path)).size).toBe(shown.length);
    expect([...shown].sort(byPath)).toEqual(listed.map(expectedRow).sort(byPath));

    // Workspace-wide first, then each spec exactly once, ascending.
    const specs = [...new Set(catalog.docs.map((doc) => doc.spec))];
    const expectedGroups = [
      ...(specs.includes('workspace') ? ['workspace'] : []),
      ...specs.filter((spec) => spec !== 'workspace').sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map(keyOf),
    ];
    expect(await page.locator('[data-library-group]').evaluateAll((els) => els.map((el) => el.getAttribute('data-library-group')))).toEqual(
      expectedGroups,
    );

    // No demo chip, no demo block, no error.
    await expect(page.locator(DEMO)).toHaveCount(0);
    await expect(page.locator('[data-library-error]')).toHaveCount(0);
    await expect(page.locator('[data-library-none]')).toHaveCount(0);

    // One collapsed evidence subgroup per spec with evidence, carrying its count.
    await expect(page.locator('[data-library-evidence]')).toHaveCount(evidence.size);
    for (const [key, docs] of evidence) {
      await expect(toggleOf(page, key)).toHaveAttribute('aria-expanded', 'false');
      await expect(subgroup(page, key).locator('[data-library-evidence-count]')).toHaveText(String(docs.length));
      await expect(subgroup(page, key).locator(ENTRY)).toHaveCount(0);
    }

    // Opened, each subgroup reveals 50, then 50 more per "Show more", until every document stands.
    for (const [key, docs] of evidence) {
      await toggleOf(page, key).click();
      await expect(toggleOf(page, key)).toHaveAttribute('aria-expanded', 'true');
      let revealed = Math.min(docs.length, BLOCK);
      await expect(subgroup(page, key).locator(ENTRY)).toHaveCount(revealed);
      while (revealed < docs.length) {
        await subgroup(page, key).locator('[data-library-evidence-more]').click();
        revealed = Math.min(docs.length, revealed + BLOCK);
        await expect(subgroup(page, key).locator(ENTRY)).toHaveCount(revealed);
      }
      await expect(subgroup(page, key).locator('[data-library-evidence-more]')).toHaveCount(0);
    }

    // Now the list holds the whole catalog, each document exactly once, evidence inside its subgroup.
    await expect(page.locator(ENTRY)).toHaveCount(catalog.docs.length);
    const all = await rows(page);
    expect(new Set(all.map((row) => row.path)).size).toBe(all.length);
    expect([...all].sort(byPath)).toEqual(catalog.docs.map(expectedRow).sort(byPath));
    await expect(page.locator(DEMO)).toHaveCount(0);
  });

  test('the type filter evidence opens the subgroup', async ({ page, request }) => {
    const { key, docs } = biggestEvidence(await catalogOf(request));
    await page.goto(`${PAGE}?type=evidence`);
    await expect(toggleOf(page, key)).toHaveAttribute('aria-expanded', 'true');
    await expect(subgroup(page, key).locator(ENTRY)).toHaveCount(Math.min(docs.length, BLOCK));
    expect(new Set((await rows(page)).map((row) => row.type))).toEqual(new Set(['evidence']));
    await expect(page.locator(DEMO)).toHaveCount(0);
  });

  test('a search opens the subgroup', async ({ page, request }) => {
    const { key, docs } = biggestEvidence(await catalogOf(request));
    const target = docs.at(-1);
    if (target === undefined) throw new Error('library.spec: no evidence document in the catalog');
    await page.goto(`${PAGE}?q=${encodeURIComponent(target.title)}`);
    await expect(toggleOf(page, key)).toHaveAttribute('aria-expanded', 'true');
    await expect(subgroup(page, key).locator(`[data-library-entry="${target.path}"]`)).toBeVisible();
  });

  test.describe('empty', () => {
    test.use({ extraHTTPHeaders: { [LIBRARY_HEADER]: 'empty' } });

    test('a workspace without documents shows the empty state', async ({ page, request }) => {
      const catalog = await catalogOf(request);
      expect(catalog.docs).toEqual([]);
      await page.goto(PAGE);
      await expect(page.locator('[data-library-none]')).toBeVisible();
      await expect(page.locator('[data-library-none]')).toContainText('/spec-bootstrap');
      await expect(page.locator(ENTRY)).toHaveCount(0);
      await expect(page.locator('[data-library-list]')).toHaveCount(0);
      await expect(page.locator('[data-library-error]')).toHaveCount(0);
      await expect(page.locator(DEMO)).toHaveCount(0);
    });
  });
});

const control = (page: Page, key: ControlKey): Locator => page.locator(`[data-library-controls] [data-library-control="${key}"]`);
const stateParam = (page: Page): string | null => new URL(page.url()).searchParams.get('state');

/** The paths of the rows that carry a chip of this state, in document order. */
async function chipped(page: Page, key: ControlKey): Promise<string[]> {
  return page.locator(`${ENTRY}:has([data-library-chip="${key}"])`).evaluateAll((els) => els.map((el) => el.getAttribute('data-library-entry') ?? ''));
}

const pathsOf = (docs: readonly LibraryDoc[]): string[] => docs.map((doc) => doc.path).sort();
const shownPaths = async (page: Page): Promise<string[]> => (await rows(page)).map((row) => row.path ?? '').sort();

/** What the control's accessible name says for this count (`none` at zero, else `one` / `other`). */
function controlName(key: ControlKey, count: number): string {
  const names = EN.library.control[key];
  return template(count === 0 ? names.none : count === 1 ? names.one : names.other, { count });
}

test.describe('control', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('the counts equal the catalog, every missing and stale row carries its chip, an ok row none', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const listed = catalog.docs.filter((doc) => doc.type !== 'evidence');
    // Both cases must stand outside the collapsed evidence, or the chip assertions below prove nothing.
    expect(catalog.docs.filter((doc) => doc.type === 'evidence' && doc.state !== 'ok')).toEqual([]);

    await page.goto(PAGE);
    await expect(page.locator(ENTRY)).toHaveCount(listed.length);
    const controls = page.locator('[data-library-controls] [data-library-control]');
    await expect(controls).toHaveCount(CONTROL_KEYS.length);
    expect(await controls.evaluateAll((els) => els.map((el) => el.getAttribute('data-library-control')))).toEqual([...CONTROL_KEYS]);

    for (const key of CONTROL_KEYS) {
      const docs = catalog.docs.filter((doc) => doc.state === key);
      expect(docs.length).toBeGreaterThan(0);
      expect(catalog[key]).toBe(docs.length);
      await expect(control(page, key).locator('[data-library-control-count]')).toHaveText(String(catalog[key]));
      await expect(control(page, key)).toHaveAttribute('aria-pressed', 'false');
      await expect(control(page, key)).not.toHaveAttribute('aria-disabled', 'true');
      await expect(control(page, key)).toHaveAttribute('aria-label', controlName(key, catalog[key]));
      expect((await chipped(page, key)).sort()).toEqual(pathsOf(docs));
      for (const doc of docs) {
        const row = page.locator(`[data-library-entry="${doc.path}"]`);
        await expect(row).toHaveAttribute('data-state', key);
        await expect(row.locator(`[data-library-chip="${key}"]`)).toHaveText(key === 'stale' ? EN.library.outdated : EN.library.missing);
      }
    }
    // An ok row carries no chip at all.
    expect(listed.filter((doc) => doc.state === 'ok').length).toBeGreaterThan(0);
    await expect(page.locator(`${ENTRY}[data-state="ok"] [data-library-chip]`)).toHaveCount(0);
    await expect(page.locator(`${ENTRY} [data-library-chip]`)).toHaveCount(catalog.missing + catalog.stale);
  });

  for (const key of CONTROL_KEYS) {
    test(`a click on ${key} filters to exactly those documents, a second lifts it`, async ({ page, request }) => {
      const catalog = await catalogOf(request);
      const listed = catalog.docs.filter((doc) => doc.type !== 'evidence');
      const docs = catalog.docs.filter((doc) => doc.state === key);
      const other = CONTROL_KEYS.find((k) => k !== key) ?? key;
      expect(docs.length).toBeGreaterThan(0);

      await page.goto(PAGE);
      await expect(page.locator(ENTRY)).toHaveCount(listed.length);

      await control(page, key).click();
      await expect(control(page, key)).toHaveAttribute('aria-pressed', 'true');
      await expect(control(page, other)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator(ENTRY)).toHaveCount(docs.length);
      expect(await shownPaths(page)).toEqual(pathsOf(docs));
      await expect.poll(() => stateParam(page)).toBe(key);
      // The counts stay the catalog's while filtering.
      await expect(control(page, key).locator('[data-library-control-count]')).toHaveText(String(catalog[key]));
      await expect(control(page, other).locator('[data-library-control-count]')).toHaveText(String(catalog[other]));

      await control(page, key).click();
      await expect(control(page, key)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator(ENTRY)).toHaveCount(listed.length);
      expect(await shownPaths(page)).toEqual(pathsOf(listed));
      await expect.poll(() => stateParam(page)).toBeNull();
    });
  }

  test('a reload with ?state=stale keeps the filter pressed', async ({ page, request }) => {
    const stale = (await catalogOf(request)).docs.filter((doc) => doc.state === 'stale');
    await page.goto(`${PAGE}?state=stale`);
    await expect(control(page, 'stale')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(ENTRY)).toHaveCount(stale.length);
    await page.reload();
    await expect(control(page, 'stale')).toHaveAttribute('aria-pressed', 'true');
    await expect(control(page, 'missing')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(ENTRY)).toHaveCount(stale.length);
    expect(await shownPaths(page)).toEqual(pathsOf(stale));
    expect(stateParam(page)).toBe('stale');
  });

  test('a zero count is disabled and filters nothing', async ({ page, request }) => {
    // The same catalog with every stale document read as ok: the count the route answers is then zero.
    const catalog = await catalogOf(request);
    const fresh: LibraryCatalog = { ...catalog, docs: catalog.docs.map((doc) => (doc.state === 'stale' ? { ...doc, state: 'ok' } : doc)), stale: 0 };
    const listed = fresh.docs.filter((doc) => doc.type !== 'evidence');
    await page.route(
      (url) => url.pathname === ROUTE,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fresh) }),
    );

    await page.goto(PAGE);
    await expect(page.locator(ENTRY)).toHaveCount(listed.length);
    await expect(control(page, 'stale').locator('[data-library-control-count]')).toHaveText('0');
    await expect(control(page, 'stale')).toHaveAttribute('aria-disabled', 'true');
    await expect(control(page, 'stale')).toHaveAttribute('aria-pressed', 'false');
    await expect(control(page, 'stale')).toHaveAttribute('aria-label', controlName('stale', 0));
    await expect(page.locator(`${ENTRY} [data-library-chip="stale"]`)).toHaveCount(0);
    await expect(control(page, 'missing')).not.toHaveAttribute('aria-disabled', 'true');

    // Forced: Playwright refuses to click an aria-disabled button, a pointer does not.
    await control(page, 'stale').click({ force: true });
    await expect(control(page, 'stale')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(ENTRY)).toHaveCount(listed.length);
    expect(await shownPaths(page)).toEqual(pathsOf(listed));
    expect(stateParam(page)).toBeNull();
  });

  test('a missing row opens the reader empty state', async ({ page, request }) => {
    const missing = (await catalogOf(request)).docs.find((doc) => doc.state === 'missing');
    if (missing === undefined) throw new Error('library.spec: no missing document in the catalog');
    const file = missing.path.slice(missing.path.lastIndexOf('/') + 1);

    await page.goto(`${PAGE}?state=missing`);
    await page.locator(`[data-library-entry="${missing.path}"]`).click();
    const empty = page.locator('[data-library-reader] [data-library-missing]');
    await expect(empty).toBeVisible();
    await expect(empty.locator('.title')).toHaveText(template(EN.library.reader.missingHeading, { file }));
    await expect(page.locator('[data-library-reader] [data-library-prose]')).toHaveCount(0);
    // Core marks only plan.md and tasks.md missing (ISC-155.2), and each has the command that writes it.
    expect(['plan', 'tasks']).toContain(missing.type);
    await expect(empty.locator('ui-command-chip')).toContainText(`/spec-${missing.type} ${keyOf(missing.spec)}`);
  });
});

// ---- search (T33, ISC-156.2) --------------------------------------------------------------------------------------

/** A word of one document's full text that no title or path of harbor's catalog holds (the test checks both). */
const FULL_TEXT_WORD = 'quota';
/** A word the full text of several documents across specs holds, to narrow further with every filter. */
const SHARED_WORD = 'manifest';

const SEARCH = 'input[data-library-search]';
const SPEC_SELECT = 'select[data-library-spec]';
const STATE_SELECT = 'select[data-library-state-select]';
const READER_TITLE = '[data-library-reader] .lib-reader-title';

/** The list's filter as a test names it; an absent key is that filter's default. */
interface Wanted {
  readonly q?: string;
  readonly type?: string;
  readonly spec?: string;
  readonly state?: ControlKey;
}

async function searchOf(request: APIRequestContext, q: string): Promise<LibrarySearchResult> {
  const answer = await request.get(workspaceRoutes.librarySearch(WS, q));
  expect(answer.status()).toBe(200);
  return (await answer.json()) as LibrarySearchResult;
}

/**
 * The paths the list shows under `want`, sorted: every filter holds, and a search matches the title or path or is a hit
 * of the server's full-text search. Without a search a spec's evidence stays collapsed; with one it opens.
 */
function wantedPaths(catalog: LibraryCatalog, want: Wanted, result: LibrarySearchResult | null = null): string[] {
  const q = (want.q ?? '').trim().toLowerCase();
  const hits = new Set((result?.hits ?? []).map((hit) => hit.path));
  return catalog.docs
    .filter(
      (doc) =>
        (want.type === undefined || doc.type === want.type) &&
        (want.spec === undefined || keyOf(doc.spec) === want.spec) &&
        (want.state === undefined || doc.state === want.state) &&
        (q === '' ? doc.type !== 'evidence' : hits.has(doc.path) || `${doc.title} ${doc.path}`.toLowerCase().includes(q)),
    )
    .map((doc) => doc.path)
    .sort();
}

type Address = Record<'path' | 'q' | 'type' | 'spec' | 'state' | 'doc', string | null>;

/** The list's part of the address: path, the four params and the document of the fragment. */
function address(page: Page): Address {
  const url = new URL(page.url());
  const param = (name: string): string | null => url.searchParams.get(name);
  return {
    path: url.pathname,
    q: param('q'),
    type: param('type'),
    spec: param('spec'),
    state: param('state'),
    doc: url.hash === '' ? null : decodeURIComponent(url.hash.slice(1)),
  };
}

/** The address `want` and `doc` should write, path included. */
const addressOf = (want: Wanted, doc: string | null = null): Address => ({
  path: PAGE,
  q: want.q ?? null,
  type: want.type ?? null,
  spec: want.spec ?? null,
  state: want.state ?? null,
  doc,
});

const pill = (page: Page, type: string): Locator =>
  page.locator('[data-library-types]').getByRole('button', { name: type === 'all' ? EN.library.filters.all : EN.library.types[type], exact: true });

/** Resolves with the page's own search request for exactly `q`. */
const searched = (page: Page, q: string): ReturnType<Page['waitForResponse']> =>
  page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === `${ROUTE}/search` && url.searchParams.get('q') === q && r.request().method() === 'GET';
  });

/** The controls show `want`: the search text, the pressed pill, both selects. */
async function expectControls(page: Page, want: Wanted): Promise<void> {
  await expect(page.locator(SEARCH)).toHaveValue(want.q ?? '');
  await expect(pill(page, want.type ?? 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(SPEC_SELECT)).toHaveValue(want.spec ?? 'all');
  await expect(page.locator(STATE_SELECT)).toHaveValue(want.state ?? 'all');
}

test.describe('search', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('a word only in the full text finds its document with the snippet and writes ?q=', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const result = await searchOf(request, FULL_TEXT_WORD);
    expect(result.query).toBe(FULL_TEXT_WORD);
    expect(result.hits.length).toBeGreaterThan(0);
    // No title or path holds the word, so only the server's full-text search can find these rows.
    expect(catalog.docs.filter((doc) => `${doc.title} ${doc.path}`.toLowerCase().includes(FULL_TEXT_WORD))).toEqual([]);
    const want = wantedPaths(catalog, { q: FULL_TEXT_WORD }, result);
    expect(want).toEqual(result.hits.map((hit) => hit.path).sort());

    await page.goto(PAGE);
    await expect(page.locator(ENTRY)).toHaveCount(wantedPaths(catalog, {}).length);
    const answered = searched(page, FULL_TEXT_WORD);
    await page.locator(SEARCH).fill(FULL_TEXT_WORD);
    expect((await answered).status()).toBe(200);

    await expect.poll(() => shownPaths(page)).toEqual(want);
    for (const hit of result.hits) {
      const snippet = page.locator(`[data-library-entry="${hit.path}"] [data-library-snippet]`);
      await expect(snippet).toHaveText(squash(hit.snippet));
      await expect(snippet.locator('mark').first()).toHaveText(new RegExp(`^${FULL_TEXT_WORD}$`, 'iu'));
    }
    await expect.poll(() => address(page)).toEqual(addressOf({ q: FULL_TEXT_WORD }));
  });

  test('the type pill narrows the rows and writes ?type=', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const type = catalog.docs.find((doc) => doc.state === 'stale')?.type ?? '';
    const want = wantedPaths(catalog, { type });
    expect(want.length).toBeGreaterThan(0);
    expect(want.length).toBeLessThan(wantedPaths(catalog, {}).length);

    await page.goto(PAGE);
    await pill(page, type).click();
    await expect(pill(page, type)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => shownPaths(page)).toEqual(want);
    expect(new Set((await rows(page)).map((row) => row.type))).toEqual(new Set([type]));
    await expect.poll(() => address(page)).toEqual(addressOf({ type }));

    await pill(page, 'all').click();
    await expect.poll(() => shownPaths(page)).toEqual(wantedPaths(catalog, {}));
    await expect.poll(() => address(page)).toEqual(addressOf({}));
  });

  test('the spec select narrows the rows to one group and writes ?spec=', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const spec = keyOf(catalog.docs.find((doc) => doc.state === 'stale')?.spec ?? '');
    const want = wantedPaths(catalog, { spec });
    expect(want.length).toBeGreaterThan(0);

    await page.goto(PAGE);
    await page.locator(SPEC_SELECT).selectOption(spec);
    await expect.poll(() => shownPaths(page)).toEqual(want);
    expect(await page.locator('[data-library-group]').evaluateAll((els) => els.map((el) => el.getAttribute('data-library-group')))).toEqual([spec]);
    await expect.poll(() => address(page)).toEqual(addressOf({ spec }));
  });

  test('the state select narrows to the outdated and the missing documents and writes ?state=', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    await page.goto(PAGE);
    for (const state of CONTROL_KEYS) {
      const want = wantedPaths(catalog, { state });
      expect(want).toEqual(pathsOf(catalog.docs.filter((doc) => doc.state === state)));
      expect(want.length).toBeGreaterThan(0);
      await page.locator(STATE_SELECT).selectOption(state);
      await expect.poll(() => shownPaths(page)).toEqual(want);
      await expect(control(page, state)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => address(page)).toEqual(addressOf({ state }));
    }
    await page.locator(STATE_SELECT).selectOption('all');
    await expect.poll(() => shownPaths(page)).toEqual(wantedPaths(catalog, {}));
    await expect.poll(() => address(page)).toEqual(addressOf({}));
  });

  test('search, type, spec and state combine, each step narrowing the rows', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const result = await searchOf(request, SHARED_WORD);
    const stale = catalog.docs.find((doc) => doc.state === 'stale');
    if (stale === undefined) throw new Error('library.spec: no stale document in the catalog');
    const spec = keyOf(stale.spec);
    const steps: ReadonlyArray<{ want: Wanted; act: () => Promise<unknown> }> = [
      { want: { q: SHARED_WORD }, act: () => page.locator(SEARCH).fill(SHARED_WORD) },
      { want: { q: SHARED_WORD, type: stale.type }, act: () => pill(page, stale.type).click() },
      { want: { q: SHARED_WORD, type: stale.type, spec }, act: () => page.locator(SPEC_SELECT).selectOption(spec) },
      { want: { q: SHARED_WORD, type: stale.type, spec, state: 'stale' }, act: () => page.locator(STATE_SELECT).selectOption('stale') },
    ];
    const wanted = steps.map((step) => wantedPaths(catalog, step.want, result));
    const evidence = (paths: readonly string[]): number => paths.filter((path) => catalog.docs.find((doc) => doc.path === path)?.type === 'evidence').length;
    // Every revealed evidence row fits the first block, the last step keeps a row, and each step really narrows.
    expect(evidence(wanted[0] ?? [])).toBeLessThanOrEqual(BLOCK);
    expect(wanted.at(-1)?.length).toBeGreaterThan(0);
    expect(wanted.at(-1)?.length).toBeLessThan(wanted[0]?.length ?? 0);

    await page.goto(PAGE);
    await expect(page.locator(ENTRY)).toHaveCount(wantedPaths(catalog, {}).length);
    for (const [at, step] of steps.entries()) {
      await step.act();
      await expect.poll(() => shownPaths(page)).toEqual(wanted[at]);
      expect((wanted[at] ?? []).every((path) => at === 0 || (wanted[at - 1] ?? []).includes(path))).toBe(true);
      await expect.poll(() => address(page)).toEqual(addressOf(step.want));
    }
    await expectControls(page, steps.at(-1)?.want ?? {});
  });

  test('picking a document writes #path; a reload restores the input, the filters, the rows and the selection', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const result = await searchOf(request, SHARED_WORD);
    const spec = keyOf(catalog.docs.find((doc) => doc.state === 'stale')?.spec ?? '');
    const want: Wanted = { q: SHARED_WORD, spec };
    const paths = wantedPaths(catalog, want, result);
    // More than one row, so the picked one is not the row the wide reader opens on its own.
    expect(paths.length).toBeGreaterThan(1);

    await page.goto(PAGE);
    await page.locator(SEARCH).fill(SHARED_WORD);
    await page.locator(SPEC_SELECT).selectOption(spec);
    await expect.poll(() => shownPaths(page)).toEqual(paths);
    const shown = (await rows(page)).map((row) => row.path ?? '');
    const target = catalog.docs.find((doc) => doc.path === shown.at(-1));
    if (target === undefined) throw new Error('library.spec: the last row is not a catalog document');
    await expect(page.locator(READER_TITLE)).not.toHaveText(squash(target.title));

    await page.locator(`[data-library-entry="${target.path}"]`).click();
    await expect.poll(() => address(page)).toEqual(addressOf(want, target.path));
    await expect(page.locator(`[data-library-entry="${target.path}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(READER_TITLE)).toHaveText(squash(target.title));

    await page.reload();
    await expectControls(page, want);
    await expect.poll(() => shownPaths(page)).toEqual(paths);
    expect((await rows(page)).map((row) => row.path)).toEqual(shown);
    await expect(page.locator(`[data-library-entry="${target.path}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator(`${ENTRY}[aria-current="true"]`)).toHaveCount(1);
    await expect(page.locator(READER_TITLE)).toHaveText(squash(target.title));
    expect(address(page)).toEqual(addressOf(want, target.path));
  });

  test('an address with all four filters and a document lands on that selection, a reload keeps it', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const result = await searchOf(request, SHARED_WORD);
    const stale = catalog.docs.find((doc) => doc.state === 'stale');
    if (stale === undefined) throw new Error('library.spec: no stale document in the catalog');
    const want: Wanted = { q: SHARED_WORD, type: stale.type, spec: keyOf(stale.spec), state: 'stale' };
    const paths = wantedPaths(catalog, want, result);
    expect(paths).toContain(stale.path);

    const query = new URLSearchParams({ q: SHARED_WORD, type: stale.type, spec: keyOf(stale.spec), state: 'stale' });
    await page.goto(`${PAGE}?${query.toString()}#${stale.path}`);
    for (const pass of ['arrival', 'reload']) {
      if (pass === 'reload') await page.reload();
      await expectControls(page, want);
      await expect.poll(() => shownPaths(page)).toEqual(paths);
      await expect(page.locator(`[data-library-entry="${stale.path}"]`)).toHaveAttribute('aria-current', 'true');
      await expect(page.locator(READER_TITLE)).toHaveText(squash(stale.title));
      expect(address(page)).toEqual(addressOf(want, stale.path));
    }
  });

  test('back from the spec page restores the filter and the selection, forward leaves again', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const result = await searchOf(request, FULL_TEXT_WORD);
    const inSpec = new Set(catalog.docs.filter((doc) => doc.spec !== 'workspace').map((doc) => doc.path));
    const target = catalog.docs.find((doc) => doc.path === result.hits.find((hit) => inSpec.has(hit.path))?.path);
    if (target === undefined) throw new Error('library.spec: no full-text hit inside a spec');
    const want: Wanted = { q: FULL_TEXT_WORD, type: target.type };
    const paths = wantedPaths(catalog, want, result);
    const specPage = `/w/${WS}/s/${keyOf(target.spec)}`;

    await page.goto(PAGE);
    await page.locator(SEARCH).fill(FULL_TEXT_WORD);
    await pill(page, target.type).click();
    await expect.poll(() => shownPaths(page)).toEqual(paths);
    await page.locator(`[data-library-entry="${target.path}"]`).click();
    await expect.poll(() => address(page)).toEqual(addressOf(want, target.path));

    await page.locator('[data-library-reader] [data-library-open]').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(specPage);

    for (const pass of ['back', 'back after forward']) {
      await page.goBack();
      await expect.poll(() => address(page), { message: pass }).toEqual(addressOf(want, target.path));
      await expectControls(page, want);
      await expect.poll(() => shownPaths(page)).toEqual(paths);
      await expect(page.locator(`[data-library-entry="${target.path}"]`)).toHaveAttribute('aria-current', 'true');
      await expect(page.locator(READER_TITLE)).toHaveText(squash(target.title));
      if (pass === 'back') {
        await page.goForward();
        await expect.poll(() => new URL(page.url()).pathname).toBe(specPage);
      }
    }
  });
});
