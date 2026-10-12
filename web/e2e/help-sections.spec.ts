/**
 * Spec 008: the Help page's sections against the stub API (T162, ISC-133.1). `bun run e2e -- help-sections`.
 *
 * At 1440 and 390: the sticky nav has one chip per section, each a same-page link that lands on its section and
 * focuses its heading; the sections stand in nav order; "How a spec moves" shows the stage chain of the default
 * feature row after `idea`; the Commands table lists the stage table's commands; the Keyboard list equals the `?`
 * sheet's entries (ids and text); the page never overflows sideways. The expected values come from core and the
 * shortcut table, the words from the English catalogue.
 */
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { DEFAULT_WORKFLOW, STAGE_RULES } from '../../core/src/stage';
import { atWidth, expect, test } from './fixtures';

interface Catalogue {
  readonly stages: Readonly<Record<string, string>>;
  readonly help: { readonly nav: Readonly<Record<string, string>> };
}
const en = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as Catalogue;

const SECTIONS = [
  ['about', 'about'],
  ['moves', 'moves'],
  ['workflows', 'workflows'],
  ['commands', 'commands'],
  ['glossary', 'glossary'],
  ['start', 'gettingStarted'],
  ['keys', 'keyboard'],
] as const;
const CHAIN = ['idea', ...(DEFAULT_WORKFLOW.find((row) => row.type === 'feature')?.stages ?? [])];
const COMMANDS = [...new Set(STAGE_RULES.map((rule) => rule.next).filter((next): next is string => next !== null))];

const help = (page: Page) => page.locator('[data-page="help"]');
const rowsOf = (page: Page, scope: string) =>
  page.locator(`${scope} [data-binding]`).evaluateAll((rows) =>
    rows.map((row) => [row.getAttribute('data-binding'), row.textContent.replace(/\s+/g, ' ').trim()]),
  );

for (const width of [1440, 390]) {
  test.describe(`help sections at ${width}`, () => {
    test.use(atWidth(width));

    test('the nav links every section, in order, and a chip focuses its heading', async ({ page }) => {
      await page.goto('/help?ws=lantern');
      const chips = help(page).locator('nav[data-help-nav] a[data-help-chip]');
      await expect(chips).toHaveText(SECTIONS.map(([, key]) => en.help.nav[key] ?? ''));
      expect(await chips.evaluateAll((els) => els.map((el) => el.getAttribute('href')))).toEqual(SECTIONS.map(([id]) => `/help?ws=lantern#${id}`));
      const sections = help(page).locator(':scope > section[aria-labelledby]');
      expect(await sections.evaluateAll((els) => els.map((el) => el.id))).toEqual(SECTIONS.map(([id]) => id));
      await expect(chips.first()).toHaveAttribute('aria-current', 'true');

      await chips.filter({ hasText: en.help.nav['commands'] ?? '' }).click();
      await expect(page).toHaveURL(/\/help\?ws=lantern#commands$/);
      await expect(page.locator('#help-commands')).toBeFocused();
      await expect(page.locator('#help-commands')).toBeInViewport();
      await expect(chips.filter({ hasText: en.help.nav['commands'] ?? '' })).toHaveAttribute('aria-current', 'true');
      // The nav stays under the header while the page scrolls.
      await expect(help(page).locator('nav[data-help-nav]')).toBeInViewport();
      // `?ws=` and the workflow it picks are kept.
      await expect(page.locator('select[data-workflow-workspace]')).toHaveValue('lantern');
    });

    test('shows the stage chain, the Commands table and the type chips', async ({ page }) => {
      await page.goto('/help');
      await expect(page.locator('#moves [data-stage-chain] .pill')).toHaveText(CHAIN.map((stage) => en.stages[stage] ?? ''));
      await expect(page.locator('#moves [data-stage-chain] ui-icon')).toHaveCount(CHAIN.length - 1);
      await expect(page.locator('#commands [data-commands] tbody tr')).toHaveCount(COMMANDS.length);
      await expect(page.locator('#commands [data-commands] tbody ui-command-chip code')).toHaveText(COMMANDS);

      await page.locator('#moves [data-type-chip="chore"]').click();
      await expect(page.locator('figure[data-workflow-figure="chore"]')).toBeFocused();
      await expect(page.locator('figure[data-workflow-figure="chore"]')).toBeInViewport();
    });

    test('the Keyboard list equals the ? sheet entries', async ({ page }) => {
      await page.goto('/help');
      await expect(page.locator('#keys [data-binding]').first()).toBeVisible();
      const listed = await rowsOf(page, '#keys');
      expect(listed.length).toBeGreaterThan(0);
      await page.locator('#help').focus();
      await page.keyboard.press('?');
      await expect(page.locator('app-shortcut-sheet dialog')).toBeVisible();
      expect(await rowsOf(page, 'app-shortcut-sheet dialog')).toEqual(listed);
    });

    test('never scrolls the page sideways', async ({ page }) => {
      await page.goto('/help?ws=harbor');
      await expect(page.locator('figure[data-workflow-figure]')).toHaveCount(7);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
    });
  });
}
