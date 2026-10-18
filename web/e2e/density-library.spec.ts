/**
 * Spec 021 (density and readability), the library reader: a long document reads on one picture, each `##` behind a
 * disclosure whose open state is in the address. Every title starts with "density library", so `-g library` runs both
 * groups below and `-g library-height` the height group alone.
 *
 * - library (T54 · ISC-251, `bun run e2e -- density -g library`): against the dense stub (`DENSE_HEADER: on`) the long
 *   document of `STUB_DENSE.doc` (20 `##` sections, about 30 screens expanded) opens with its first section open and
 *   every other one collapsed to its heading and first sentence; opening a section writes `open=s-<id>` into the
 *   address and a reload keeps it; a jump from "On this page" to a collapsed section opens it and lands on it; the
 *   same address opens the same sections at 390 × 844 and at 1440 × 900.
 * - library-height (T55 · ISC-251.1, `bun run e2e -- density -g library-height`): in that default state at 1440 × 900
 *   the reader, measured from the top of the page to its bottom edge, is at most three screens (3 × 900 px) tall, and
 *   so is the page's own scroll height.
 *
 * Expected headings and first sentences come from the served document (core's render of the stub's text), never from
 * a literal copy of it.
 */
import type { Browser, Locator, Page } from '@playwright/test';
import type { DocsPage } from '../../core/src/files';
import { workspaceRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, test } from './fixtures';
import { DENSE_HEADER, STUB_DENSE } from './stub-api';

const WS = STUB_DENSE.workspace.slug;
const DOC = STUB_DENSE.doc;
/** The reference window of ISC-251 and ISC-251.1. */
const SCREEN = { width: 1440, height: 900 } as const;
/** The two windows the same document must open the same in. */
const WIDTHS = [390, 1440] as const;

const READER = '[data-library-reader]';
const SECTION = `${READER} [data-library-section]`;

/** One `##` of the served document: its id, heading and the first sentence of its first paragraph. */
interface Expected {
  readonly id: string;
  readonly heading: string;
  readonly sentence: string;
}

/** Collapsed whitespace and no tags: a paragraph's text as the page renders it. */
const text = (html: string): string =>
  html
    .replace(/<[^>]*>/gu, '')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();

/** The served document's `##` sections, read from the stub's document route under the dense header. */
async function expectedSections(page: Page): Promise<readonly Expected[]> {
  const answer = await page.request.get(workspaceRoutes.libraryDoc(WS, DOC.path), { headers: { [DENSE_HEADER]: 'on' } });
  expect(answer.status()).toBe(200);
  const served = (await answer.json()) as DocsPage;
  const level2 = served.sections.filter((s) => s.level === 2);
  // The fixture must hold the case, or the assertions below prove nothing.
  expect(level2).toHaveLength(DOC.sections);
  return level2.map((section) => {
    const after = served.html.split(new RegExp(`<h2[^>]*id="${section.id}"[^>]*>`, 'u'))[1] ?? '';
    const paragraph = text(/<p>([\s\S]*?)<\/p>/u.exec(after)?.[1] ?? '');
    const sentence = paragraph.split(/(?<=\.)\s(?=\p{Lu})/u)[0] ?? '';
    if (sentence.length < 20) throw new Error(`density-library: section ${section.id} has no first sentence`);
    return { id: section.id, heading: section.heading, sentence };
  });
}

/** The `open` keys in the page's address, in order. */
function openKeys(page: Page): string[] {
  const value = new URL(page.url()).searchParams.get('open');
  return value === null || value === '' ? [] : value.split(',');
}

/** Open the long document under the dense header and wait until its sections are drawn. */
async function openDoc(page: Page, query = ''): Promise<void> {
  await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on' });
  await page.goto(`/w/${WS}/library${query}#${DOC.path}`);
  await expect(page.locator(SECTION)).toHaveCount(DOC.sections);
}

const section = (page: Page, id: string): Locator => page.locator(`${SECTION}[data-library-section="${id}"]`);
const toggleOf = (page: Page, id: string): Locator => section(page, id).locator(':scope > .head h2.heading button.summary');

