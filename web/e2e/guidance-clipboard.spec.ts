/**
 * Spec 020 (next-step guidance) against the stub API: the copy chip on the four guidance surfaces (T29, ISC-241):
 * `bun run --cwd web e2e -- -g "guidance clipboard"`.
 *
 * At 1440 × 900, with clipboard read and write granted (`context.grantPermissions`), a click on the copy chip of the
 * start's top waiting entry, the spec rail's next step and one of its waiting rows, a board card, and the workspace
 * dashboard's `#waiting` section and Next up puts exactly the entry's `command` in the clipboard, byte for byte (no
 * whitespace before or after), and confirms it visibly at the chip (the check) and in the chip's polite live region
 * (`common.copied`). Every expected command is read from the API body the page renders, never hand-typed.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import type { GuidanceView } from './guidance-sentence';
import { WAITS_HEADER } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as { common: { copied: string } };

/** The fields of a guidance entry read here (structural, as the other e2e specs do). */
type Entry = GuidanceView['waits'][number] & { readonly command: string | null };
type Guidance = { readonly waits: readonly Entry[]; readonly next: readonly Entry[] };
type DashboardBody = { readonly specs: ReadonlyArray<{ readonly id: string }>; readonly guidance?: Guidance };
type SpecBody = { readonly next: { readonly command?: string | null }; readonly guidance?: Guidance };

const WS = 'harbor';
const SPEC = '002';

async function getJson<T>(request: APIRequestContext, path: string, headers: Record<string, string> = {}): Promise<T> {
  const answer = await request.get(path, { headers });
  expect(answer.status(), `GET ${path}`).toBe(200);
  return (await answer.json()) as T;
}

/** The body's guidance; a server with a clock always sets it, so its absence fails the test. */
function guidanceOf(body: { readonly guidance?: Guidance }, what: string): Guidance {
  expect(body.guidance, `${what}: the body carries guidance`).toBeDefined();
  return body.guidance ?? { waits: [], next: [] };
}

/** The command of an entry that has one; a missing command fails the test, since the chip would not be there. */
function commandOf(entry: Entry | undefined, what: string): string {
  expect(entry?.command, `${what}: the entry has a command`).toBeTruthy();
  return entry?.command ?? '';
}

async function grant(context: BrowserContext): Promise<void> {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
}

/**
 * Clicks the chip over a cleared clipboard and checks: the clipboard holds `command` byte for byte, the chip shows
 * the check, and its live region announces the catalogue's "Copied {command}".
 */
async function expectCopies(page: Page, chip: Locator, command: string, what: string): Promise<void> {
  expect(command, `${what}: the API command has no surrounding whitespace`).toBe(command.trim());
  await expect(chip.locator('code'), `${what}: the chip shows the command`).toHaveText(command);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const button = chip.locator('button');
  await button.click();
  await expect(button, `${what}: the visible confirmation`).toHaveAttribute('data-copied', '');
  await expect(button.locator('ui-icon')).toHaveAttribute('data-icon', 'check');
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard, `${what}: the clipboard holds the command byte for byte`).toBe(command);
  const region = chip.locator('ui-live-region');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region, `${what}: the live region announces the copy`).toHaveText(EN.common.copied.replace('{{command}}', command));
}

test.describe('guidance clipboard', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('clipboard: the start\'s top waiting entry copies its command', async ({ page, context, request }) => {
    await grant(context);
    const headers = { [WAITS_HEADER]: '7' };
    await page.context().setExtraHTTPHeaders(headers);
    const body = await getJson<DashboardBody>(request, `/api/workspaces/${WS}/dashboard`, headers);
    const command = commandOf(guidanceOf(body, WS).waits[0], 'start top entry');

    await page.goto('/');
    const chip = page.locator(`[data-ui="workspace-column"][data-ws="${WS}"] [data-ui="waits-block"] [data-top] ui-command-chip`);
    await expectCopies(page, chip, command, 'start');
  });

  test('clipboard: the spec page\'s next step and a waiting row copy their commands', async ({ page, context, request }) => {
    await grant(context);
    const body = await getJson<SpecBody>(request, `/api/workspaces/${WS}/specs/${SPEC}`);
    const guidance = guidanceOf(body, SPEC);
    const own = [...guidance.waits, ...guidance.next].find((e) => e.spec === SPEC && e.item === 'spec');
    const next = own?.command ?? body.next.command ?? '';
    expect(next, `${SPEC}: the next step has a command`).not.toBe('');
    const others = guidance.waits.filter((e) => e.spec === SPEC && e !== own);
    const index = others.findIndex((e) => e.command !== null);
    expect(index, `${SPEC}: a waiting entry with a command`).toBeGreaterThanOrEqual(0);

    await page.goto(`/w/${WS}/s/${SPEC}/status`);
    await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'wide');
    await expectCopies(page, page.locator('app-spec-rail [data-rail-block="next"] ui-command-chip[data-rail-next]'), next, 'rail next step');
    const waits = page.locator('app-spec-rail ui-waits-block[data-rail-block="waits"]');
    const scope = index === 0 ? waits.locator('[data-top]') : waits.locator('[data-row]').nth(index - 1);
    await expectCopies(page, scope.locator('ui-command-chip'), commandOf(others[index], 'rail waiting row'), 'rail waiting row');
  });

  test('clipboard: a board card copies its entry\'s command', async ({ page, context, request }) => {
    await grant(context);
    const body = await getJson<DashboardBody>(request, `/api/workspaces/${WS}/dashboard`);
    const guidance = guidanceOf(body, WS);
    const entry = guidance.next.find((e) => e.item === 'spec' && e.command !== null);
    const command = commandOf(entry, 'board card');

    await page.goto(`/w/${WS}/board`);
    const card = page.locator('app-board-page app-board-card').filter({ has: page.locator('.r1 .num', { hasText: new RegExp(`^${entry?.spec ?? ''}$`, 'u') }) });
    await expect(card, `the card of ${entry?.spec ?? ''}`).toHaveCount(1);
    await expectCopies(page, card.locator('[data-card-state] ui-command-chip'), command, `board card ${entry?.spec ?? ''}`);
  });

  test('clipboard: the workspace dashboard\'s waiting section and Next up copy their commands', async ({ page, context, request }) => {
    await grant(context);
    const body = await getJson<DashboardBody>(request, `/api/workspaces/${WS}/dashboard`);
    const guidance = guidanceOf(body, WS);
    const waiting = commandOf(guidance.waits[0], '#waiting top entry');
    const ids = new Set(body.specs.map((s) => s.id));
    const first = guidance.next.find((e) => ids.has(e.spec));
    const nextUp = commandOf(first, 'Next up first entry');

    await page.goto(`/w/${WS}`);
    await expectCopies(page, page.locator('#waiting [data-top] ui-command-chip'), waiting, '#waiting top entry');
    const entry = page.locator(`app-next-up-list app-next-up-entry[data-next-entry="${first?.spec ?? ''}"] [data-next-guide] ui-command-chip`);
    await expectCopies(page, entry, nextUp, `Next up ${first?.spec ?? ''}`);
  });
});
