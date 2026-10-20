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
 *
 * Group `reader` (T35, ISC-156.3): the reader `[data-library-reader]` shows a Markdown document as Docs prose
 * `[data-library-prose]` with "On this page" for its headings and a mermaid fence as a drawn figure with its toolbar
 * (ISC-154, ISC-154.1); an image document as the preview `[data-library-preview]`; a relative image of the prose (an
 * `.evidence/` file, and a design document's `.design/` asset) loads through the library's file route
 * `…/library/asset?path=`; a relative link to another catalog document `[data-library-xref]` opens that document in
 * place (`#path`); "Open in spec" `[data-library-open]` leads to the spec page and is absent for a workspace-wide
 * document; at 390 px the back button `[data-library-back]` restores the rows and focuses the opened one. The prose
 * cases come from the stub's `STUB_LIBRARY.reader` (harbor's T18 artifact with an appendix), every image is checked
 * loaded with a natural width above 0.
 *
 * Group `prototype` (T39, ISC-159): a `prototype` document opens in the reader as its card `[data-library-prototype]`:
 * one row `[data-library-prototype-page]` per catalog page (`index.html` first), each an `<a target="_blank"
 * rel="noopener">` on the server's read route `/proto/:ws/:spec/:folder/<page>`, and the preview
 * `[data-library-prototype-preview]` from the library's file route, decoded. Each link opens a new tab without an
 * opener on that route; the tab's answer carries the CSP with `sandbox`, every request of the tab to `/proto/` (the
 * page, its stylesheet, script, image and font) answers 200, the font (fetched from the opaque origin `null`) with
 * `Access-Control-Allow-Origin: *`, and the page's `@font-face` face is loaded and set on its body. The stub's prototype
 * is the library fixture's `002-tide-board/.design/prototype/board` (`STUB_LIBRARY.prototype`).
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, BrowserContext, Locator, Page, Request, Response } from '@playwright/test';

import type { DocsPage, LibraryCatalog, LibraryDoc, TechModel } from '../../core/src/files';
import { type LibrarySearchResult, PROTOTYPE_PREFIX, prototypeFolderOf, prototypeRoute, workspaceRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';
import { LIBRARY_HEADER, STUB_LIBRARY } from './stub-api';

/** The two control counts of the card's first row, in their order (design.md 017 § Across viewports). */
const CONTROL_KEYS = ['missing', 'stale'] as const;
type ControlKey = (typeof CONTROL_KEYS)[number];

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const EN = read('../src/i18n/en.json') as {
  library: {
    meta: { image: string; prototype: { one: string; other: string } };
    outdated: string;
    missing: string;
    control: Record<ControlKey, { word: string; one: string; other: string; none: string }>;
    reader: { missingHeading: string; open: string; back: string };
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
      ? template(doc.pages?.length === 1 ? EN.library.meta.prototype.one : EN.library.meta.prototype.other, { count: doc.pages?.length ?? 0, pages: (doc.pages ?? []).join(', ') })
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

/** The catalog as the read route serves it, the archived specs' documents included. */
async function servedCatalogOf(request: APIRequestContext): Promise<LibraryCatalog> {
  const answer = await request.get(ROUTE);
  expect(answer.status()).toBe(200);
  return (await answer.json()) as LibraryCatalog;
}

/** The catalog as the list shows it by default: without the archived specs' documents (no `?archived=1`). */
async function catalogOf(request: APIRequestContext): Promise<LibraryCatalog> {
  const catalog = await servedCatalogOf(request);
  return { ...catalog, docs: catalog.docs.filter((doc) => doc.archived !== true) };
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

  test('the list column starts at the card edge and sticks to the page scroll, not to the card', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('[data-library-controls]')).toBeVisible();
    const top = (selector: string): Promise<number> => page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
    // Unscrolled, the column stands at the top of the card's grid: no sticky offset inside the card.
    expect(Math.abs((await top('[data-library-list]')) - (await top('.lib-grid')))).toBeLessThanOrEqual(1);
    // Scrolled past the card's top, the column holds its sticky offset below the viewport's top edge.
    const grid = await top('.lib-grid');
    await page.mouse.move(720, 600);
    await page.mouse.wheel(0, grid + 400);
    await expect.poll(() => top('.lib-grid')).toBeLessThan(0);
    expect(Math.round(await top('[data-library-list]'))).toBe(72);
  });

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
      await expect(page.locator('[data-library-none]')).toContainText('/spec init');
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

test.describe('archived', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('the pill "Archived" lists the archived specs\' documents on ?archived=1, combined with the type, and hides them again', async ({ page, request }) => {
    const served = await servedCatalogOf(request);
    const archived = served.docs.filter((doc) => doc.archived === true && doc.type !== 'evidence');
    expect(archived.length, 'harbor holds an archived spec with documents').toBeGreaterThan(0);
    const toggle = page.locator('[data-library-archived]');

    await page.goto(PAGE);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle.locator('[data-library-archived-count]')).toHaveText(String(served.docs.filter((doc) => doc.archived === true).length));
    await expect(page.locator(`${ENTRY} [data-library-chip="archived"]`)).toHaveCount(0);

    await toggle.click();
    await expect(page).toHaveURL((url) => url.searchParams.get('archived') === '1');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(`${ENTRY} [data-library-chip="archived"]`)).toHaveCount(archived.length);

    const type = archived[0]?.type ?? 'spec';
    await pill(page, type).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('type') === type && url.searchParams.get('archived') === '1');
    const typed = served.docs.filter((doc) => doc.type === type);
    // The list re-renders after the URL moves: poll until it shows the same set, never read it once mid-render.
    await expect.poll(async () => (await shownPaths(page)).sort()).toEqual(pathsOf(typed));

    await toggle.click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('archived') && url.searchParams.get('type') === type);
    await expect.poll(() => shownPaths(page)).toEqual(pathsOf(typed.filter((doc) => doc.archived !== true)));
  });
});

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
    // An ok row carries no state chip; an archived one (spec 034, ISC-187.1) carries the archive chip and nothing else.
    expect(listed.filter((doc) => doc.state === 'ok').length).toBeGreaterThan(0);
    const archived = listed.filter((doc) => doc.archived === true);
    await expect(page.locator(`${ENTRY}[data-state="ok"] [data-library-chip]:not([data-library-chip="archived"])`)).toHaveCount(0);
    await expect(page.locator(`${ENTRY} [data-library-chip="archived"]`)).toHaveCount(archived.length);
    await expect(page.locator(`${ENTRY} [data-library-chip]`)).toHaveCount(catalog.missing + catalog.stale + archived.length);
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

  // Named without "reader", so `-g reader` runs the reader group alone.
  test('a missing row opens the empty state with the command that writes it', async ({ page, request }) => {
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
    await expect(empty.locator('ui-command-chip')).toContainText(`/spec ${missing.type} ${keyOf(missing.spec)}`);
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

// ---- reader (T35, ISC-156.3) --------------------------------------------------------------------------------------

const READER = '[data-library-reader]';
const PROSE = `${READER} [data-library-prose]`;
/** The stub's prose cases: harbor's T18 artifact with headings, a mermaid fence, an `.evidence/` image and two links. */
const PROSE_DOC = STUB_LIBRARY.reader;
/** The prose primitive's own copy (`docs.*`): a table region's label, a failed image's note. */
const DOCS_EN = read('../src/i18n/en.json') as { docs: { tableRegion: string; imageUnavailable: string } };

async function docPageOf(request: APIRequestContext, path: string): Promise<DocsPage> {
  const answer = await request.get(workspaceRoutes.libraryDoc(WS, path));
  expect(answer.status()).toBe(200);
  return (await answer.json()) as DocsPage;
}

function docOf(catalog: LibraryCatalog, wanted: (doc: LibraryDoc) => boolean, what: string): LibraryDoc {
  const doc = catalog.docs.find(wanted);
  if (doc === undefined) throw new Error(`library.spec: no ${what} in the catalog`);
  return doc;
}

/** Resolves with the page's own request of the library's file route for exactly `path`. */
const assetLoaded = (page: Page, path: string): ReturnType<Page['waitForResponse']> =>
  page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === `${ROUTE}/asset` && url.searchParams.get('path') === path && r.request().method() === 'GET';
  });

