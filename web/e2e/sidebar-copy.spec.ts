/**
 * Spec 067 · T24 · ISC-531 (`bun run e2e -- sidebar -g "copy next"`): a spec with a next command carries a copy chip in
 * the detail sidebar that puts exactly that command into the clipboard and confirms it visibly; its accessible name
 * names the command. Harbor 002 is chosen in the Specs list at 1440 (the docked panel) and at 390 (the bottom sheet),
 * with clipboard read and write granted (`context.grantPermissions`, as `guidance-clipboard.spec.ts` does).
 *
 * Against the stub API: the next command is the one harbor's dashboard row serves (core's output), never a literal.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';

/** Harbor 002's next command as its dashboard row serves it. */
async function nextOf(page: Page): Promise<string> {
  const response = await page.request.get('/api/workspaces/harbor/dashboard');
  const body = (await response.json()) as { specs: Array<{ id: string; nextCommand: string | null }> };
  const command = body.specs.find((row) => row.id === '002')?.nextCommand;
  if (!command) throw new Error('the harbor dashboard lost 002 or its next command');
  return command;
}

/** Selects 002 in the Specs list, clicks the sidebar's next-step copy chip and checks clipboard, name and confirmation. */
async function copyNext(page: Page, context: BrowserContext, presentation: 'docked' | 'sheet'): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const command = await nextOf(page);
  await page.goto('/w/harbor/specs');
  await page.locator('a.row-link[data-ref="spec:002"]').click();
  const sidebar = page.locator('app-detail-sidebar[data-presentation]');
  await expect(sidebar).toHaveAttribute('data-presentation', presentation);

  const chip = sidebar.locator('app-spec-facts [data-part="next"] ui-command-chip');
  await expect(chip.locator('code')).toHaveText(command);
  const button = chip.locator('button');
  await expect(button).toHaveAccessibleName(`Copy ${command} · next step for 002`);

  await page.evaluate(() => navigator.clipboard.writeText(''));
  await button.click();
  await expect(button).toHaveAttribute('data-copied', '');
  await expect(button.locator('ui-icon')).toHaveAttribute('data-icon', 'check');
  await expect(button).toHaveAccessibleName(`Copied ${command}`);
  await expect(chip.locator('[aria-live="polite"]')).toHaveText(`Copied ${command}`);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
}

test.describe('sidebar copy next: wide (1440)', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('copy next: harbor 002 in the Specs list copies its next command from the docked sidebar', async ({ page, context }) => {
    await copyNext(page, context, 'docked');
  });
});

test.describe('sidebar copy next: compact (390)', () => {
  test.use(atWidth(WIDTHS.phone));

  test('copy next: harbor 002 in the Specs list copies its next command from the sheet', async ({ page, context }) => {
    await copyNext(page, context, 'sheet');
  });
});
