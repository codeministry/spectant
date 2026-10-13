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
 * 002, a stale plan, a missing design.md, a prototype) and `src/i18n/en.json`, never a literal count.
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
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import type { LibraryCatalog, LibraryDoc } from '../../core/src/files';
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
    // The page names a command only for plan.md and tasks.md (T30); the stub's missing document is a design.md.
    const command = missing.type === 'plan' || missing.type === 'tasks' ? `/spec-${missing.type} ${keyOf(missing.spec)}` : null;
    if (command === null) await expect(empty.locator('ui-command-chip')).toHaveCount(0);
    else await expect(empty.locator('ui-command-chip')).toContainText(command);
  });
});
