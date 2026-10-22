/**
 * Spec 067 · the detail sidebar's height follows its content, measured in real Chromium against the stub API under
 * `X-Spectant-Stub-Sidebar: on` (harbor with the childless milestone `milestone:harbor-3-0`):
 *
 *   bun run test:browser -- sidebar -g "height"
 *   bun run test:browser -- sidebar -g "height follows content (ISC-525)"
 *   bun run test:browser -- sidebar -g "height capped (ISC-525)"
 *   bun run test:browser -- sidebar -g "height short anti (ISC-526)"
 *
 * - ISC-525 (T12): the childless milestone, floating at 1440 × 900 on the workspace board, the dashboard, the planning
 *   graph and an idea page, as the overlay at 820 and docked on the planning tree at 1440: the panel's bottom edge
 *   sits right after its last content (the foot, else the body's last block), at most the body's bottom padding plus
 *   the panel's 1 px border below it, and the body does not scroll. For spec 001, which has 46 children, at a viewport
 *   only 500 px high (floating on the board, overlay, docked on the tree) the panel stays inside the viewport, head and
 *   foot fully visible, the panel itself does not scroll, and only the body does.
 * - ISC-526 (T13, anti): the childless milestone floating on board and dashboard at 1440 × 900 and as the overlay at
 *   820: the panel's bottom edge stays more than 100 px above the viewport's bottom.
 *
 * Every measurement polls until the panel shows its title, so it cannot pass on an empty or still-loading panel.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { SIDEBAR_HEADER, STUB_SIDEBAR } from '../stub-api';

const MILESTONE = `milestone:${STUB_SIDEBAR.milestone.slug}`;
const MILESTONE_TITLE = STUB_SIDEBAR.milestone.name;
/** Harbor's spec with the most children in the planning golden (46): its sidebar overflows a 500 px viewport. */
const LONG = 'spec:001';
/** A viewport too low for the long object's content. */
const LOW = 500;
/** An idea page of harbor (spec 026). */
const IDEA_PAGE = '/w/harbor/ideas/console-audit-log';

type Presentation = 'floating' | 'overlay' | 'docked';

interface PanelMetrics {
  /** The panel's bottom edge, its top edge and the viewport's height, in CSS px. */
  readonly bottom: number;
  readonly top: number;
  readonly viewport: number;
  /** The bottom edge of the last content: the foot, else the lowest block of the body. */
  readonly contentBottom: number;
  /** The padding allowed below that content: the body's bottom padding without a foot, none with one. */
  readonly padding: number;
  readonly headTop: number;
  readonly headBottom: number;
  readonly footBottom: number | null;
  readonly bodyScroll: number;
  readonly bodyClient: number;
  readonly panelScroll: number;
  readonly panelClient: number;
}

/** The shown sidebar's panel in `presentation`, measured; null while it is not there or has no title yet. */
async function panelMetrics(page: Page, presentation: Presentation): Promise<PanelMetrics | null> {
  return page.evaluate((wanted) => {
    const host = document.querySelector(`app-detail-sidebar[data-presentation="${wanted}"]`);
    const panel = host?.querySelector<HTMLElement>('.panel');
    const head = panel?.querySelector<HTMLElement>('.head');
    const body = panel?.querySelector<HTMLElement>('.body');
    const title = panel?.querySelector('[data-part="title"]');
    if (!panel || !head || !body || !title?.textContent.trim()) return null;
    const foot = panel.querySelector<HTMLElement>(':scope > .foot');
    const rect = panel.getBoundingClientRect();
    const blocks = [...body.children].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0);
    const lowest = Math.max(...blocks.map((r) => r.bottom));
    const footRect = foot?.getBoundingClientRect() ?? null;
    return {
      bottom: rect.bottom,
      top: rect.top,
      viewport: window.innerHeight,
      contentBottom: footRect ? footRect.bottom : lowest,
      padding: footRect ? 0 : parseFloat(getComputedStyle(body).paddingBlockEnd),
      headTop: head.getBoundingClientRect().top,
      headBottom: head.getBoundingClientRect().bottom,
      footBottom: footRect?.bottom ?? null,
      bodyScroll: body.scrollHeight,
      bodyClient: body.clientHeight,
      panelScroll: panel.scrollHeight,
      panelClient: panel.clientHeight,
    };
  }, presentation);
}

/** Opens `path` with `sel` selected and waits for the panel in `presentation` to show `title`. */
async function openSidebar(page: Page, path: string, sel: string, presentation: Presentation, title?: string): Promise<void> {
  await page.setExtraHTTPHeaders({ [SIDEBAR_HEADER]: 'on' });
  await page.goto(`${path}?sel=${sel}`);
  const titleEl = page.locator(`app-detail-sidebar[data-presentation="${presentation}"] .panel [data-part="title"]`);
  await expect(titleEl).toBeVisible();
  if (title !== undefined) await expect(titleEl).toHaveText(title);
}

/** The gap between the panel's bottom edge and its last content, minus what padding and the 1 px border allow. */
const excess = (m: PanelMetrics | null): number => (m === null ? Number.POSITIVE_INFINITY : Math.round((m.bottom - m.contentBottom - m.padding - 1) * 100) / 100);