/** Each section's expanded state, in document order. */
const expandedStates = (page: Page): Promise<boolean[]> =>
  page
    .locator(`${SECTION} > .head h2.heading button.summary`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-expanded') === 'true'));

/** Open the document in a fresh window of `width` and return its sections' expanded states. */
async function statesAt(browser: Browser, width: (typeof WIDTHS)[number], query: string): Promise<boolean[]> {
  const context = await browser.newContext(atWidth(width));
  try {
    const page = await context.newPage();
    await openDoc(page, query);
    await expect(page.locator(`${SECTION} > .head h2.heading button.summary`).first()).toBeVisible();
    return await expandedStates(page);
  } finally {
    await context.close();
  }
}

test.describe('density library at 1440', () => {
  test.use(atWidth(SCREEN.width));

  test('density library collapsed sections show their heading and first sentence', async ({ page }) => {
    const expected = await expectedSections(page);
    await openDoc(page);
    for (const [index, want] of expected.entries()) {
      const part = section(page, want.id);
      await expect(part.locator(':scope > .head h2.heading')).toHaveText(want.heading);
      if (index === 0) continue;
      await expect(toggleOf(page, want.id)).toHaveAttribute('aria-expanded', 'false');
      // Collapsed: the heading and the first sentence, whole and alone; the body stays out of reach.
      const sentence = part.locator(':scope > .lib-section-sentence');
      await expect(sentence).toBeVisible();
      await expect(sentence).toHaveText(want.sentence);
      await expect(part.locator(':scope > .region')).toHaveAttribute('inert', '');
      await expect(part.locator(':scope > .region .lib-section-body')).toBeHidden();
    }
  });

  test('density library long document opens collapsed except its first section', async ({ page }) => {
    const expected = await expectedSections(page);
    await openDoc(page);
    expect(await expandedStates(page)).toEqual(expected.map((_, index) => index === 0));
    const first = expected[0];
    if (first === undefined) throw new Error('density-library: no first section');
    await expect(section(page, first.id).locator(':scope > .region .lib-section-body')).toBeVisible();
    await expect(section(page, first.id).locator(':scope > .lib-section-sentence')).toHaveCount(0);
  });

  test('density library opening a section writes open=s-<id> and a reload keeps it', async ({ page }) => {
    const expected = await expectedSections(page);
    await openDoc(page);
    const target = expected[4];
    if (target === undefined) throw new Error('density-library: fewer than five sections');
    expect(openKeys(page)).not.toContain(`s-${target.id}`);

    await toggleOf(page, target.id).click();
    await expect(toggleOf(page, target.id)).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(() => openKeys(page), { message: `open=s-${target.id} in the address` }).toContain(`s-${target.id}`);
    const before = await expandedStates(page);
    expect(before.filter(Boolean)).toHaveLength(2);
    expect(new URL(page.url()).hash).toBe(`#${DOC.path}`);

    await page.reload();
    await expect(page.locator(SECTION)).toHaveCount(DOC.sections);
    await expect(toggleOf(page, target.id)).toHaveAttribute('aria-expanded', 'true');
    expect(await expandedStates(page)).toEqual(before);
    expect(openKeys(page)).toContain(`s-${target.id}`);
  });

  test('density library a contents jump opens a collapsed section and lands on it', async ({ page }) => {
    const expected = await expectedSections(page);
    await openDoc(page);
    const target = expected[15];
    if (target === undefined) throw new Error('density-library: fewer than sixteen sections');
    await expect(toggleOf(page, target.id)).toHaveAttribute('aria-expanded', 'false');

    const entry = page.locator(`${READER} nav.docs-toc .docs-toc-list a[href="#${target.id}"]`);
    await expect(entry).toHaveText(target.heading);
    await entry.click();

    await expect(toggleOf(page, target.id)).toHaveAttribute('aria-expanded', 'true');
    await expect(section(page, target.id).locator(':scope > .region .lib-section-body')).toBeVisible();
    await expect
      .poll(() => toggleOf(page, target.id).evaluate((el) => el === document.activeElement), { message: 'focus on the opened section' })
      .toBe(true);
    await expect(section(page, target.id).locator(':scope > .head')).toBeInViewport();
    await expect.poll(() => openKeys(page)).toContain(`s-${target.id}`);
    expect(new URL(page.url()).hash).toBe(`#${DOC.path}`);
  });
});

test.describe('density library across windows', () => {
  test('density library opens the same sections at 390 and 1440', async ({ browser }) => {
    const ids = (await (async () => {
      const context = await browser.newContext(atWidth(SCREEN.width));
      try {
        return (await expectedSections(await context.newPage())).map((s) => s.id);
      } finally {
        await context.close();
      }
    })()) as readonly string[];
    // The default state, and an address naming two sections open.
    const named = `?open=s-${ids[2] ?? ''},s-${ids[9] ?? ''}`;
    for (const query of ['', named]) {
      const [narrow, wide] = [await statesAt(browser, WIDTHS[0], query), await statesAt(browser, WIDTHS[1], query)];
      expect(narrow, `same open sections at 390 and 1440 for "${query}"`).toEqual(wide);
      expect(wide).toEqual(ids.map((_, index) => (query === '' ? index === 0 : index === 2 || index === 9)));
    }
  });
});

test.describe('density library-height at 1440', () => {
  test.use(atWidth(SCREEN.width));

  test('density library-height the long document is at most three screens tall by default', async ({ page }) => {
    await openDoc(page);
    await expect(page.locator(`${SECTION} > .head h2.heading button.summary`).first()).toHaveAttribute('aria-expanded', 'true');
    // Measured: the reader's bottom edge from the top of the page (scrolled to the top), and the page's own scroll height.
    const measured = await page.locator(READER).evaluate((el) => {
      window.scrollTo(0, 0);
      return { reader: Math.ceil(el.getBoundingClientRect().bottom + window.scrollY), page: document.documentElement.scrollHeight };
    });
    test.info().annotations.push({ type: 'measured', description: `reader bottom ${measured.reader} px, page scroll height ${measured.page} px (limit ${3 * SCREEN.height} px)` });
    console.log(`density library-height: reader bottom ${measured.reader} px, page scroll height ${measured.page} px, ${(measured.reader / SCREEN.height).toFixed(2)} screens`);
    expect(measured.reader).toBeLessThanOrEqual(3 * SCREEN.height);
    expect(measured.page).toBeLessThanOrEqual(3 * SCREEN.height);
  });
});
