/**
 * Long text cut sensibly (ISC-111; the principal's cmux check, 2026-10-01).
 *
 *   bun run e2e -- truncate -g table     ISC-111    Specs list titles
 *   bun run e2e -- truncate -g next      ISC-546    Next up titles, rows of the spec list (spec 068)
 *
 * In the Specs list a spec row shows its title alone, one line cut by a CSS ellipsis like an idea row's, with no
 * description and no "more…" toggle; 390 px is a width where harbor's longer titles are cut. Since spec 068 Next up
 * renders the same rows, so its titles are cut the same way and have no "more…" / "less" (ISC-111.1 dropped). In the
 * palette a cut text stays within its lines and ends at a whole word of the full text with "…".
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';
import { SIDEBAR_HEADER, STUB_SIDEBAR } from './stub-api';

const ELLIPSIS = '…';

/** The rendered text, its full text (the `title`), its height and its line height. */
async function measure(el: Locator): Promise<{ shown: string; full: string; height: number; line: number }> {
  return el.evaluate((node) => ({
    shown: node.textContent,
    full: node.getAttribute('title') ?? '',
    height: node.getBoundingClientRect().height,
    line: Number.parseFloat(getComputedStyle(node).lineHeight),
  }));
}

/** A cut text: at most `lines` lines, "…" at the end, and what precedes it is the full text up to a word break. */
function expectCutAtWord(m: { shown: string; full: string; height: number; line: number }, lines: number): void {
  expect(m.shown.endsWith(ELLIPSIS)).toBe(true);
  expect(m.height).toBeLessThanOrEqual(m.line * lines + 1);
  const kept = m.shown.slice(0, -ELLIPSIS.length);
  expect(m.full.startsWith(kept)).toBe(true);
  // The next character of the full text after the kept part is a break or punctuation, never a letter of the same word.
  expect(m.full.slice(kept.length)).toMatch(/^[\s,;:.–—-]/u);
}

/** Harbor's Specs page (spec 058: the spec list's own page), once its rows rendered. */
async function openSpecs(page: Page): Promise<void> {
  await page.goto('/w/harbor/specs');
  await expect(page.locator('[data-spec-row]').first()).toBeVisible();
}

/** Harbor's dashboard (spec 058: no spec list), once its Next up entries rendered. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/w/harbor');
  await expect(page.locator('[data-next-link]').first()).toBeVisible();
}

test.describe('truncate table', () => {
  test.use(atWidth(390));

  test('table: a long spec title is one line cut by an ellipsis, with no description and no more… toggle in the list', async ({ page }) => {
    await openSpecs(page);
    const links = page.locator('[data-panel="specs"] a.row-link[data-spec-row]');
    // At 390 px the title column is about 230 px wide, so harbor's longer titles are cut.
    const rows = await links.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          id: node.getAttribute('data-spec-row') ?? '',
          shown: node.textContent.trim(),
          full: (node.getAttribute('title') ?? '').split('\n')[0] ?? '',
          cut: node.scrollWidth > node.clientWidth,
          height: node.getBoundingClientRect().height,
          line: Number.parseFloat(style.lineHeight),
          overflow: style.textOverflow,
          wrap: style.whiteSpace,
        };
      }),
    );
    expect(rows.some((row) => row.cut), 'a cut title').toBe(true);
    for (const row of rows) {
      // The whole title is in the link (CSS cuts it, not the text), and its tooltip names it in full.
      expect(row.shown, row.id).toBe(row.full);
      expect(row.overflow, row.id).toBe('ellipsis');
      expect(row.wrap, row.id).toBe('nowrap');
      expect(row.height, `${row.id}: one line`).toBeLessThanOrEqual(row.line + 1);
    }
    await expect(page.locator('[data-panel="specs"] :is([data-more], .row-more, app-spec-row .d, [id^="desc-"], [data-cell="more"])')).toHaveCount(0);
  });
});

/**
 * Spec 068 (T4, ISC-546): each Next up entry is a row of the spec list (`app-spec-row[data-next-row]`) whose title is
 * the row link `a[data-next-link]`, one line cut by a CSS ellipsis like a spec row's; there is no "more…" / "less"
 * (ISC-111.1 dropped) and no visible reason line, the reason being only the link's hidden description. The sidebar
 * fixture gives harbor 003 a 200-character title, which Next up's title column holds on one line at no width.
 */
