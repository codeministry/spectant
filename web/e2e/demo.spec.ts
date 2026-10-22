/*
 * Group `demo` (ISC-149.1): every mocked element carries the demo chip in its head, reads its fixture and nothing
 * else, writes nothing and calls no host outside loopback. `bun run e2e -- demo` plus `bun run e2e -- offline` is the
 * claim's probe; the static half (no `ApiClient`, no write method, frozen fixtures) is
 * `web/tests/demo-readonly.test.ts`. The tests run at 1440 unless one names another width, in their own stub session,
 * and only read. The network guard is the offline spec's: a `context.route('**')` handler lets loopback http(s)
 * through and aborts everything else, a request listener records what the open mock makes.
 *
 *   The mock convention (`web/src/app/shared/demo/demo-data.ts`)
 *   - `[data-demo]`                      the root of every mocked block, item or whole mocked page; rendered only
 *                                        while the mock is on screen (a closed assistant panel is not in the DOM).
 *   - `[data-demo-head]`                 the root's own head row: the section head or eyebrow row of a block, the h1
 *                                        row of a whole mocked page, the `as-head` of the assistant. Exactly one per
 *                                        root (heads inside a nested `[data-demo]` belong to that one); the root
 *                                        itself may carry it when the mocked item is a single row.
 *   - `[data-demo-chip]`                 `<ui-chip variant="demo">` (the chip's host sets it). Exactly one visible chip
 *                                        per visible root whose nearest `[data-demo]` is that root, inside that
 *                                        root's `[data-demo-head]`. No chip outside a `[data-demo]`.
 *   - Real pages carry no `[data-demo]` and no chip: the overview `/` (name, path, logo, screenshot, lists and KPIs
 *     of every tile are core's; badge, cover and edge take the accent of the name hash), the spec dashboard
 *     `/w/:ws/s/:id` and the status tab `/w/:ws/s/:id/status` (Spec context, gates, warnings and waiting items are
 *     core's). The header's assistant trigger is a control, not a mock, and carries none.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { DEMO_ASSISTANT_FALLBACK, DEMO_ASSISTANT_REPLIES } from '../src/app/shared/demo/fixtures/assistant.ts';
import { atWidth, expect, test } from './fixtures';

import { openAssistant } from './harbor-fixtures';

const DEMO_SESSION_HEADER = 'X-Spectant-Stub-Session';
const DEMO_SESSION = 'demo-suite';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** No endpoint serves these yet: a mock that asks the API for one reads something other than its fixture. */
const MOCK_API = /\/api\/.*(assistant|identit|upload)/iu;

interface DemoTraffic {
  readonly blocked: string[];
  readonly seen: Array<{ readonly method: string; readonly url: string }>;
}

async function guardNetwork(context: BrowserContext): Promise<DemoTraffic> {
  const traffic: DemoTraffic = { blocked: [], seen: [] };
  await context.route('**', async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)) return route.continue();
    traffic.blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/u, (ws) => {
    const url = new URL(ws.url());
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      traffic.blocked.push(url.href);
      return ws.close();
    }
    return ws.connectToServer();
  });
  context.on('request', (req) => traffic.seen.push({ method: req.method(), url: req.url() }));
  return traffic;
}

/**
 * The chip rule over every visible `[data-demo]` of the page: one own head, one own visible chip inside it; and no chip
 * outside a `[data-demo]`. Returns the defects as readable lines, so a failure names the root.
 */