/** Asserts the short (childless milestone) panel ends right after its content and its body does not scroll. */
async function expectFollowsContent(page: Page, presentation: Presentation): Promise<void> {
  await expect.poll(async () => excess(await panelMetrics(page, presentation)), { message: 'panel bottom − content bottom − padding − 1 px' }).toBeLessThanOrEqual(0);
  const m = await panelMetrics(page, presentation);
  expect(m).not.toBeNull();
  if (m === null) return;
  expect(m.bodyScroll, 'the short body does not scroll').toBeLessThanOrEqual(m.bodyClient);
  expect(m.bottom, 'the panel stays inside the viewport').toBeLessThanOrEqual(m.viewport);
}

/** Asserts the long panel is capped to the viewport and only its body scrolls, head and foot fully visible. */
async function expectCapped(page: Page, presentation: Presentation): Promise<void> {
  await expect.poll(async () => {
    const m = await panelMetrics(page, presentation);
    return m === null ? 0 : m.bodyScroll - m.bodyClient;
  }, { message: 'the long body scrolls (scrollHeight − clientHeight)' }).toBeGreaterThan(0);
  const m = await panelMetrics(page, presentation);
  expect(m).not.toBeNull();
  if (m === null) return;
  expect(m.bottom, 'panel bottom ≤ viewport').toBeLessThanOrEqual(m.viewport);
  expect(m.top, 'panel top inside the viewport').toBeGreaterThanOrEqual(0);
  expect(m.headTop, 'head top visible').toBeGreaterThanOrEqual(0);
  expect(m.headBottom, 'head bottom visible').toBeLessThanOrEqual(m.viewport);
  if (m.footBottom !== null) expect(m.footBottom, 'foot fully visible').toBeLessThanOrEqual(m.viewport);
  expect(m.panelScroll, 'the panel itself does not scroll').toBeLessThanOrEqual(m.panelClient);
}

/** The floating pages at wide: the board, the dashboard, the planning graph and an idea page. */
const FLOATING_PAGES = [
  { name: 'board', path: '/w/harbor/board' },
  { name: 'dashboard', path: '/w/harbor' },
  { name: 'graph', path: '/w/harbor/planning/graph' },
  { name: 'idea page', path: IDEA_PAGE },
] as const;

test.describe('sidebar height at 1440 × 900', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const { name, path } of FLOATING_PAGES) {
    test(`height follows content (ISC-525): childless milestone floating on the ${name}`, async ({ page }) => {
      await openSidebar(page, path, MILESTONE, 'floating', MILESTONE_TITLE);
      await expectFollowsContent(page, 'floating');
    });
  }

  test('height follows content (ISC-525): childless milestone docked on the planning tree', async ({ page }) => {
    await openSidebar(page, '/w/harbor/planning/tree', MILESTONE, 'docked', MILESTONE_TITLE);
    await expectFollowsContent(page, 'docked');
  });

  for (const { name, path } of FLOATING_PAGES.slice(0, 2)) {
    test(`height short anti (ISC-526): childless milestone floating on the ${name} ends > 100 px above the viewport bottom`, async ({ page }) => {
      await openSidebar(page, path, MILESTONE, 'floating', MILESTONE_TITLE);
      await expect.poll(async () => {
        const m = await panelMetrics(page, 'floating');
        return m === null ? Number.POSITIVE_INFINITY : m.viewport - 100 - m.bottom;
      }, { message: 'viewport − 100 px − panel bottom' }).toBeGreaterThan(0);
    });
  }
});

test.describe('sidebar height at 820', () => {
  test.use(atWidth(WIDTHS.tablet));

  test('height follows content (ISC-525): childless milestone as the overlay on the board', async ({ page }) => {
    await openSidebar(page, '/w/harbor/board', MILESTONE, 'overlay', MILESTONE_TITLE);
    await expectFollowsContent(page, 'overlay');
  });

  test('height short anti (ISC-526): childless milestone as the overlay ends > 100 px above the viewport bottom', async ({ page }) => {
    await openSidebar(page, '/w/harbor/board', MILESTONE, 'overlay', MILESTONE_TITLE);
    await expect.poll(async () => {
      const m = await panelMetrics(page, 'overlay');
      return m === null ? Number.POSITIVE_INFINITY : m.viewport - 100 - m.bottom;
    }, { message: 'viewport − 100 px − panel bottom' }).toBeGreaterThan(0);
  });
});

test.describe('sidebar height capped at 1440 × 500', () => {
  test.use({ viewport: { width: WIDTHS.desktop, height: LOW } });

  test('height capped (ISC-525): spec 001 with many children floating on the board, only the body scrolls', async ({ page }) => {
    await openSidebar(page, '/w/harbor/board', LONG, 'floating');
    await expectCapped(page, 'floating');
  });

  test('height capped (ISC-525): spec 001 with many children docked on the planning tree, only the body scrolls', async ({ page }) => {
    await openSidebar(page, '/w/harbor/planning/tree', LONG, 'docked');
    await expectCapped(page, 'docked');
  });
});

test.describe('sidebar height capped at 820 × 500', () => {
  test.use({ viewport: { width: WIDTHS.tablet, height: LOW } });

  test('height capped (ISC-525): spec 001 with many children as the overlay on the board, only the body scrolls', async ({ page }) => {
    await openSidebar(page, '/w/harbor/board', LONG, 'overlay');
    await expectCapped(page, 'overlay');
  });
});
