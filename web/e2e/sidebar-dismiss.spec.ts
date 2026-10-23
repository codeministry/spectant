/**
 * Spec 070 · C10 · ISC-576 and C11 · ISC-577 (`bun run e2e -- sidebar-dismiss.spec.ts`): a mouse click outside the
 * detail sidebar on a spot that is no selectable object closes it, docked and floating alike, and drops `?sel=`; a
 * click on another spec row or board card switches the sidebar to that object without closing it. Anti: a click on the
 * sidebar's own content, or in the dialog it opens (the release question, its backdrop included), never closes it.
 *
 * Presentations: docked on the Specs page at 1440, floating on the workspace board at 1440, the non-modal overlay on
 * the Specs page at 820. The empty spot is the page's title, which is no object and no control. The release case runs
 * on beacon 003 under the `runs` fixture. One stub session per test, reset before and after.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LOCKS_HEADER, RESET_PATH, SESSION_HEADER, STUB_NOW, STUB_RUN } from './stub-api';

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const selParam = (page: Page): string | null => new URL(page.url()).searchParams.get('sel');
const emptySpot = (page: Page): Locator => page.locator('h1.type-page-title').first();

/** Waits for the panel's slide-in and every other running animation. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().filter((animation) => animation.effect?.getTiming().iterations !== Infinity).map((animation) => animation.finished)));
}

async function expectOpen(page: Page, ref: string, presentation: string): Promise<void> {
  await expect.poll(() => selParam(page)).toBe(ref);
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
  await expect(sidebar(page).locator('[data-part="id"]')).toHaveText(ref.slice(ref.indexOf(':') + 1));
  await settle(page);
}

async function expectClosed(page: Page): Promise<void> {
  await expect(sidebar(page)).toHaveCount(0);
  await expect.poll(() => selParam(page)).toBeNull();
}

/** Clicks `target` near its inline start, where neither a docked rail nor a panel from the right covers it. */
async function clickStart(target: Locator): Promise<void> {
  await target.click({ position: { x: 8, y: 8 } });
}

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `sidebar-dismiss-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

const CASES = [
  { width: WIDTHS.desktop, path: '/w/harbor/specs', object: 'a.row-link', presentation: 'docked' },
  { width: WIDTHS.desktop, path: '/w/harbor/board', object: 'a.title', presentation: 'floating' },
  { width: WIDTHS.tablet, path: '/w/harbor/specs', object: 'a.row-link', presentation: 'overlay' },
] as const;

for (const { width, path, object, presentation } of CASES) {
  test.describe(`sidebar dismiss at ${String(width)} on ${path}`, () => {
    test.use(atWidth(width));

    const choose = async (page: Page, id: string): Promise<void> => {
      await clickStart(page.locator(`${object}[data-ref="spec:${id}"]`));
      await expectOpen(page, `spec:${id}`, presentation);
    };

    test(`sidebar dismiss: a click on the empty page title closes the ${presentation} sidebar and drops ?sel= (C10, ISC-576)`, async ({ page }) => {
      await page.goto(path);
      await choose(page, '002');
      await emptySpot(page).click();
      await expectClosed(page);
      await expect(page).toHaveURL(new RegExp(`${path}$`, 'u'));
    });

    test(`sidebar dismiss: a click on another spec switches the ${presentation} sidebar without closing it (C10, ISC-576)`, async ({ page }) => {
      await page.goto(path);
      await choose(page, '002');
      await clickStart(page.locator(`${object}[data-ref="spec:004"]`));
      await expectOpen(page, 'spec:004', presentation);
      await expect(sidebar(page)).toHaveCount(1);
    });

    test(`sidebar dismiss: clicks on the ${presentation} sidebar's own content never close it (C11, ISC-577)`, async ({ page }) => {
      await page.goto(path);
      await choose(page, '002');
      const panel = sidebar(page);
      for (const part of ['[data-part="title"]', '[data-part="id"]', '[data-part="type"]', '[data-section="facts"]', '[data-part="relations"]']) {
        await panel.locator(part).first().click({ position: { x: 2, y: 2 } });
        await expectOpen(page, 'spec:002', presentation);
      }
    });
  });
}

test.describe(`sidebar dismiss: the release question at ${String(WIDTHS.desktop)}`, () => {
  test.use({ ...atWidth(WIDTHS.desktop), clockAt: STUB_NOW });

  test(`sidebar dismiss: clicks in the release dialog and on its backdrop never close the sidebar (C11, ISC-577)`, async ({ page }) => {
    await page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'runs', [SESSION_HEADER]: session });
    await page.goto(`/w/${STUB_RUN.workspace.slug}/specs`);
    await clickStart(page.locator(`a.row-link[data-ref="spec:${STUB_RUN.spec}"]`));
    await expectOpen(page, `spec:${STUB_RUN.spec}`, 'docked');

    const dialog = page.locator('[data-release-dialog]');
    await sidebar(page).locator('[data-section="actions"] [data-release]').click();
    await expect(dialog).toBeVisible();
    await dialog.click({ position: { x: 4, y: 4 } });
    await expect(dialog).toBeVisible();
    await expectOpen(page, `spec:${STUB_RUN.spec}`, 'docked');

    // The backdrop, a spot of the page outside the dialog's box, closes the question (the dialog primitive), never the
    // sidebar behind it.
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
    await expectOpen(page, `spec:${STUB_RUN.spec}`, 'docked');
  });
});