/** The image is decoded: complete, with a natural width above 0 (a broken image is complete at width 0). */
async function expectDecoded(img: Locator): Promise<void> {
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);
}

test.describe('reader', () => {
  test.describe('wide', () => {
    test.use(atWidth(WIDTHS.desktop));

    test('a Markdown document as Docs prose: "On this page" for its headings, mermaid as a drawn figure with its toolbar', async ({ page, request }) => {
      const catalog = await catalogOf(request);
      const doc = docOf(catalog, (d) => d.path === PROSE_DOC.path, 'reader document');
      const served = await docPageOf(request, doc.path);
      // The fixture must hold the cases, or the assertions below prove nothing.
      expect(served.toc.length).toBeGreaterThan(1);
      expect(served.figures.filter((figure) => figure.kind === 'mermaid')).toHaveLength(1);

      await page.goto(`${PAGE}#${doc.path}`);
      await expect(page.locator(READER_TITLE)).toHaveText(squash(doc.title));
      await expect(page.locator(PROSE)).toBeVisible();
      // The title stands once, in the reader's head: the prose drops the h1 it was read from.
      await expect(page.locator(`${PROSE} .docs-prose p`).first()).toBeVisible();
      await expect(page.locator(`${PROSE} .docs-prose h1`)).toHaveCount(0);

      // "On this page": one entry per heading of the served page, each pointing at its heading.
      const toc = page.locator(`${PROSE} nav.docs-toc .docs-toc-list a`);
      await expect(toc).toHaveText(served.toc.map((entry) => entry.text));
      expect(await toc.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual(served.toc.map((entry) => `#${entry.anchor}`));
      // Spec 021 (ISC-251): each ## is a disclosure whose h2 holds its toggle (keyed by the heading's id); deeper
      // headings stay in the prose with their id.
      const headingOf = (anchor: string) => page.locator(`${PROSE} .docs-prose [id="${anchor}"], ${PROSE} [data-library-section="${anchor}"] > .head h2.heading`);
      for (const entry of served.toc) await expect(headingOf(entry.anchor)).toHaveText(entry.text);
      // An entry scrolls in place: the heading (a section's own toggle) takes the focus, the fragment keeps naming the document.
      const last = served.toc.at(-1);
      if (last === undefined) throw new Error('library.spec: the reader document has no heading');
      await toc.last().click();
      await expect
        .poll(() => headingOf(last.anchor).evaluate((el) => el === document.activeElement || el.contains(document.activeElement)), { message: 'focus on the last heading' })
        .toBe(true);
      await expect(headingOf(last.anchor)).toBeInViewport();
      expect(address(page).doc).toBe(doc.path);

      // The mermaid fence as a figure: drawn client-side, captioned, with its toolbar (ISC-154, ISC-154.1).
      const figure = page.locator(`${PROSE} figure.mermaid-figure`);
      await expect(figure).toHaveCount(1);
      await expect(figure.locator('.mermaid-svg svg')).toBeVisible();
      await expect(figure).toHaveAttribute('data-rendered', '');
      await expect(figure).not.toHaveAttribute('data-render-error', '');
      await expect(figure.locator('figcaption')).toHaveText(served.toc[0]?.text ?? '');
      const toolbar = figure.locator('ui-diagram-toolbar [role="toolbar"]');
      await expect(toolbar).toHaveCount(1);
      await figure.hover();
      await expect(toolbar).toBeVisible();
      await expect(toolbar.locator('button')).not.toHaveCount(0);
      await expect(toolbar.locator('[data-zoom-level]')).toHaveText('100 %');
    });

    test('an image document shows its preview from the file route with a natural width above 0', async ({ page, request }) => {
      const catalog = await catalogOf(request);
      const doc = docOf(catalog, (d) => d.media === 'image' && d.type !== 'evidence', 'image document outside the evidence');
      const loaded = assetLoaded(page, doc.path);

      await page.goto(`${PAGE}#${doc.path}`);
      await expect(page.locator(READER_TITLE)).toHaveText(squash(doc.title));
      const img = page.locator(`${READER} [data-library-preview] img`);
      await expect(img).toHaveAttribute('src', workspaceRoutes.libraryAsset(WS, doc.path));
      await expect(img).toHaveAttribute('alt', doc.title);
      const answer = await loaded;
      expect([answer.status(), answer.headers()['content-type']]).toEqual([200, 'image/png']);
      await expectDecoded(img);
      await expect(page.locator(PROSE)).toHaveCount(0);
    });

    test('a relative image of the prose loads through the file route: an .evidence/ file and a design .design/ asset', async ({ page, request }) => {
      const loaded = assetLoaded(page, PROSE_DOC.image);
      await page.goto(`${PAGE}#${PROSE_DOC.path}`);
      const img = page.locator(`${PROSE} figure.image-figure img`);
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute('src', workspaceRoutes.libraryAsset(WS, PROSE_DOC.image));
      await img.scrollIntoViewIfNeeded();
      expect((await loaded).status()).toBe(200);
      await expectDecoded(img);
      await expect(page.locator(`${PROSE} figure[data-unavailable]`)).toHaveCount(0);

      // A design document's `.design/` image (`data-spec-asset`) takes the same route, relative to its folder.
      const catalog = await catalogOf(request);
      const design = docOf(catalog, (d) => d.type === 'design' && d.media === 'markdown', 'design document');
      const served = await docPageOf(request, design.path);
      const asset = /data-spec-asset="([^"]+)"/u.exec(served.html)?.[1];
      if (asset === undefined) throw new Error('library.spec: the design document has no .design/ image');
      const target = `${design.path.slice(0, design.path.lastIndexOf('/'))}/${asset}`;
      const designLoaded = assetLoaded(page, target);
      await page.goto(`${PAGE}#${design.path}`);
      await expect(page.locator(READER_TITLE)).toHaveText(squash(design.title));
      const designImg = page.locator(`${PROSE} img[data-spec-asset]`);
      await expect(designImg).toHaveAttribute('src', workspaceRoutes.libraryAsset(WS, target));
      await designImg.scrollIntoViewIfNeeded();
      expect((await designLoaded).status()).toBe(200);
      await expectDecoded(designImg);
    });

    test('a cross reference opens its document in place; Open in spec leads to the spec page, a workspace-wide document has none', async ({ page, request }) => {
      const catalog = await catalogOf(request);
      const [xref] = PROSE_DOC.xrefs;
      const target = docOf(catalog, (d) => d.path === xref, 'cross reference target');

      await page.goto(`${PAGE}#${PROSE_DOC.path}`);
      // Every relative link to a catalog document is a cross reference, its href that document's reader anchor.
      const links = page.locator(`${PROSE} a[data-library-xref]`);
      await expect(links).toHaveCount(PROSE_DOC.xrefs.length);
      expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute('data-library-xref')))).toEqual([...PROSE_DOC.xrefs]);
      const link = page.locator(`${PROSE} a[data-library-xref="${target.path}"]`);
      const href = new URL((await link.getAttribute('href')) ?? '', page.url());
      expect([href.pathname, decodeURIComponent(href.hash.slice(1))]).toEqual([PAGE, target.path]);

      await link.click();
      await expect(page.locator(READER_TITLE)).toHaveText(squash(target.title));
      await expect.poll(() => address(page)).toEqual(addressOf({}, target.path));
      await expect(page.locator(`[data-library-entry="${target.path}"]`)).toHaveAttribute('aria-current', 'true');
      await expect(page.locator(`${PROSE} .docs-prose p`).first()).toBeVisible();
      await expect(page.locator(`${PROSE} .docs-prose h1`)).toHaveCount(0);

      // "Open in spec NNN" on a spec's document leads to that spec's page.
      const open = page.locator(`${READER} [data-library-open]`);
      await expect(open).toHaveText(template(EN.library.reader.open, { spec: keyOf(target.spec) }));
      await open.click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(`/w/${WS}/s/${keyOf(target.spec)}`);

      // A workspace-wide document has none.
      const shared = docOf(catalog, (d) => d.spec === 'workspace' && d.media === 'markdown' && d.state === 'ok', 'workspace-wide document');
      await page.goto(`${PAGE}#${shared.path}`);
      await expect(page.locator(READER_TITLE)).toHaveText(squash(shared.title));
      await expect(page.locator(PROSE)).toBeVisible();
      await expect(page.locator(`${READER} [data-library-open]`)).toHaveCount(0);
    });

    // Ported from the former Docs tab (spec 017): its constitution and design cases, now in the Library.
    test('the constitution renders its tables as labelled, focusable scroll regions', async ({ page, request }) => {
      const doc = docOf(await catalogOf(request), (d) => d.type === 'constitution' && d.media === 'markdown', 'constitution');
      const served = await docPageOf(request, doc.path);
      const tables = served.html.match(/class="mdtable"/gu)?.length ?? 0;
      expect(tables, 'the constitution holds a table').toBeGreaterThan(0);

      await page.goto(`${PAGE}#${doc.path}`);
      await expect(page.locator(READER_TITLE)).toHaveText(squash(doc.title));
      const regions = page.locator(`${PROSE} .docs-prose div.mdtable`);
      await expect(regions).toHaveCount(tables);
      for (let index = 0; index < tables; index++) {
        const region = regions.nth(index);
        await expect(region).toHaveAttribute('role', 'region');
        await expect(region).toHaveAttribute('tabindex', '0');
        await expect(region).toHaveAttribute('aria-label', template(DOCS_EN.docs.tableRegion, { index: index + 1 }));
      }
    });

    test('a design image that fails to load becomes the missing figure with its own note, never a broken image', async ({ page, request }) => {
      const design = docOf(await catalogOf(request), (d) => d.type === 'design' && d.media === 'markdown', 'design document');
      const asset = /data-spec-asset="([^"]+)"/u.exec((await docPageOf(request, design.path)).html)?.[1];
      if (asset === undefined) throw new Error('library.spec: the design document has no .design/ image');
      const target = `${design.path.slice(0, design.path.lastIndexOf('/'))}/${asset}`;
      // The file went away between the document's render and the image load.
      await page.route(
        (url) => url.pathname === `${ROUTE}/asset` && url.searchParams.get('path') === target,
        (route) => route.fulfill({ status: 404, contentType: 'application/json; charset=utf-8', body: '{"error":"not-found"}' }),
      );

      await page.goto(`${PAGE}#${design.path}`);
      await expect(page.locator(READER_TITLE)).toHaveText(squash(design.title));
      const figure = page.locator(`${PROSE} figure.image-figure`).filter({ has: page.locator('.figure-missing') }).first();
      await expect(figure).toHaveAttribute('data-missing', '');
      await expect(figure).toHaveAttribute('data-unavailable', '');
      await expect(figure.locator('img')).toHaveCount(0);
      await expect(figure.locator('.figure-missing code')).toHaveText(asset);
      await expect(figure.locator('.figure-missing-note')).toHaveText(DOCS_EN.docs.imageUnavailable);
      await expect(page.locator(`${PROSE} img[data-spec-asset]`)).toHaveCount(0);
    });
  });

  test.describe('phone', () => {
    test.use(atWidth(WIDTHS.phone));

    test('at 390 px a row opens the reader alone; back and Escape restore the rows and focus the opened one', async ({ page, request }) => {
      const catalog = await catalogOf(request);
      const doc = docOf(catalog, (d) => d.path === PROSE_DOC.path, 'reader document');
      const row = page.locator(`[data-library-entry="${doc.path}"]`);
      const rowsShown = page.locator('[data-library-list]');

      await page.goto(PAGE);
      await expect(page.locator(READER)).toHaveCount(0);
      for (const way of ['back', 'Escape']) {
        await row.click();
        await expect(page.locator(READER_TITLE)).toHaveText(squash(doc.title));
        await expect(page.locator(PROSE)).toBeVisible();
        await expect(rowsShown).toHaveCount(0);
        await expect.poll(() => address(page).doc).toBe(doc.path);

        if (way === 'back') {
          const back = page.locator(`${READER} [data-library-back]`);
          await expect(back).toHaveText(EN.library.reader.back);
          await back.click();
        } else {
          await page.locator(READER).press('Escape');
        }
        await expect(rowsShown, way).toBeVisible();
        await expect(page.locator(READER), way).toHaveCount(0);
        await expect(row, way).toBeFocused();
        await expect.poll(() => address(page).doc, { message: way }).toBeNull();
      }
    });

    // Ported from the former Docs tab (spec 017).
    test('at 390 px tables scroll inside their own region, the page never does; "On this page" folds above the prose', async ({ page, request }) => {
      const doc = docOf(await catalogOf(request), (d) => d.type === 'constitution' && d.media === 'markdown', 'constitution');
      await page.goto(`${PAGE}#${doc.path}`);
      await expect(page.locator(READER_TITLE)).toHaveText(squash(doc.title));
      const prose = page.locator(PROSE);
      await expect(prose.locator('div.mdtable[role="region"]').first()).toBeVisible();
      const overflow = await prose.evaluate((host) =>
        [...host.querySelectorAll<HTMLElement>('div.mdtable')].map((region) => region.scrollWidth - region.clientWidth),
      );
      expect(overflow.some((width) => width > 0), 'a table wider than its region').toBe(true);
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(pageOverflow).toBeLessThanOrEqual(0);
      await expect(prose.locator('ui-disclosure.docs-toc-fold')).toBeVisible();
      await expect(prose.locator('nav.docs-toc')).toHaveCount(0);
    });
  });
});

