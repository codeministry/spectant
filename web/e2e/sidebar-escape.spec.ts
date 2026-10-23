/**
 * Spec 070 · C9 · ISC-575 (`bun run e2e -- sidebar-escape.spec.ts`): Escape closes the detail sidebar in every
 * presentation (docked on the Specs page at 1440, floating on the workspace dashboard and the board at 1440, the
 * non-modal overlay at 820, the modal sheet at 390), wherever the focus sits: in the panel (its title after a click),
 * on the page body (the focus dropped, as after a mouse click on a blank spot) and on the chosen object's own link.
 * The sidebar is gone, `?sel=` is gone, and the focus is back on the object the sidebar was opened from. The dialog
 * that stacks over the sidebar keeps closing first (ISC-537, `sidebar-keyboard.spec.ts`).
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';

const WS = 'harbor';

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const selParam = (page: Page): string | null => new URL(page.url()).searchParams.get('sel');

/** Where the focus sits when Escape is pressed. */
type Focus = 'panel' | 'body' | 'object';

/** One view an object is chosen in: its address and the link that chooses it. */
interface View {
  readonly name: string;
  readonly path: string;
  readonly link: (page: Page) => Locator;
}

const VIEWS: readonly View[] = [
  { name: 'dashboard next up', path: `/w/${WS}`, link: (page) => page.locator('a[data-next-link]').first() },
  { name: 'specs list', path: `/w/${WS}/specs`, link: (page) => page.locator('a.row-link[data-ref="spec:002"]') },
  { name: 'board card', path: `/w/${WS}/board`, link: (page) => page.locator('a.title[data-ref="spec:002"]') },
];

const CASES = [
  { width: WIDTHS.desktop, presentations: { 'dashboard next up': 'floating', 'specs list': 'docked', 'board card': 'floating' } },
  { width: WIDTHS.tablet, presentations: { 'dashboard next up': 'overlay', 'specs list': 'overlay', 'board card': 'overlay' } },
  { width: WIDTHS.phone, presentations: { 'dashboard next up': 'sheet', 'specs list': 'sheet', 'board card': 'sheet' } },
] as const;

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
}

/** Chooses the view's object with a mouse click and waits for the sidebar in `presentation`; returns the link. */
async function choose(page: Page, view: View, presentation: string): Promise<Locator> {
  await page.goto(view.path);
  const link = view.link(page);
  await link.click();
  await expect.poll(() => selParam(page)).not.toBeNull();
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
  await settle(page);
  return link;
}

/** Puts the focus where the case wants it before Escape. */
async function place(page: Page, focus: Focus, link: Locator): Promise<void> {
  if (focus === 'panel') {
    await sidebar(page).locator('h2[data-part="title"]').focus();
    return;
  }
  if (focus === 'object') {
    await link.focus();
    await expect(link).toBeFocused();
    return;
  }
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
}

for (const { width, presentations } of CASES) {
  test.describe(`sidebar escape at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const view of VIEWS) {
      const presentation = presentations[view.name as keyof typeof presentations];
      // The modal sheet makes the page inert: the object's own link cannot hold the focus behind it.
      const focuses: readonly Focus[] = presentation === 'sheet' ? ['panel', 'body'] : ['panel', 'body', 'object'];
      for (const focus of focuses) {
        test(`sidebar escape: ${view.name}, ${presentation}, focus on the ${focus}: Escape closes and returns the focus (C9, ISC-575)`, async ({ page }) => {
          const link = await choose(page, view, presentation);
          await place(page, focus, link);
          await page.keyboard.press('Escape');
          await expect(sidebar(page)).toHaveCount(0);
          await expect.poll(() => selParam(page)).toBeNull();
          await expect(link).toBeFocused();
        });
      }
    }
  });
}