async function chipDefects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const shown = (el: Element): boolean => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.getAttribute('data-page') ? `[data-page=${el.getAttribute('data-page') ?? ''}]` : ''}`;
    const defects: string[] = [];
    for (const root of Array.from(document.querySelectorAll('[data-demo]')).filter(shown)) {
      const own = (el: Element): boolean => el.closest('[data-demo]') === root;
      const heads = [root, ...Array.from(root.querySelectorAll('[data-demo-head]'))].filter((el) => el.hasAttribute('data-demo-head') && (el === root || own(el)));
      const chips = Array.from(root.querySelectorAll('[data-demo-chip]')).filter(own);
      const head = heads[0];
      if (heads.length !== 1) defects.push(`${name(root)}: ${String(heads.length)} heads`);
      if (chips.length !== 1) defects.push(`${name(root)}: ${String(chips.length)} chips`);
      for (const chip of chips) {
        if (!shown(chip)) defects.push(`${name(root)}: chip not visible`);
        if (head && !head.contains(chip)) defects.push(`${name(root)}: chip outside its head`);
      }
    }
    const orphans = Array.from(document.querySelectorAll('[data-demo-chip]')).filter((chip) => chip.closest('[data-demo]') === null);
    if (orphans.length > 0) defects.push(`${String(orphans.length)} chips outside any [data-demo]`);
    return defects;
  });
}

const storage = (page: Page): Promise<string> => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));

interface MockHost {
  readonly name: string;
  readonly route: string;
  readonly width?: number;
  /** Opens the mock on the route (the assistant opens from the header). */
  readonly open?: (page: Page) => Promise<void>;
  /** The mocked roots the view must show (each a `[data-demo]` or inside one). */
  readonly root: string;
  /** Shows the fixture and uses the mock the way a person would; nothing of it may write or leave the machine. */
  readonly use: (page: Page) => Promise<void>;
}

const useAssistant = async (page: Page): Promise<void> => {
  const panel = page.locator('[data-assistant]');
  await expect(panel.locator('[data-assistant-suggestion]')).toHaveText(DEMO_ASSISTANT_REPLIES.map((entry) => entry.prompt));
  const first = DEMO_ASSISTANT_REPLIES[0];
  if (!first) throw new Error('DEMO_ASSISTANT_REPLIES is empty');
  await panel.locator('[data-assistant-suggestion]').first().click();
  await expect(panel.locator('[data-assistant-reply]').last()).toContainText(first.reply);
  await panel.locator('[data-assistant-input]').fill('Anything else?');
  await panel.locator('[data-assistant-send]').click();
  await expect(panel.locator('[data-assistant-reply]').last()).toContainText(DEMO_ASSISTANT_FALLBACK);
  const apply = panel.locator('[data-assistant-apply]');
  if ((await apply.count()) > 0) await apply.first().click();
};

const MOCK_HOSTS: readonly MockHost[] = [
  { name: 'assistant dot', route: '/w/harbor/s/002', open: openAssistant, root: '[data-assistant][data-demo]', use: useAssistant },
  { name: 'assistant dot', route: '/w/harbor/s/002', width: 390, open: openAssistant, root: '[data-assistant][data-demo]', use: useAssistant },
];

/** Real pages that may hold a mock somewhere (the chip rule holds wherever one is), each with the hook that says it rendered. */
const SAMPLE_PAGES: ReadonlyArray<{ readonly route: string; readonly ready: string }> = [
  { route: '/w/harbor', ready: 'app-dashboard-page h1' },
  { route: '/settings', ready: '[data-page="settings"] h1' },
  { route: '/help', ready: 'app-help-page h1' },
  { route: '/w/harbor/s/002/board', ready: 'app-board-tab section.board' },
];

/** Pages with real data only: no `[data-demo]`, no chip. */
const REAL_ONLY: ReadonlyArray<{ readonly route: string; readonly ready: string }> = [
  { route: '/', ready: '.overview [data-ui="workspace-column"] [data-ws-cover]' },
  { route: '/w/harbor/s/002', ready: '[data-spec-context]' },
  { route: '/w/harbor/s/002/status', ready: 'app-status-tab' },
  { route: '/settings/workspaces', ready: '[data-page="settings-workspaces"] [data-ws-row]' },
];

test.describe('demo', () => {
  test.use({ ...atWidth(1440), extraHTTPHeaders: { [DEMO_SESSION_HEADER]: DEMO_SESSION } });
  test.beforeEach(async ({ request }) => {
    await request.post('/api/__stub/reset', { headers: { [DEMO_SESSION_HEADER]: DEMO_SESSION } });
  });

  for (const host of MOCK_HOSTS) {
    test.describe(`${host.name} at ${String(host.width ?? 1440)}`, () => {
      if (host.width) test.use(atWidth(host.width));

      test(`${host.name} carries the chip in its head, shows its fixture, writes nothing and stays on loopback`, async ({ page, context }) => {
        const traffic = await guardNetwork(context);
        await page.goto(host.route);
        if (host.open) await host.open(page);
        await expect(page.locator(host.root).first()).toBeVisible();
        expect(await chipDefects(page)).toEqual([]);

        const from = traffic.seen.length;
        const stored = await storage(page);
        await host.use(page);
        expect(await chipDefects(page)).toEqual([]);

        const made = traffic.seen.slice(from);
        expect(made.filter((req) => req.method !== 'GET').map((req) => `${req.method} ${req.url}`)).toEqual([]);
        expect(made.filter((req) => MOCK_API.test(new URL(req.url).pathname)).map((req) => req.url)).toEqual([]);
        expect(await storage(page)).toBe(stored);
        expect(traffic.blocked).toEqual([]);
      });
    });
  }

  for (const { route, ready } of SAMPLE_PAGES) {
    test(`${route}: every mock on the page carries its chip, no chip stands alone`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator(ready).first()).toBeVisible();
      expect(await chipDefects(page)).toEqual([]);
    });
  }

  test('/settings/workspaces lists the registry from the API, not the demo fixture', async ({ page }) => {
    await page.goto('/settings/workspaces');
    const rows = page.locator('[data-page="settings-workspaces"] [data-ws-row]');
    await expect(rows).toHaveCount(2);
    expect(await rows.evaluateAll((all) => all.map((row) => row.getAttribute('data-ws-row')))).toEqual(['harbor', 'lantern']);
    await expect(page.locator('[data-ws-add-path]')).toBeEnabled();
    await expect(page.locator('[data-identity-upload]')).toHaveCount(0);
  });

  for (const { route, ready } of REAL_ONLY) {
    test(`${route}: real data only, no mock and no chip`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator(ready).first()).toBeVisible();
      await expect(page.locator('[data-demo]')).toHaveCount(0);
      await expect(page.locator('[data-demo-chip]')).toHaveCount(0);
    });
  }
});