// ---- prototype (T39, ISC-159) -------------------------------------------------------------------------------------

const PROTOTYPE_CARD = `${READER} [data-library-prototype]`;
const PROTOTYPE_PAGE = `${PROTOTYPE_CARD} [data-library-prototype-page]`;
/** The page a prototype opens on, listed first (design.md 017 § 9); the rest in the catalog's order. */
const ENTRY_PAGE = 'index.html';

/** The `/proto/` answers and failures of a context, recorded from before a tab opens, so its first request counts too. */
function protoTraffic(context: BrowserContext): { answers: Response[]; failed: string[]; stop: () => void } {
  const answers: Response[] = [];
  const failed: string[] = [];
  const isProto = (url: string): boolean => new URL(url).pathname.startsWith(PROTOTYPE_PREFIX);
  const onResponse = (r: Response): void => {
    if (isProto(r.url())) answers.push(r);
  };
  const onFailed = (r: Request): void => {
    if (isProto(r.url())) failed.push(`${r.url()}: ${r.failure()?.errorText ?? 'failed'}`);
  };
  context.on('response', onResponse);
  context.on('requestfailed', onFailed);
  return {
    answers,
    failed,
    stop: () => {
      context.off('response', onResponse);
      context.off('requestfailed', onFailed);
    },
  };
}

/** What an opened prototype page loaded: its local stylesheets, scripts and images, and its font faces with their status. */
interface TabLoad {
  readonly resources: string[];
  readonly faces: Array<{ family: string; status: string }>;
  readonly bodyFont: string;
  readonly opener: boolean;
  readonly origin: string;
}

