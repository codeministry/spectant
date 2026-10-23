/**
 * Spec 070 (dashboard waits, progress, sidebar), the anti-claim against the stub API (ISC-569):
 * `bun run --cwd web e2e -- guidance-duplicates.spec.ts`.
 *
 * No "Waits on you" list shows the same command twice. Under the default stub and under every
 * `X-Spectant-Stub-Waits` variant, the copy chip of every waiting row in each workspace tile of the start `/`
 * (spec 066, ISC-518) and of every tile in the `#waiting` section of each workspace dashboard `/w/<ws>`, its
 * "Show all n" opened, is collected per tile and per page; no command may stand twice in one of them. Harbor under the
 * variant with the most entries is the case that held a spec's command more than once before core folded a spec's
 * later entries under its front one (ISC-568), so the test asserts its chips are there at all: an empty list proves
 * nothing. Every expectation is read from the API bodies the page renders, never hand-typed.
 */
import type { APIRequestContext, Locator } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { WAITS_HEADER, WAITS_STATES } from './stub-api';

type WorkspaceRow = { readonly slug: string; readonly readable: boolean };
type Entry = { readonly spec: string; readonly command: string | null };
type DashboardBody = { readonly guidance?: { readonly waits: readonly Entry[] } };

const VARIANTS = [null, ...WAITS_STATES] as const;
type Variant = (typeof VARIANTS)[number];
/** The variant whose first workspace holds the most waiting entries: harbor as its golden is. */
const FULLEST = WAITS_STATES[WAITS_STATES.length - 1];

const headersOf = (variant: Variant): Record<string, string> => (variant === null ? {} : { [WAITS_HEADER]: variant });
const labelOf = (variant: Variant): string => (variant === null ? 'default stub' : `${WAITS_HEADER}: ${variant}`);

async function workspacesOf(request: APIRequestContext, headers: Record<string, string>): Promise<string[]> {
  const answer = await request.get('/api/workspaces', { headers });
  expect(answer.status(), 'GET /api/workspaces').toBe(200);
  return ((await answer.json()) as WorkspaceRow[]).filter((w) => w.readable).map((w) => w.slug);
}

async function waitsOf(request: APIRequestContext, ws: string, headers: Record<string, string>): Promise<readonly Entry[]> {
  const answer = await request.get(`/api/workspaces/${encodeURIComponent(ws)}/dashboard`, { headers });
  expect(answer.status(), `GET dashboard of ${ws}`).toBe(200);
  return ((await answer.json()) as DashboardBody).guidance?.waits ?? [];
}

/** The commands of every copy chip inside `scope`, in DOM order (the chip's `code`, visually hidden when icon-only). */
const commandsIn = (scope: Locator): Promise<string[]> =>
  scope.locator('ui-command-chip code').evaluateAll((els) => els.map((el) => el.textContent.trim()));

/** Every command that stands more than once in `commands`. */
const twice = (commands: readonly string[]): string[] => [...new Set(commands.filter((c, i) => commands.indexOf(c) !== i))];

test.describe('guidance duplicates', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const variant of VARIANTS) {
    test(`${labelOf(variant)}: no "Waits on you" list on / or /w/<ws> holds a command twice`, async ({ page, request }) => {
      const headers = headersOf(variant);
      await page.context().setExtraHTTPHeaders(headers);
      const workspaces = await workspacesOf(request, headers);
      expect(workspaces.length, 'the start lists workspaces').toBeGreaterThan(0);

      await page.goto('/');
      for (const ws of workspaces) {
        const list = page.locator(`[data-ui="workspace-column"][data-ws="${ws}"] [data-tile-block="list"] app-tile-list`);
        await expect(list, `${ws}: the tile holds its list area`).toBeVisible();
        const shown = await commandsIn(list.locator('li[data-tile-row][data-kind="waiting"]'));
        expect(twice(shown), `/ · ${ws}: the waiting rows' chips ${JSON.stringify(shown)}`).toEqual([]);
        if (variant === FULLEST && ws === workspaces[0]) expect(shown.length, `/ · ${ws}: the waiting rows carry chips`).toBeGreaterThan(1);
      }

      for (const ws of workspaces) {
        const waits = await waitsOf(request, ws, headers);
        await page.goto(`/w/${ws}`);
        const section = page.locator('#waiting');
        await expect(section).toHaveAttribute('data-count', String(waits.length));
        const showAll = section.locator('[data-show-all]');
        if ((await showAll.count()) > 0 && (await showAll.getAttribute('data-open')) === null) await showAll.locator('[data-fold-toggle]').click();
        await expect(section.locator('ui-flat-tile'), `/w/${ws}: every entry stands as a tile`).toHaveCount(waits.length);
        const shown = await commandsIn(section);
        expect(twice(shown), `/w/${ws}: the #waiting chips ${JSON.stringify(shown)}`).toEqual([]);
        expect(shown.length, `/w/${ws}: one chip per entry with a command`).toBe(waits.filter((e) => e.command !== null).length);
        if (variant === FULLEST && ws === workspaces[0]) expect(shown.length, `/w/${ws}: the section carries chips`).toBeGreaterThan(1);
      }
    });
  }
});
