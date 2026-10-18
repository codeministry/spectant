/**
 * Long text cut sensibly, with "more…" (ISC-111; the principal's cmux check, 2026-10-01).
 *
 *   bun run e2e -- truncate -g table     ISC-111    Specs table descriptions
 *
 * A cut text stays within its lines, ends at a whole word of the full text with "…", and its "more…" / "less"
 * button sits outside the row link (a control inside a link is a nested interactive element). 390 px is the width
 * where the fixture goals need more than two lines.
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

async function openHarbor(page: Page): Promise<void> {
  await page.goto('/w/harbor');
  await expect(page.locator('[data-spec-row]').first()).toBeVisible();
}

test.describe('truncate table', () => {
  test.use(atWidth(390));

  test('table: a long description is cut after one line at a whole word, and more… / less toggle it in place', async ({ page }) => {
    // Spec 021 (design § P3 heights): below 640 px a marked row shows its mark where the description stood, and the
    // first five rows of harbor are all marked; the open list (`?open=specs`) holds unmarked rows with a description.
    await page.goto('/w/harbor?open=specs');
    await expect(page.locator('[data-spec-row]').first()).toBeVisible();
    const cut = page.locator('[data-panel="specs"] app-spec-row .d[data-clamp="cut"]:visible');
    await expect(cut.first()).toBeVisible();
    const id = (await cut.first().getAttribute('id'))?.replace(/^desc-/u, '') ?? '';
    // Pinned by id: the `data-clamp="cut"` locator would move on to the next cut row once this one opens.
    const description = page.locator(`#desc-${id}`);
    // spec 024: one line (principal 2026-10-13, ISC-111 refined)
    expectCutAtWord(await measure(description), 1);

    const more = page.locator(`[data-more="${id}"]`);
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toHaveAttribute('aria-controls', `desc-${id}`);
    await expect(page.locator('.row-link [data-more]')).toHaveCount(0);

    await more.click();
    await expect(description).toHaveAttribute('data-clamp', 'open');
    const open = await measure(description);
    expect(open.shown).toBe(open.full);
    // spec 024: one line (principal 2026-10-13, ISC-111 refined)
    expect(open.height).toBeGreaterThan(open.line * 1 + 1);
    await expect(more).toHaveAttribute('aria-expanded', 'true');

    await more.click();
    await expect(description).toHaveAttribute('data-clamp', 'cut');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  test('table: every cut description has its button, and a description that fits has none', async ({ page }) => {
    await openHarbor(page);
    const descriptions = page.locator('[data-panel="specs"] app-spec-row .d');
    await expect(descriptions.first()).toHaveAttribute('data-clamp', /cut|whole/u);
    for (const d of await descriptions.all()) {
      const id = (await d.getAttribute('id'))?.replace(/^desc-/u, '') ?? '';
      const state = await d.getAttribute('data-clamp');
      // Spec 021 (design § P3 heights): the title is one line too, and the row's one "more…" opens both, so a row
      // offers it when its title or its description is cut.
      const title = await page.locator(`#rl-${id}`).getAttribute('data-clamp');
      await expect(page.locator(`[data-more="${id}"]`)).toHaveCount(state === 'cut' || title === 'cut' ? 1 : 0);
    }
  });
});

/**
 * Since spec 020 (T25, ISC-240) Next up holds `guidance.next`, whose harbor titles fit their lines, and the entry's
 * sentence is never cut. So the dashboard body's first Next entry gets a longer title (its own title twice), the one
 * change to core's body, and the title clamp still has something to cut.
 */
async function longNextTitle(page: Page): Promise<void> {
  await page.route('**/api/workspaces/harbor/dashboard', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { specs: Array<{ id: string; title: string }>; guidance?: { next: Array<{ spec: string }> } };
    const id = body.guidance?.next[0]?.spec;
    for (const spec of body.specs) if (spec.id === id) spec.title = `${spec.title}, then ${spec.title.toLowerCase()}`;
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

  test('next: a long rail card title is cut after one line at a whole word, and more… / less outside the link toggle it', async ({
    page,
  }) => {
    await longNextTitle(page);
    await openHarbor(page);
    await expectWholeSentences(page);
    const cut = page.locator('[data-next-card] [data-next-link] .title[data-clamp="cut"]');
    await expect(cut.first()).toBeVisible();
    const id = (await cut.first().getAttribute('id')) ?? '';
    const title = page.locator(`#${id}`);
    // Spec 021 (T79): the rail title is clamped to one line, and `[data-next-card]` is the one card of every entry.
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
    await openHarbor(page);
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
    await openHarbor(page);
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