async function tabLoad(tab: Page): Promise<TabLoad> {
  return tab.evaluate(async () => {
    await document.fonts.ready;
    const resources = [...document.querySelectorAll('link[rel="stylesheet"][href], script[src], img[src]')].map((el) =>
      el instanceof HTMLLinkElement ? el.href : el instanceof HTMLScriptElement || el instanceof HTMLImageElement ? el.src : '',
    );
    return {
      resources,
      faces: [...document.fonts].map((face) => ({ family: face.family.replace(/^["']|["']$/gu, ''), status: face.status })),
      bodyFont: getComputedStyle(document.body).fontFamily,
      opener: window.opener !== null,
      origin: window.origin,
    };
  });
}

test.describe('prototype', () => {
  test.use(atWidth(WIDTHS.desktop));

  /** The stub's prototype document: pages from the fixture folder, the preview from harbor's `.design/`. */
  async function prototypeDoc(request: APIRequestContext): Promise<{ doc: LibraryDoc; folder: string; pages: string[] }> {
    const catalog = await catalogOf(request);
    const doc = docOf(catalog, (d) => d.type === 'prototype' && d.path === STUB_LIBRARY.prototype.path, 'prototype document');
    const folder = prototypeFolderOf(doc);
    if (folder === null) throw new Error(`library.spec: ${doc.path} names no prototype folder`);
    const pages = doc.pages ?? [];
    // The fixture must hold the case, or the assertions below prove nothing: an entry page, a second page, a preview.
    expect(pages).toContain(ENTRY_PAGE);
    expect(pages.length).toBeGreaterThan(1);
    expect(doc.preview).toBe(STUB_LIBRARY.prototype.preview);
    return { doc, folder, pages: [...pages.filter((p) => p === ENTRY_PAGE), ...pages.filter((p) => p !== ENTRY_PAGE)] };
  }

  test('every catalog page a row, its link opening a new tab without opener on the read route, the preview decoded', async ({ page, request }) => {
    const { doc, folder, pages } = await prototypeDoc(request);
    const preview = doc.preview ?? '';
    const loaded = assetLoaded(page, preview);

    await page.goto(`${PAGE}#${doc.path}`);
    await expect(page.locator(READER_TITLE)).toHaveText(squash(doc.title));
    await expect(page.locator(PROTOTYPE_CARD)).toHaveCount(1);
    await expect(page.locator(PROSE)).toHaveCount(0);

    // One row per catalog page, the entry page first, each a link on the server's read route.
    const links = page.locator(PROTOTYPE_PAGE);
    await expect(links).toHaveCount(pages.length);
    expect(await links.evaluateAll((els) => els.map((el) => el.getAttribute('data-library-prototype-page')))).toEqual(pages);
    await expect(page.locator(`${PROTOTYPE_CARD} .proto-count`)).toHaveText(String(pages.length));
    for (const [i, file] of pages.entries()) {
      const link = links.nth(i);
      await expect(link).toHaveJSProperty('tagName', 'A');
      await expect(link).toHaveAttribute('href', prototypeRoute(WS, doc.spec, folder, file));
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener');
      await expect(link).toContainText(file);
    }

    // The preview: the screenshot core names, from the library's file route, decoded.
    const img = page.locator(`${PROTOTYPE_CARD} [data-library-prototype-preview] img`);
    await expect(img).toHaveAttribute('src', workspaceRoutes.libraryAsset(WS, preview));
    const answer = await loaded;
    expect([answer.status(), answer.headers()['content-type']]).toEqual([200, 'image/png']);
    await expectDecoded(img);
  });

  test('each page opens in a new tab, sandboxed, and loads its local stylesheet, script, image and font with 200', async ({ page, context, request }) => {
    const { doc, folder, pages } = await prototypeDoc(request);
    await page.goto(`${PAGE}#${doc.path}`);
    await expect(page.locator(PROTOTYPE_PAGE)).toHaveCount(pages.length);

    const types = new Set<string>();
    let faces = 0;
    for (const file of pages) {
      const route = prototypeRoute(WS, doc.spec, folder, file);
      const traffic = protoTraffic(context);
      const [tab] = await Promise.all([context.waitForEvent('page'), page.locator(`${PROTOTYPE_PAGE}[data-library-prototype-page="${file}"]`).click()]);
      await tab.waitForLoadState('load');
      expect(new URL(tab.url()).pathname, file).toBe(route);
      // The app stays where it was; the page is a tab of its own.
      expect(new URL(page.url()).pathname).toBe(PAGE);

      // Every font face of the page loads; wait for it before reading the traffic, so the font's answer is in.
      await expect.poll(async () => (await tabLoad(tab)).faces.map((f) => f.status), { message: file }).not.toContain('loading');
      const load = await tabLoad(tab);
      traffic.stop();

      // A new tab without opener, on an opaque origin (the CSP's sandbox), its answer carrying that CSP.
      expect(load.opener, `${file}: window.opener`).toBe(false);
      expect(load.origin, `${file}: origin`).toBe('null');
      const main = traffic.answers.find((r) => new URL(r.url()).pathname === route && r.request().resourceType() === 'document');
      if (main === undefined) throw new Error(`library.spec: no document answer for ${route}`);
      expect(main.status()).toBe(200);
      expect(main.headers()['content-security-policy'] ?? '').toMatch(/(^|;)\s*sandbox\b/u);

      // Every request of the tab to /proto/ answers 200, nothing fails, and every resource the page names is among them.
      expect(traffic.failed, `${file}: failed requests`).toEqual([]);
      expect(traffic.answers.map((r) => [new URL(r.url()).pathname, r.status()]).filter(([, status]) => status !== 200), file).toEqual([]);
      const answered = new Set(traffic.answers.map((r) => new URL(r.url()).pathname));
      for (const url of load.resources) {
        const path = new URL(url).pathname;
        expect(path.startsWith(PROTOTYPE_PREFIX), `${file}: ${url} is local`).toBe(true);
        expect(answered.has(path), `${file}: ${path} answered`).toBe(true);
      }
      for (const r of traffic.answers) types.add((r.headers()['content-type'] ?? '').split(';')[0] ?? '');

      // The font: fetched from the opaque origin, answered for it with ACAO *, its face loaded and set on the body.
      const fonts = traffic.answers.filter((r) => r.request().resourceType() === 'font');
      expect(fonts.length, `${file}: font requests`).toBeGreaterThan(0);
      for (const font of fonts) {
        expect(font.request().headers()['origin'], `${file}: font Origin`).toBe('null');
        expect(font.headers()['access-control-allow-origin'], `${file}: font ACAO`).toBe('*');
      }
      expect(load.faces.length, `${file}: @font-face faces`).toBeGreaterThan(0);
      for (const face of load.faces) {
        expect(face.status, `${file}: ${face.family}`).toBe('loaded');
        expect(load.bodyFont.startsWith(`"${face.family}"`) || load.bodyFont.startsWith(face.family), `${file}: body font ${load.bodyFont}`).toBe(true);
        expect(await tab.evaluate((family) => document.fonts.check(`16px "${family}"`), face.family)).toBe(true);
      }
      faces += load.faces.length;
      await tab.close();
    }

    // Across the pages: an HTML page, a stylesheet, a script, an image and a font, each answered 200.
    expect([...types].sort()).toEqual(expect.arrayContaining(['font/woff2', 'image/png', 'text/css', 'text/html', 'text/javascript']));
    expect(faces).toBeGreaterThan(0);
  });
});

/*
 * Group `tech` (T37, ISC-157): the five former tech tabs, their content now in the library. `bun run e2e -- library -g tech`.
 * Every expected value comes from the tech goldens (`core/fixtures/<ws>.tech.golden.json`, the old tech route's body)
 * and, for the former Status tab's figures, from the dashboard golden it rendered (`statusRow`, the old tab's own
 * reading). The former tech page itself is no longer reachable: since T42 (ISC-157.1) `/w/:ws/tech/<tab>` redirects to
 * the Library. Content is compared as a prose fingerprint (`fingerprint`): each heading, paragraph, list item and table
 * cell with its text, a figure as its kind and caption (its drawing differs by route).
 * - Overview, Architecture, Open's risks: `specs/tech.md` in the reader as `section[data-library-tech-section]` in the
 *   order overview, stack, architecture, risks; overview + stack equal the golden's overview page (ISC-134 joins them).
 * - Status, Specs: each spec group head `[data-library-group-head]` carries the Status row's type, stage, claims, tasks
 *   and fog (`[data-library-head=…]`) and the Specs card's Goal and first Approach paragraph.
 * - Open: under `?state=open` every `- fog:` line of each open spec under its number (`[data-library-fog-group]`).
 * - Without `specs/tech.md` (lantern, `pages: null`): the dimmed row `[data-library-placeholder="tech.md"]` opens the
 *   empty state `[data-library-tech-empty]`, with no command chip: the Spec plugin has no command that writes it (spec 031).
 */
const TECH_SECTION_ORDER = ['overview', 'stack', 'architecture', 'risks'] as const;
type TechSectionKey = (typeof TECH_SECTION_ORDER)[number];

const techGolden = (ws: string): TechModel => read(`../../core/fixtures/${ws}.tech.golden.json`) as TechModel;
const TECH_EN = read('../src/i18n/en.json') as {
  common: { noValue: string };
  types: Readonly<Record<string, string>>;
  stages: Readonly<Record<string, string>>;
  library: { tech: { emptyHeading: string; emptyBody: string } };
};

/** A row of the dashboard golden, as far as the former Status tab read it. */
interface StatusSource {
  readonly id: string;
  readonly type: string | null;
  readonly stage: string;
  readonly progress: { readonly closed: number; readonly total: number };
  readonly tasks?: { readonly landed: number; readonly total: number } | null;
}
/** The dashboard golden the former Status tab rendered (`core/fixtures/harbor.golden.json`). */
const DASHBOARD_GOLDEN = read('../../core/fixtures/harbor.golden.json') as { readonly specs: readonly StatusSource[] };

type Fingerprint = readonly string[];

/**
 * The prose fingerprint of `html` (parsed inert) or of the first element `selector` names: in document order, each
 * h1–h6, p, li, th and td as `tag:text`, each figure as `figure:kind:caption` (not descended into: a drawn mermaid and
 * a loaded image differ by route, their caption does not). An empty list when the selector matches nothing.
 */
async function fingerprint(page: Page, source: { html: string } | { selector: string }): Promise<Fingerprint> {
  return page.evaluate((from) => {
    let root: ParentNode | null;
    if ('html' in from) {
      const template = document.createElement('template');
      template.innerHTML = from.html;
      root = template.content;
    } else {
      root = document.querySelector(from.selector);
    }
    const out: string[] = [];
    const norm = (text: string | null | undefined): string => (text ?? '').replace(/\s+/gu, ' ').trim();
    const walk = (node: ParentNode): void => {
      for (const child of Array.from(node.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'figure') {
          const kind = child.classList.contains('mermaid-figure') ? 'mermaid' : child.classList.contains('image-figure') ? 'image' : 'other';
          out.push(`figure:${kind}:${norm(child.querySelector('figcaption')?.textContent)}`);
          continue;
        }
        if (/^(h[1-6]|p|li|th|td)$/u.test(tag)) out.push(`${tag}:${norm(child.textContent)}`);
        walk(child);
      }
    };
    if (root !== null) walk(root);
    return out;
  }, source);
}

/** One spec as the former Status tab and the library's group head show it. */
interface HeadFigures {
  readonly id: string;
  readonly type: string;
  readonly stage: string;
  readonly claims: string;
  /** `landed/total`; null where the Status tab shows no tasks. */
  readonly tasks: string | null;
  readonly fog: number;
}

test.describe('tech', () => {
  test.use(atWidth(WIDTHS.desktop));

  const HARBOR = techGolden(WS);
  const LANTERN_WS = 'lantern';
  const LANTERN = techGolden(LANTERN_WS);
  const FOGGY = HARBOR.specs.filter((spec) => spec.phase !== 'complete' && spec.fog.length > 0);
  const TECH_DOC = '[data-library-reader] [data-library-prose] .docs-prose';
  const section = (key: TechSectionKey): string => `${TECH_DOC} > section[data-library-tech-section="${key}"]`;
  // ISC-157.2: the stub's `tech-heading` library serves harbor's tech.md with its architecture section under this heading.
  const DIFFERING = 'How Harbor is built';

  test('tech.md sections from core: a heading that differs from its key still opens its section (ISC-157.2)', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'X-Spectant-Stub-Library': 'tech-heading' });
    await page.goto(`${PAGE}?section=architecture#tech.md`);
    await expect(page.locator(`${TECH_DOC} > section[data-library-tech-section]`)).toHaveCount(4);
    await expect(page.locator(`${section('architecture')} > h2#architecture`)).toHaveText(DIFFERING);
    await expect(page.locator(`${section('architecture')} > h2#architecture`)).toBeInViewport();
  });

  test('tech redirect: /w/:ws/tech/architecture lands on the architecture section under a differing heading (ISC-157.2)', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'X-Spectant-Stub-Library': 'tech-heading' });
    await page.goto(`/w/${WS}/tech/architecture`);
    await expect(page).toHaveURL(/section=architecture/u);
    await expect(page.locator(`${section('architecture')} > h2#architecture`)).toHaveText(DIFFERING);
    await expect(page.locator(`${section('architecture')} > h2#architecture`)).toBeInViewport();
  });

  test('tech.md: overview, stack, architecture and risks in contract order, each the golden content of the former Overview, Architecture and Open tabs', async ({ page, request }) => {
    const pages = HARBOR.pages;
    if (pages === null) throw new Error('library.spec: the harbor tech golden has no pages');
    const catalog = await catalogOf(request);
    const doc = docOf(catalog, (d) => d.type === 'tech', 'tech document');
    expect(doc.path).toBe('tech.md');

    // The golden pages, read first: the fingerprints the former Overview, Architecture and Open tabs showed.
    await page.goto(PAGE);
    const golden = {
      overview: await fingerprint(page, { html: pages.overview.html }),
      architecture: await fingerprint(page, { html: pages.architecture.html }),
      risks: await fingerprint(page, { html: pages.risks.html }),
    };
    // Not vacuous: every golden page holds a heading and more.
    for (const [key, print] of Object.entries(golden)) expect(print.length, `golden ${key}`).toBeGreaterThan(1);

    // The library: the four sections in contract order, "On this page" naming exactly them, none reported missing.
    await page.goto(`${PAGE}#${doc.path}`);
    await expect(page.locator(TECH_DOC)).toBeVisible();
    const sections = page.locator(`${TECH_DOC} > section[data-library-tech-section]`);
    await expect(sections).toHaveCount(TECH_SECTION_ORDER.length);
    expect(await sections.evaluateAll((els) => els.map((el) => el.getAttribute('data-library-tech-section')))).toEqual([...TECH_SECTION_ORDER]);
    const toc = page.locator('[data-library-reader] [data-library-prose] nav.docs-toc .docs-toc-list a');
    expect(await toc.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual(TECH_SECTION_ORDER.map((key) => `#${key}`));
    await expect(page.locator('[data-library-tech-missing]')).toHaveCount(0);
    await expect(page.locator(`${TECH_DOC} figure.mermaid-figure .mermaid-svg svg`).first()).toBeVisible();

    const shown: Record<TechSectionKey, Fingerprint> = { overview: [], stack: [], architecture: [], risks: [] };
    for (const key of TECH_SECTION_ORDER) {
      shown[key] = await fingerprint(page, { selector: section(key) });
      expect(shown[key].length, `section ${key}`).toBeGreaterThan(0);
    }
    // Nothing of the file stands outside the four sections (the h1 is the reader's title).
    const outside = await page.locator(TECH_DOC).evaluate((el) =>
      Array.from(el.children)
        .filter((child) => !child.matches('section[data-library-tech-section]'))
        .map((child) => child.tagName.toLowerCase()),
    );
    expect(outside).toEqual([]);
    expect({ overview: [...shown.overview, ...shown.stack], architecture: shown.architecture, risks: shown.risks }).toEqual(golden);
  });

  test('tech · group heads: type, stage, claims, tasks and fog of the former Status tab, Goal and Approach of the former Specs tab', async ({ page }) => {
    const ids = HARBOR.specs.map((spec) => spec.id);
    const norm = (text: string): string => text.replace(/\s+/gu, ' ').trim();

    // The former Status tab's rows, read from the dashboard golden it rendered: type and stage by their labels,
    // claims closed/total, tasks landed/total (none without tasks), the tech golden's fog lines.
    const fogOf = new Map(HARBOR.specs.map((spec) => [spec.id, spec.fog.length]));
    const status: HeadFigures[] = DASHBOARD_GOLDEN.specs
      .filter((row) => fogOf.has(row.id))
      .map((row) => ({
        id: row.id,
        type: row.type === null ? TECH_EN.common.noValue : (TECH_EN.types[row.type] ?? row.type),
        stage: TECH_EN.stages[row.stage] ?? row.stage,
        claims: `${String(row.progress.closed)}/${String(row.progress.total)}`,
        tasks: row.tasks ? `${String(row.tasks.landed)}/${String(row.tasks.total)}` : null,
        fog: fogOf.get(row.id) ?? 0,
      }));
    expect(status.map((row) => row.id).toSorted()).toEqual(ids.toSorted());

    // The former Specs tab: Goal and the first Approach paragraph per spec, each the golden's page.
    await page.goto(PAGE);
    const formerProse = new Map<string, { goal: Fingerprint; approach: Fingerprint }>();
    for (const spec of HARBOR.specs) {
      const goal = spec.goal === null ? [] : await fingerprint(page, { html: spec.goal.html });
      const approach = spec.approach === null ? [] : await fingerprint(page, { html: spec.approach.html });
      formerProse.set(spec.id, { goal, approach });
    }
    // Not vacuous: the fixture holds goals and approaches.
    expect([...formerProse.values()].filter((p) => p.goal.length > 0).length).toBeGreaterThan(0);
    expect([...formerProse.values()].filter((p) => p.approach.length > 0).length).toBeGreaterThan(0);

    // The library: one head per spec, its figures and prose equal to the former tabs'.
    const heads = page.locator('[data-library-group-head]');
    await expect(heads).toHaveCount(ids.length);
    const shown = await heads.evaluateAll((els) =>
      els.map((el) => {
        const field = (key: string): string | null => {
          const node = el.querySelector(`[data-library-head="${key}"]`);
          return node === null ? null : node.textContent.replace(/\s+/gu, ' ').trim();
        };
        const fog = field('fog');
        return {
          id: (el.querySelector('.lib-ghead-id')?.textContent ?? '').trim(),
          spec: el.getAttribute('data-spec') ?? '',
          type: field('type') ?? '',
          stage: field('stage') ?? '',
          claims: field('claims') ?? '',
          tasks: field('tasks'),
          fog: fog === null ? 0 : Number(/\d+/u.exec(fog)?.[0] ?? Number.NaN),
        };
      }),
    );
    expect(shown.map((head) => head.id)).toEqual(ids.toSorted());
    for (const row of status) {
      const head = shown.find((h) => h.id === row.id);
      if (head === undefined) throw new Error(`library.spec: no group head for ${row.id}`);
      const figures: HeadFigures = { id: head.id, type: norm(head.type), stage: norm(head.stage), claims: head.claims, tasks: head.tasks, fog: head.fog };
      // A spec the Status tab shows without tasks has none in the head either: 0/0.
      expect(figures, `the head of ${row.id}`).toEqual({ ...row, tasks: row.tasks ?? '0/0' });
      const prose = formerProse.get(row.id);
      const groupHead = `[data-library-group-head][data-spec="${head.spec}"]`;
      expect(await fingerprint(page, { selector: `${groupHead} [data-library-head="goal"]` }), `goal of ${row.id}`).toEqual(prose?.goal);
      expect(await fingerprint(page, { selector: `${groupHead} [data-library-head="approach"] .lib-ghead-approach-body` }), `approach of ${row.id}`).toEqual(prose?.approach);
    }
  });

  // Ported from the former tech page (spec 017): its Overview tab loaded the image of tech.md through its own asset route.
  test('tech · the overview images of tech.md load through the file route, decoded, as the former Overview tab', async ({ page }) => {
    const images = (HARBOR.pages?.overview.figures ?? []).flatMap((figure) => (figure.kind === 'image' && figure.asset !== undefined ? [figure.asset] : []));
    // Not vacuous: the golden overview holds an image.
    expect(images.length).toBeGreaterThan(0);

    await page.goto(`${PAGE}?section=overview#tech.md`);
    const shown = page.locator(`${section('overview')} figure.image-figure img`);
    await expect(shown).toHaveCount(images.length);
    for (const [index, asset] of images.entries()) {
      const img = shown.nth(index);
      await expect(img).toHaveAttribute('src', workspaceRoutes.libraryAsset(WS, asset));
      await expectDecoded(img);
    }
    await expect(page.locator(`${TECH_DOC} figure[data-unavailable]`)).toHaveCount(0);
  });

  test('tech · the filter open: every fog line of each open spec under its number, as the former Open tab', async ({ page }) => {
    // Not vacuous: harbor holds an open spec with fog lines.
    expect(FOGGY.length).toBeGreaterThan(0);

    // The former Open tab listed each open spec with fog in the golden's order, its lines in file order.
    const formerGroups = FOGGY.map((spec) => spec.id);

    await page.goto(`${PAGE}?state=open`);
    const groups = page.locator('[data-library-fog-group]');
    await expect(groups).toHaveCount(FOGGY.length);
    expect(await groups.evaluateAll((els) => els.map((el) => el.getAttribute('data-library-fog-group')))).toEqual(formerGroups);
    for (const spec of FOGGY) {
      await expect(page.locator(`[data-library-fog-group="${spec.id}"] [data-library-fog-line] .lib-fog-text`)).toHaveText([...spec.fog]);
    }
  });

  test('tech · without tech.md: the dimmed tech.md row opens the empty state without a command chip', async ({ page, request }) => {
    expect(LANTERN.pages, 'the lantern tech golden has no tech.md').toBeNull();
    const answer = await request.get(`/api/workspaces/${LANTERN_WS}/library`);
    expect(answer.status()).toBe(200);
    const catalog = (await answer.json()) as LibraryCatalog;
    expect(catalog.docs.length).toBeGreaterThan(0);
    expect(catalog.docs.filter((doc) => doc.type === 'tech')).toEqual([]);

    await page.goto(`/w/${LANTERN_WS}/library`);
    const row = page.locator('[data-library-group="workspace"] [data-library-placeholder="tech.md"]');
    await expect(row).toHaveCount(1);
    await expect(row).not.toHaveAttribute('data-library-entry');
    await row.click();
    const empty = page.locator('[data-library-reader] ui-empty-state[data-library-tech-empty]');
    await expect(empty).toBeVisible();
    await expect(empty.locator('.title')).toHaveText(TECH_EN.library.tech.emptyHeading);
    await expect(empty.locator('.body')).toHaveText(TECH_EN.library.tech.emptyBody);
    // No plugin command writes specs/tech.md (spec 031), so the empty state offers no chip.
    await expect(empty.locator('ui-command-chip')).toHaveCount(0);
    await expect(page.locator('[data-library-reader] [data-library-prose]')).toHaveCount(0);
    await expect(page.locator('[data-library-reader] section[data-library-tech-section]')).toHaveCount(0);

    // A workspace with tech.md lists it as a document and shows no placeholder.
    await page.goto(PAGE);
    await expect(page.locator('[data-library-entry="tech.md"]')).toHaveCount(1);
    await expect(page.locator('[data-library-placeholder]')).toHaveCount(0);
  });
});

