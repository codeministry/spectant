/**
 * Long text cut sensibly (ISC-111; the principal's cmux check, 2026-10-01).
 *
 *   bun run e2e -- truncate -g table     ISC-111    Specs list titles
 *
 * In the Specs list a spec row shows its title alone, one line cut by a CSS ellipsis like an idea row's, with no
 * description and no "more…" toggle; 390 px is a width where harbor's longer titles are cut. Elsewhere a cut text stays
 * within its lines, ends at a whole word of the full text with "…", and its "more…" / "less" button sits outside the
 * link (a control inside a link is a nested interactive element).
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';

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
 * Since spec 020 (T25, ISC-240) Next up holds `guidance.next`, whose harbor titles fit their lines, and the entry's
 * sentence is never cut. So the dashboard body's first Next entry gets a longer title (its own title four times), the
 * one change to core's body, and the title clamp still has something to cut: since spec 058 Next up spans the one
 * column of the dashboard, about 1376 px at 1440, where the title twice still fits its line.
 */
const LONG_TITLE_REPEATS = 4;
async function longNextTitle(page: Page): Promise<void> {
  await page.route('**/api/workspaces/harbor/dashboard', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { specs: Array<{ id: string; title: string }>; guidance?: { next: Array<{ spec: string }> } };
    const id = body.guidance?.next[0]?.spec;
    for (const spec of body.specs) {
      if (spec.id === id) spec.title = [spec.title, ...Array.from({ length: LONG_TITLE_REPEATS - 1 }, () => spec.title.toLowerCase())].join(', then ');
    }
    await route.fulfill({ response, json: body });
  });
}

/** The entry's guidance sentence stands whole: no ellipsis, nothing hidden. */
async function expectWholeSentences(page: Page): Promise<void> {
  const sentences = page.locator('[data-next-sentence]');
  await expect(sentences.first()).toBeVisible();
  for (const sentence of await sentences.all()) {
    const m = await sentence.evaluate((node) => ({ text: node.textContent, fits: node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1 }));
    expect(m.text.endsWith(ELLIPSIS)).toBe(false);
    expect(m.fits).toBe(true);
  }
}

test.describe('truncate next', () => {
  test.use(atWidth(1440));

  test('next: a long title in the one-column Next up is cut after one line at a whole word, and more… / less outside the link toggle it', async ({
    page,
  }) => {
    await longNextTitle(page);
    await openDashboard(page);
    await expectWholeSentences(page);
    const cut = page.locator('[data-next-card] [data-next-link] .title[data-clamp="cut"]');
    await expect(cut.first()).toBeVisible();
    const id = (await cut.first().getAttribute('id')) ?? '';
    const title = page.locator(`#${id}`);
    // Spec 021 (T79): the title is clamped to one line, and `[data-next-card]` is the one card of every entry; since
    // spec 058 the dashboard has no rail, so at 1440 the entry is a row of the one column's card.
    expectCutAtWord(await measure(title), 1);

    const entry = page.locator('app-next-up-entry').filter({ has: title });
    const more = entry.locator('[data-next-more]');
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('aria-controls', id);
    await expect(page.locator('[data-next-link] [data-next-more]')).toHaveCount(0);

    await more.click();
    await expect(title).toHaveAttribute('data-clamp', 'open');
    const open = await measure(title);
    expect(open.shown).toBe(open.full);
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await more.click();
    await expect(title).toHaveAttribute('data-clamp', 'cut');
  });

  test('next: below wide the one-line row title is cut at a whole word with its own more…', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await longNextTitle(page);
    await openDashboard(page);
    await expectWholeSentences(page);
    const titles = page.locator('[data-next-row] [data-next-link] .title');
    await expect(titles.first()).toBeVisible();
    for (const t of await titles.all()) {
      const m = await measure(t);
      if ((await t.getAttribute('data-clamp')) === 'cut') expectCutAtWord(m, 1);
      else expect(m.shown).toBe(m.full);
    }
    await expect(page.locator('[data-next-row] .title[data-clamp="cut"]').first()).toBeVisible();
  });
});

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
