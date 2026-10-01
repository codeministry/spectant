/**
 * The theme e2e cases (`bun run e2e -- theme -g <name>`), one describe per claim:
 *
 * - "theme system" (ISC-18.1, T75): in the default system mode the theme follows `prefers-color-scheme`, set before
 *   the load and changed while the page is open, with no reload.
 * - "theme persist" (ISC-18.3, T76): a light or dark mode chosen through the app's own control (the palette's theme
 *   action) is stored through `PUT /api/settings` and still applied when the app loads again on another port, under
 *   the opposite system scheme, so neither `localStorage` nor `prefers-color-scheme` can be what carries it.
 *
 * Every test runs in its own stub session (`X-Spectant-Stub-Session`, reset afterwards), so the stub answers
 * `/api/settings` with the schema default `theme: 'system'` and a mode another test stores never leaks in.
 *
 * The assertions read what the theme actually is, not the media query: the `data-theme` the app writes on `<html>`,
 * the `color-scheme` that theme declares, and the computed page background the theme's tokens resolve to, whose
 * OKLCH lightness separates the two themes.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const sessionOf = (testId: string): string => `theme-${testId}`;

type Scheme = 'light' | 'dark';

/** What the page is painted in: the theme attribute, the theme's declared colour scheme, the background lightness. */
interface Painted {
  readonly theme: string | null;
  readonly colorScheme: string;
  readonly lightness: number;
}

/**
 * Reads the theme off the live page. The background is `<html>`'s computed colour (daisyUI paints the theme element
 * with its base colour), converted to OKLCH lightness in the page so the probe holds whatever colour syntax the
 * engine serialises.
 */
function painted(page: Page): Promise<Painted> {
  return page.evaluate(() => {
    const html = document.documentElement;
    const style = getComputedStyle(html);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context to resolve the background colour');
    context.fillStyle = style.backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
    if (a === 0) throw new Error(`the page background is transparent (${style.backgroundColor})`);
    const linear = (c: number): number => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
    // OKLab's L from linear sRGB (Björn Ottosson's matrices).
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    return { theme: html.getAttribute('data-theme'), colorScheme: style.colorScheme, lightness };
  });
}

/** The page shows `scheme`'s theme: attribute, declared colour scheme, and a light or dark computed background. */
async function expectTheme(page: Page, scheme: Scheme): Promise<void> {
  await expect.poll(() => painted(page).then((p) => p.theme)).toBe(`spec-${scheme}`);
  const now = await painted(page);
  expect(now.colorScheme).toBe(scheme);
  if (scheme === 'dark') expect(now.lightness).toBeLessThan(0.5);
  else expect(now.lightness).toBeGreaterThan(0.85);
}

/**
 * Loads `url` (default `/` on the base origin) and waits until the app has booted: bootstrap waits for
 * `/api/settings`, so the shell means it answered. `stored` is the mode that answer must carry.
 */
async function open(page: Page, url = '/', stored: 'system' | Scheme = 'system'): Promise<void> {
  const settings = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'GET');
  await page.goto(url);
  const answer = await settings;
  expect(((await answer.json()) as { theme: string }).theme).toBe(stored);
  await expect(page.locator('[data-control="brand"]')).toBeVisible();
}

test.describe('theme system', () => {
  test.beforeEach(async ({ page }, info) => {
    await page.setExtraHTTPHeaders({ [SESSION]: sessionOf(info.testId) });
  });
  test.afterEach(async ({ request }, info) => {
    await request.post('/api/__stub/reset', { headers: { [SESSION]: sessionOf(info.testId) } });
  });

  test('theme system: the scheme set before the load picks the matching theme', async ({ page }) => {
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await expectTheme(page, scheme);
    }
  });

  test('theme system: a scheme change while the page is open flips the theme live, with no reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page);
    await expectTheme(page, 'light');

    // A marker on the live document: a reload would drop it.
    await page.evaluate(() => document.documentElement.setAttribute('data-e2e-same-document', ''));

    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'light');

    await expect(page.locator('html[data-e2e-same-document]')).toHaveCount(1);
  });
});

/**
 * The same server on a second loopback port. The Playwright config serves one origin, and a second stub process would
 * hold a second, empty settings store, so the browser loads the app from `base`'s port + 2 and every request to that
 * origin is answered by the server behind `base`, in the test's stub session. For the browser it is another origin
 * (its own `localStorage`, cookies and cache); for the server it is the same store, as for the binary started again
 * on another port over the same SQLite file.
 */
async function secondPort(page: Page, base: URL, session: string): Promise<URL> {
  const alt = new URL(base.origin);
  alt.port = String(Number(base.port) + 2);
  await page.route(`${alt.origin}/**`, async (route) => {
    const target = new URL(route.request().url());
    target.host = base.host;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(route.request().headers())) {
      if (name !== 'host' && name !== SESSION.toLowerCase()) headers[name] = value;
    }
    headers[SESSION] = session;
    await route.fulfill({ response: await route.fetch({ url: target.href, headers }) });
  });
  return alt;
}

/** Chooses `mode` through the app's own theme control, the palette's theme action, and waits until it is stored. */
async function choose(page: Page, mode: Scheme): Promise<void> {
  await expect(page.locator('header [data-control="palette"]')).toBeVisible();
  const stored = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT');
  await page.keyboard.press('Meta+k');
  const palette = page.locator('app-command-palette dialog');
  await expect(palette).toBeVisible();
  await palette.locator('[role="option"][data-entry="action/theme"]').click();
  const put = await stored;
  expect(put.status()).toBe(200);
  expect(put.request().postDataJSON()).toEqual({ theme: mode });
  expect(((await put.json()) as { theme: string }).theme).toBe(mode);
}

test.describe('theme persist', () => {
  test.beforeEach(async ({ page }, info) => {
    await page.setExtraHTTPHeaders({ [SESSION]: sessionOf(info.testId) });
  });
  test.afterEach(async ({ request }, info) => {
    await request.post('/api/__stub/reset', { headers: { [SESSION]: sessionOf(info.testId) } });
  });

  for (const chosen of ['light', 'dark'] as const) {
    const system: Scheme = chosen === 'dark' ? 'light' : 'dark';

    test(`theme persist: a chosen ${chosen} mode survives a reload on another port under a ${system} system`, async ({
      page,
      baseURL,
    }, info) => {
      // The palette's theme action flips the resolved theme, so starting from the opposite scheme chooses `chosen`.
      await page.emulateMedia({ colorScheme: system });
      await open(page);
      await expectTheme(page, system);

      await choose(page, chosen);
      await expectTheme(page, chosen);

      if (baseURL === undefined) throw new Error('the theme persist cases need a baseURL');
      const alt = await secondPort(page, new URL(baseURL), sessionOf(info.testId));
      await open(page, `${alt.origin}/`, chosen);
      expect(new URL(page.url()).origin).toBe(alt.origin);
      // The system still prefers the opposite scheme there: only the stored mode can paint `chosen`.
      expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(system === 'dark');
      await expectTheme(page, chosen);
    });
  }
});