/*
 * Group `redirect` (T44, ISC-157.1): the former tech page lives in the Library. `bun run e2e -- library -g redirect`.
 * - Each former address, `/w/:ws/tech` and its five tabs, lands on `/w/:ws/library` with exactly the selection its tab
 *   stood for (`REDIRECTS`, written out here, not read from the app): Overview (and the bare address) and Architecture
 *   open `tech.md` in the reader at that section (`?section=<key>#tech.md`; the section in view, its heading focused,
 *   the `tech.md` row current), Status and Specs the document rows grouped by spec with nothing picked (no query, no
 *   fragment; at 1440 the reader shows the first row, as on any visit without one), Open the filter "open"
 *   (`?state=open`, the fog groups, the state select on `open`).
 * - Each is checked twice: by a direct load, and by an in-app navigation without a page load (a history push the router
 *   follows, as it would follow a link; no link to the old page is left in the app). Either way the old address is no
 *   history entry of its own (the redirect replaces it): one step back lands on the page before, and stays there.
 * - Any other path below the old page is not-found.
 * - Tech is gone and the Library stands in its place in all three ways in: the PAGE select's menu (its entries, the
 *   Library's summary counting the catalog), the palette (no Tech group, no Tech entry; "tech" finds "Open the library"
 *   with its `book` icon) and the shortcut sheet (`g o` → Library in the workspace context, no Tech row; `g o` from a
 *   workspace page lands on the Library).
 * Test titles avoid the other groups' names in lower case (`list`, `control`, `search`, `reader`, `tech`, `prototype`),
 * so each `-g` keeps its own count.
 */
