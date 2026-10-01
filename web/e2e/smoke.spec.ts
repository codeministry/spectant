/**
 * ISC-19.1 (T78): WebKit, the engine of the cmux web view, renders `/` and `/w/:ws` with zero console errors.
 * `bun run e2e -- --project webkit smoke`; the same file runs on `--project chromium smoke` too.
 *
 * Each route must prove it rendered, not just answer 200: the page's own landmark and title heading are visible and
 * the first model reached the DOM (the harbor column on the overview, the spec list on the workspace dashboard); then
 * the network settles, so an error from a late request is caught too. `awaitReady` is not used: only the dev UI
 * gallery sets `body[data-ready]` so far, no app route does. Every `console` message of type `error` and every
 * uncaught `pageerror` from the first navigation on is collected and must be empty. Nothing is filtered.
 */
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';

/** Start collecting before `page.goto`, so an error thrown during bootstrap is caught as well. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  return errors;
}

const ROUTES = [
  {
    route: '/',
    rendered: async (page: Page) => {
      const overview = page.locator('[data-page="overview"]');
      await expect(overview).toBeVisible();
      await expect(overview.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(overview.locator('[data-ui="workspace-column"][data-ws="harbor"]')).toBeVisible();
    },
  },
  {
    route: '/w/harbor',
    rendered: async (page: Page) => {
      const workspace = page.locator('[data-page="workspace"]');
      await expect(workspace).toBeVisible();
      await expect(workspace.locator('h1.page-title')).toContainText('harbor');
      await expect(workspace.locator('h2#specs')).toBeVisible();
    },
  },
] as const;

test.describe('smoke', () => {
  for (const { route, rendered } of ROUTES) {
    test(`${route} renders with zero console errors`, async ({ page }) => {
      const errors = collectErrors(page);

      await page.goto(route);
      await rendered(page);
      await page.waitForLoadState('networkidle');

      expect(errors).toEqual([]);
    });
  }
});
