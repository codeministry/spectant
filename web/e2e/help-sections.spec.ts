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

import { STAGE_RULES } from '../../core/src/stage';
import { atWidth, expect, test } from './fixtures';

interface Catalogue {
  readonly stages: Readonly<Record<string, string>>;
  readonly help: { readonly nav: Readonly<Record<string, string>>; readonly lifecycle: { readonly steps: Readonly<Record<string, string>> } };
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
/** Every step of the lifecycle in order; the optional ones (design, code review, archive) carry "(optional)". */
const CHAIN: ReadonlyArray<readonly [string, boolean]> = [
  ['idea', false],
  ['design', true],
  ['plan', false],
  ['tasks', false],
  ['review', false],
  ['build', false],
  ['code-review', true],
  ['close', false],
  ['done', false],
  ['archive', true],
];
const chainText = ([step, optional]: readonly [string, boolean]): string =>
  `${en.stages[step] ?? en.help.lifecycle.steps[step] ?? ''}${optional ? ' (optional)' : ''}`;
/** The lifecycle's commands in the plugin form: `/spec idea`, every node's, then the stage table's bare `/spec NNN`. */
const COMMANDS = [
  '/spec idea',
  '/spec new <slug>',
  '/spec plan',
  '/spec plan NNN',
  '/spec tasks NNN',
  '/spec review NNN',
  '/spec implement NNN',
  '/spec review NNN code',
  '/spec done NNN',
  '/spec done NNN archive',
  // Spec 043: the claimless row's `/spec new NNN`, after the lifecycle's own steps (as the unit spec lists it).
  '/spec new NNN',
  '/spec NNN',
];
// Every command the stage table names stands in the list.
for (const rule of STAGE_RULES) if (rule.next !== null && !COMMANDS.includes(rule.next)) throw new Error(`${rule.next} missing`);

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
      await expect(page.locator('#moves [data-stage-chain] .pill')).toHaveText(CHAIN.map(chainText));
      await expect(page.locator('#moves [data-stage-chain] ui-icon')).toHaveCount(CHAIN.length - 1);
      await expect(page.locator('#commands [data-commands] tbody tr')).toHaveCount(COMMANDS.length);
      await expect(page.locator('#commands [data-commands] tbody ui-command-chip code')).toHaveText(COMMANDS);

      await page.locator('#moves [data-type-chip="chore"]').click();
      await expect(page.locator('select[data-workflow-type]')).toHaveValue('chore');
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
      await expect(page.locator('figure[data-workflow-figure]')).toHaveCount(1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);
    });
  });
}