type RedirectSelection = { readonly kind: 'section'; readonly key: 'overview' | 'architecture' } | { readonly kind: 'grouped' } | { readonly kind: 'open' };

interface TechRedirect {
  /** The former address below `/w/:ws/tech`, `''` the bare one. */
  readonly from: string;
  readonly query: Readonly<Record<string, string>>;
  /** The fragment without `#`; `''` for none. */
  readonly hash: string;
  readonly selection: RedirectSelection;
}

/** design.md 017 § Umleitungen, as T42 landed them: where each former tech address leads. */
const REDIRECTS: readonly TechRedirect[] = [
  { from: '', query: { section: 'overview' }, hash: 'tech.md', selection: { kind: 'section', key: 'overview' } },
  { from: '/overview', query: { section: 'overview' }, hash: 'tech.md', selection: { kind: 'section', key: 'overview' } },
  { from: '/architecture', query: { section: 'architecture' }, hash: 'tech.md', selection: { kind: 'section', key: 'architecture' } },
  { from: '/status', query: {}, hash: '', selection: { kind: 'grouped' } },
  { from: '/specs', query: {}, hash: '', selection: { kind: 'grouped' } },
  { from: '/open', query: { state: 'open' }, hash: '', selection: { kind: 'open' } },
];

const REDIRECT_EN = read('../src/i18n/en.json') as {
  shell: { pages: Readonly<Record<string, string>> & { summary: { library: string } } };
  palette: { actions: { library: string } };
  shortcuts: { actions: { goTo: string } };
};