for (const width of [390, 820, 1440] as const) {
  test.describe(`truncate next at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`next: a long Next up title is one line ending in an ellipsis like a spec row's, with no more… toggle at ${String(width)} px`, async ({
      page,
    }) => {
      await page.setExtraHTTPHeaders({ [SIDEBAR_HEADER]: 'on' });
      await openDashboard(page);
      const links = page.locator('[data-next-card] app-spec-row[data-next-row] [data-cell="title"] a[data-next-link]');
      const rows = await links.evaluateAll((nodes) =>
        nodes.map((node) => {
          const style = getComputedStyle(node);
          return {
            id: node.closest('[data-next-entry]')?.getAttribute('data-next-entry') ?? '',
            shown: node.textContent.trim(),
            full: (node.getAttribute('title') ?? '').split('\n')[0] ?? '',
            cut: node.scrollWidth > node.clientWidth,
            height: node.getBoundingClientRect().height,
            line: Number.parseFloat(style.lineHeight),
            overflow: style.textOverflow,
            wrap: style.whiteSpace,
          };
        }),
      );
      const long = rows.find((row) => row.id === STUB_SIDEBAR.spec);
      // The whole 200-character title is in the link (CSS cuts it, not the text), and it overflows its one line.
      expect(long?.shown, `Next up shows ${STUB_SIDEBAR.spec}'s whole title`).toBe(STUB_SIDEBAR.title);
      expect(long?.cut, `${STUB_SIDEBAR.spec}: cut`).toBe(true);
      for (const row of rows) {
        // The tooltip's first line names the title in full, as a spec row's does.
        expect(row.shown, row.id).toBe(row.full);
        expect(row.overflow, row.id).toBe('ellipsis');
        expect(row.wrap, row.id).toBe('nowrap');
        expect(row.height, `${row.id}: one line`).toBeLessThanOrEqual(row.line + 1);
      }
      // No clamp and no toggle, no visible reason line, no entry component of its own.
      await expect(page.locator('[data-next-card] :is([data-next-more], [data-next-sentence], [data-clamp], app-next-up-entry)')).toHaveCount(0);
      await expect(page.locator('[data-next-card] [data-next-reason]:visible')).toHaveCount(0);
    });
  });
}

test.describe('truncate palette', () => {
  test.use(atWidth(1440));

  test('palette: other options stay one line cut at a whole word, the highlighted one shows its full text, no control inside an option', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await openDashboard(page);
    await page.keyboard.press('Meta+k');
    const palette = page.locator('app-command-palette dialog');
    await expect(palette).toBeVisible();
    const options = palette.locator('[role="option"]');
    await expect(options.first()).toBeVisible();

    // Nothing interactive nests inside an option; its accessible name carries the full label and meta.
    await expect(palette.locator('[role="option"] :is(a, button, input, select, textarea, [tabindex])')).toHaveCount(0);

    // Every cut text outside the highlighted option: one line, cut at a whole word.
    const cutInactive = palette.locator('[role="option"][aria-selected="false"] [data-clamp="cut"]');
    await expect(cutInactive.first()).toBeVisible();
    for (const t of await cutInactive.all()) expectCutAtWord(await measure(t), 1);

    // Highlight a cut option: its label and meta show whole, within three lines.
    const target = palette.locator('[role="option"]').filter({ has: page.locator('[data-clamp="cut"]') }).first();
    const targetId = (await target.getAttribute('id')) ?? '';
    await expect(target).toHaveAttribute('aria-label', /\S/u);
    await target.hover();
    await expect(page.locator(`#${targetId}`)).toHaveAttribute('aria-selected', 'true');
    const texts = page.locator(`#${targetId} [data-clamp]`);
    for (const t of await texts.all()) {
      await expect(t).not.toHaveAttribute('data-clamp', 'cut');
      const m = await measure(t);
      expect(m.shown).toBe(m.full);
      expect(m.height).toBeLessThanOrEqual(m.line * 3 + 1);
    }
  });
});