test.describe('redirect', () => {
  test.use(atWidth(WIDTHS.desktop));

  const WORKSPACE = `/w/${WS}`;
  const OLD = `${WORKSPACE}/tech`;
  const TECH_DOC = '[data-library-reader] [data-library-prose] .docs-prose';
  const FOGGY = techGolden(WS).specs.filter((spec) => spec.phase !== 'complete' && spec.fog.length > 0);
  const MARK = 'spectantE2eNoReload';
  const PAGE_IDS = ['specs', 'board', 'planning', 'library'] as const;
  const pageName = (id: string): string => REDIRECT_EN.shell.pages[id] ?? id;
  const heading = (page: Page): Locator => page.locator('app-library-page h1#library');

  /** The workspace page, rendered: the page every navigation below starts from and every step back returns to. */
  async function atWorkspace(page: Page): Promise<void> {
    await page.goto(WORKSPACE);
    await expect(page.locator('[data-panel="specs"] [data-spec-row]').first()).toBeVisible();
  }

  /** An in-app navigation to `path`: a history push the router follows, with no page load (the mark survives it). */
  async function navigateInApp(page: Page, path: string): Promise<void> {
    await page.evaluate(
      ({ target, mark }) => {
        (window as unknown as Record<string, unknown>)[mark] = true;
        history.pushState(null, '', target);
        dispatchEvent(new PopStateEvent('popstate', { state: null }));
      },
      { target: path, mark: MARK },
    );
  }

  const noReload = (page: Page): Promise<unknown> => page.evaluate((mark) => (window as unknown as Record<string, unknown>)[mark], MARK);

  /** The landing address: the Library's path with exactly the expected query and fragment. */
  async function expectLanding(page: Page, redirect: TechRedirect): Promise<void> {
    await expect(page).toHaveURL((url) => url.pathname === PAGE);
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams), `query of ${OLD}${redirect.from}`).toEqual(redirect.query);
    expect(url.hash, `fragment of ${OLD}${redirect.from}`).toBe(redirect.hash === '' ? '' : `#${redirect.hash}`);
  }

  /** The selection the landing shows. */
  async function expectSelection(page: Page, redirect: TechRedirect, catalog: LibraryCatalog): Promise<void> {
    const what = `${OLD}${redirect.from}`;
    await expect(heading(page), what).toBeVisible();
    const current = page.locator(`${ENTRY}[aria-current="true"]`);
    const selection = redirect.selection;
    switch (selection.kind) {
      case 'section': {
        await expect(current, what).toHaveCount(1);
        await expect(current, what).toHaveAttribute('data-library-entry', 'tech.md');
        const section = page.locator(`${TECH_DOC} > section[data-library-tech-section="${selection.key}"]`);
        await expect(section, what).toBeInViewport();
        await expect(section.locator('> h2'), what).toBeFocused();
        break;
      }
      case 'grouped': {
        // The document rows with nothing picked, grouped by spec: the workspace-wide group first, then one per spec in
        // ascending number, a head for each active spec. Nothing picked: at this width the reader shows the list's first
        // row, as on any visit without a fragment, and no section of tech.md is jumped to.
        const first = page.locator(ENTRY).first();
        await expect(first, what).toBeVisible();
        await expect(current, what).toHaveCount(1);
        await expect(current, what).toHaveAttribute('data-library-entry', (await first.getAttribute('data-library-entry')) ?? '');
        await expect(page.locator(`${TECH_DOC} section[data-library-tech-section] > h2:focus`), what).toHaveCount(0);
        await expect(page.locator('[data-library-fog-group]'), what).toHaveCount(0);
        const groups = await page.locator('[data-library-group]').evaluateAll((els) => els.map((el) => el.getAttribute('data-library-group') ?? ''));
        const specKeys = [...new Set(catalog.docs.map((doc) => keyOf(doc.spec)).filter((key) => key !== 'workspace'))].toSorted();
        expect(specKeys.length, 'the catalog spans more than one spec').toBeGreaterThan(1);
        expect(groups, what).toEqual(['workspace', ...specKeys]);
        await expect(page.locator('[data-library-group-head]'), what).toHaveCount(catalog.groups.length);
        break;
      }
      case 'open': {
        expect(FOGGY.length, 'harbor holds an open spec with fog lines').toBeGreaterThan(0);
        await expect(page.locator('[data-library-state-select]'), what).toHaveValue('open');
        const fog = page.locator('[data-library-fog-group]');
        await expect(fog, what).toHaveCount(FOGGY.length);
        expect(await fog.evaluateAll((els) => els.map((el) => el.getAttribute('data-library-fog-group'))), what).toEqual(FOGGY.map((spec) => spec.id));
        await expect(current, what).toHaveCount(0);
        break;
      }
    }
  }

  /** One step back lands on the workspace page and stays there: the old address was no history entry of its own. */
  async function expectBackToWorkspace(page: Page, redirect: TechRedirect): Promise<void> {
    await page.goBack();
    await expect(page, `back from ${OLD}${redirect.from}`).toHaveURL((url) => url.pathname === WORKSPACE && url.search === '' && url.hash === '');
    await expect(page.locator('[data-panel="specs"] [data-spec-row]').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(WORKSPACE);
  }

  for (const redirect of REDIRECTS) {
    const label = `Tech${redirect.from}`;

    test(`a direct load of ${label} lands on the Library with its selection, and back skips it`, async ({ page, request }) => {
      const catalog = await catalogOf(request);
      await atWorkspace(page);
      await page.goto(`${OLD}${redirect.from}`);
      await expectLanding(page, redirect);
      await expectSelection(page, redirect, catalog);
      await expectBackToWorkspace(page, redirect);
    });

    test(`an in-app navigation to ${label} lands on the Library with its selection, and back skips it`, async ({ page, request }) => {
      const catalog = await catalogOf(request);
      await atWorkspace(page);
      await navigateInApp(page, `${OLD}${redirect.from}`);
      await expectLanding(page, redirect);
      await expectSelection(page, redirect, catalog);
      expect(await noReload(page), 'no page load').toBe(true);
      await expectBackToWorkspace(page, redirect);
      expect(await noReload(page), 'no page load').toBe(true);
    });
  }

  test('any other path below the former Tech page is not-found', async ({ page }) => {
    for (const path of [`${OLD}/nope`, `${OLD}/overview/more`]) {
      await page.goto(path);
      await expect(page.locator('app-not-found'), path).toBeVisible();
      await expect(page, path).toHaveURL((url) => url.pathname === path);
    }
  });

  test('the PAGE select names Specs, Board, Planning and Library with its catalog counts, no Tech', async ({ page, request }) => {
    // The menu counts the whole catalog, the archived specs' documents included; the list's filter does not reach it.
    const catalog = await servedCatalogOf(request);
    await page.goto(OLD);
    await expect(page).toHaveURL((url) => url.pathname === PAGE);
    await expect(heading(page)).toBeVisible();
    const trigger = await headerControl(page, 'page');
    await expect(trigger).toContainText(pageName('library'));
    await trigger.click();
    const menu = page.getByRole('navigation', { name: 'Pages' });
    await expect(menu).toBeVisible();
    const entries = menu.locator('[data-page]');
    await expect(entries).toHaveCount(PAGE_IDS.length);
    expect(await entries.evaluateAll((els) => els.map((el) => el.getAttribute('data-page')))).toEqual([...PAGE_IDS]);
    await expect(menu.locator('.entry-name')).toHaveText(PAGE_IDS.map(pageName));
    await expect(menu.locator('[data-page="tech"]')).toHaveCount(0);
    await expect(menu.getByText(pageName('tech'), { exact: true })).toHaveCount(0);
    const library = menu.locator('[data-page="library"]');
    await expect(library).toHaveAttribute('aria-current', 'page');
    await expect(library.locator('ui-icon')).toHaveAttribute('data-icon', 'book');
    // The summary counts the catalog: every document, the outdated and the missing ones.
    expect(catalog.stale + catalog.missing, 'the catalog holds outdated or missing documents').toBeGreaterThan(0);
    await expect(library.locator('.sub')).toHaveText(
      template(REDIRECT_EN.shell.pages.summary.library, { docs: catalog.docs.length, stale: catalog.stale, missing: catalog.missing }),
    );
  });

  test('the palette has no Tech group or entry; the word Tech finds Open the library with its book icon, which opens it', async ({ page }) => {
    await atWorkspace(page);
    await page.keyboard.press('Meta+k');
    const palette = page.locator('app-command-palette dialog');
    await expect(palette).toBeVisible();
    // The whole index, settled: no Tech group, no Tech entry anywhere, the library action among the actions.
    await expect(palette.getByRole('listbox')).not.toHaveAttribute('aria-busy', 'true');
    await expect(palette.locator('[data-entry="action/open-library"]')).toHaveCount(1);
    await expect(palette.locator('[data-group="tech"]')).toHaveCount(0);
    await expect(palette.locator('[role="option"][data-entry^="tech"]')).toHaveCount(0);
    await expect(palette.locator('.p-group').getByText(pageName('tech'), { exact: true })).toHaveCount(0);

    await palette.getByRole('combobox').fill('tech');
    const option = palette.locator('[role="option"][data-entry="action/open-library"]');
    await expect(option).toHaveCount(1);
    await expect(option).toContainText(REDIRECT_EN.palette.actions.library);
    await expect(option.locator('ui-icon.p-lead')).toHaveAttribute('data-icon', 'book');
    await expect(palette.locator('[role="option"][data-entry^="tech"]')).toHaveCount(0);
    await expect(palette.locator('[data-group="tech"]')).toHaveCount(0);
    await option.click();
    await expect(page).toHaveURL((url) => url.pathname === PAGE);
    await expect(heading(page)).toBeVisible();
  });

  test('the shortcut sheet names g o for the Library in the workspace context and no Tech row; g o opens the Library', async ({ page }) => {
    await atWorkspace(page);
    await page.keyboard.press('?');
    const sheet = page.locator('app-shortcut-sheet dialog');
    await expect(sheet).toBeVisible();
    const row = sheet.locator('[data-context="workspace"] [data-binding="go-library"]');
    await expect(row.locator('kbd')).toHaveText(['g', 'o']);
    await expect(row.locator('.action')).toHaveText(template(REDIRECT_EN.shortcuts.actions.goTo, { target: pageName('library') }));
    await expect(sheet.locator('[data-binding*="tech"]')).toHaveCount(0);
    const techRow = template(REDIRECT_EN.shortcuts.actions.goTo, { target: pageName('tech') });
    await expect(sheet.locator('[data-binding] .action').getByText(techRow, { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await page.keyboard.press('g');
    await page.keyboard.press('o');
    await expect(page).toHaveURL((url) => url.pathname === PAGE && url.search === '' && url.hash === '');
    await expect(heading(page)).toBeVisible();
  });
});

/**
 * Code review 017, #2: the library rides the live refresh like the tech page it replaced. `r` (the same refresh as the
 * timer and "Refresh now") re-reads the catalog with the ETag of the last answer (`If-None-Match`) and the open
 * document with it; a changed catalog (here one more stale document, answered by the intercepted route) updates the
 * counts in place, without a page reload. `bun run e2e -- library -g refresh`.
 */
test.describe('refresh', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('r re-reads the catalog and the open document, and the counts change in place without a reload', async ({ page, request }) => {
    const catalog = await catalogOf(request);
    const flip = catalog.docs.find((doc) => doc.type !== 'evidence' && doc.state === 'ok' && doc.media === 'markdown');
    expect(flip, 'an ok Markdown document to turn stale').toBeDefined();
    const changed: LibraryCatalog = {
      ...catalog,
      docs: catalog.docs.map((doc) => (doc.path === flip?.path ? { ...doc, state: 'stale' } : doc)),
      stale: catalog.stale + 1,
    };

    const first = page.waitForResponse((r) => new URL(r.url()).pathname === ROUTE && r.request().method() === 'GET');
    await page.goto(PAGE);
    const etag = (await first).headers()['etag'];
    expect(etag, 'the catalog route answers with an ETag').toBeTruthy();
    await expect(control(page, 'stale').locator('[data-library-control-count]')).toHaveText(String(catalog.stale));
    await expect(page.locator('[data-library-reader] [data-library-prose]')).toBeVisible();
    await page.evaluate(() => Object.assign(window, { libraryKept: true }));

    const revalidations: Array<string | null> = [];
    await page.route(
      (url) => url.pathname === ROUTE,
      async (route) => {
        revalidations.push(route.request().headers()['if-none-match'] ?? null);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(changed) });
      },
    );
    const docRead = page.waitForRequest((r) => new URL(r.url()).pathname === `${ROUTE}/doc`);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('r');

    await expect(control(page, 'stale').locator('[data-library-control-count]')).toHaveText(String(changed.stale));
    await expect(page.locator(`[data-library-entry="${flip?.path ?? ''}"] [data-library-chip="stale"]`)).toHaveCount(1);
    await docRead;
    expect(revalidations[0]).toBe(etag);
    expect(await page.evaluate(() => (window as unknown as { libraryKept?: boolean }).libraryKept)).toBe(true);
    await expect(page.locator('[data-library-reader] [data-library-prose]')).toBeVisible();
  });
});
