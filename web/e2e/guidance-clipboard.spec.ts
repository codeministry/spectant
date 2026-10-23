/**
 * Spec 020 (next-step guidance) against the stub API: the copy chip on the four guidance surfaces (T29, ISC-241):
 * `bun run --cwd web e2e -- -g "guidance clipboard"`.
 *
 * At 1440 × 900, with clipboard read and write granted (`context.grantPermissions`), a click on the copy chip of the
 * start's top waiting entry, the spec rail's next step and one of its waiting rows, a board card, and the workspace
 * dashboard's `#waiting` section and Next up puts exactly the entry's `command` in the clipboard, byte for byte (no
 * whitespace before or after), and confirms it visibly at the chip (the check) and in the chip's polite live region
 * (`common.copied`). Every expected command is read from the API body the page renders, never hand-typed.
 *
 * Spec 068 (T11, ISC-545): a Next up entry is a spec-list row (`app-spec-row[data-next-row]`); its chip stands in the
 * row's command cell (`[data-cell="command"]`), and its reason is the row link's description, never a visible line.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import type { GuidanceView } from './guidance-sentence';
import { RESET_PATH, SESSION_HEADER, WAITS_HEADER } from './stub-api';

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
    // Spec 066 (ISC-518): the first waiting row of the tile's list area carries the first entry's icon-only chip.
    const chip = page
      .locator(`[data-ui="workspace-column"][data-ws="${WS}"] [data-tile-block="list"] li[data-tile-row][data-kind="waiting"]`)
      .first()
      .locator('ui-command-chip[data-icon-only]');
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
    await expectCopies(page, page.locator('#waiting ui-flat-tile').first().locator('ui-command-chip'), waiting, '#waiting first tile');
    // Spec 068 (T11, ISC-545): the entry is a spec-list row, its one chip in the row's command cell.
    const spec = first?.spec ?? '';
    const row = page.locator(`app-next-up-list app-spec-row[data-next-row][data-next-entry="${spec}"]`);
    await expect(row, `Next up ${spec}: one row`).toHaveCount(1);
    await expect(row.locator('ui-command-chip'), `Next up ${spec}: one chip in the row`).toHaveCount(1);
    const chip = row.locator('[data-cell="command"] ui-command-chip');
    await expect(chip, `Next up ${spec}: the chip sits in the command cell`).toHaveCount(1);
    await expectCopies(page, chip, nextUp, `Next up ${spec}`);
    // The reason describes the row link and ends its title; it is no visible line: nothing visible in the row holds it.
    const link = row.locator('a[data-next-link]');
    await expect(link, `Next up ${spec}: the link names its reason`).toHaveAttribute('aria-describedby', `next-why-${spec}`);
    const reason = page.locator(`span#next-why-${spec}[data-next-reason][data-next-guide]`);
    await expect(reason, `Next up ${spec}: the reason is hidden`).toBeHidden();
    const sentence = ((await reason.textContent()) ?? '').trim();
    expect(sentence, `Next up ${spec}: the reason has a sentence`).not.toBe('');
    expect((await link.getAttribute('title'))?.endsWith(`\n${sentence}`), `Next up ${spec}: the reason ends the link's title`).toBe(true);
    const item = page.locator('app-next-up-list li').filter({ has: row });
    await expect(item.getByText(sentence).filter({ visible: true }), `Next up ${spec}: no visible line with the reason`).toHaveCount(0);
  });
});

/**
 * Spec 057 (ISC-354) against the stub API: no two copy chips and no two warning links of one page share an accessible
 * name: `bun run e2e -- guidance-clipboard.spec.ts -g "distinct names"`.
 *
 * Harbor as its golden stands: 006 waits on the principal (its stale review) and carries two warnings (drift and
 * review), 002 waits three times with the same command, and 004 carries two warnings without a command. On the
 * workspace dashboard (Next up's rows, `#waiting`, the warnings panel) and on 006's spec page (rail guide, its waiting rows,
 * the head), in English and in German, every copy chip's button and every warning link is collected with its
 * accessible name; each name is unique on its page, and a chip of the four guidance surfaces (Next up, waits on you,
 * the rail guide, the warnings) names its command and says more than the bare "Copy {command}".
 */
type Language = 'en' | 'de';
type Catalogue = { readonly orientation: { readonly copyCommand: string } };

const catalogue = (lang: Language): Catalogue =>
  JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8')) as Catalogue;

const PAGES = [
  // Spec 064: the warnings stand folded on the dashboard; `?open=warnings` opens them so their links render.
  { name: 'workspace dashboard', path: '/w/harbor?open=warnings', minChips: 4, minLinks: 4 },
  { name: 'spec page', path: '/w/harbor/s/006', minChips: 2, minLinks: 0 },
] as const;

/** Every copy-chip button and warning link of the page with its accessible name (aria-label, else its text). */
async function names(page: Page): Promise<{ chips: Array<{ name: string; command: string; guided: boolean }>; links: string[] }> {
  return page.evaluate(() => {
    const nameOf = (el: Element): string => (el.getAttribute('aria-label') ?? el.textContent).replace(/\s+/gu, ' ').trim();
    const chips = [...document.querySelectorAll('ui-command-chip')].flatMap((chip) => {
      const button = chip.querySelector('button');
      // The four guidance surfaces of ISC-354, whose chips must also say what they stand for.
      const guided = chip.closest('app-next-up-list, app-waiting-section, ui-waits-block, app-spec-rail-guide, app-warnings-panel') !== null || chip.matches('[data-warning-command]');
      return button ? [{ name: nameOf(button), command: (chip.querySelector('code')?.textContent ?? '').trim(), guided }] : [];
    });
    const links = [...document.querySelectorAll('a[data-warning-link], a[data-overlap-other]')].map(nameOf);
    return { chips, links };
  });
}

function duplicates(list: readonly string[]): string[] {
  return [...new Set(list.filter((name, i) => list.indexOf(name) !== i))];
}

test.describe('guidance names', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const lang of ['en', 'de'] as const) {
    test(`distinct names: copy chips and warning links per page (${lang})`, async ({ page }, info) => {
      const headers = { [SESSION_HEADER]: `names-${lang}-${info.testId}` };
      await page.context().setExtraHTTPHeaders(headers);
      await page.request.post(RESET_PATH, { headers });
      const saved = await page.request.put('/api/settings', { data: { language: lang }, headers });
      expect(saved.ok()).toBe(true);
      const bare = catalogue(lang).orientation.copyCommand;

      for (const target of PAGES) {
        await page.goto(target.path);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect.poll(async () => (await names(page)).chips.length, `${target.name}: chips render`).toBeGreaterThanOrEqual(target.minChips);
        await expect.poll(async () => (await names(page)).links.length, `${target.name}: warning links render`).toBeGreaterThanOrEqual(target.minLinks);
        const { chips, links } = await names(page);
        const chipNames = chips.map((c) => c.name);
        expect(duplicates(chipNames), `${target.name} (${lang}): copy chips sharing a name in ${JSON.stringify(chipNames)}`).toEqual([]);
        expect(duplicates(links), `${target.name} (${lang}): warning links sharing a name in ${JSON.stringify(links)}`).toEqual([]);
        for (const chip of chips.filter((c) => c.guided)) {
          expect(chip.name, `${target.name} (${lang}): the chip names its command`).toContain(chip.command);
          expect(chip.name, `${target.name} (${lang}): the chip says what it stands for`).not.toBe(bare.replace('{{command}}', chip.command));
        }
      }
      await page.request.post(RESET_PATH, { headers });
    });
  }
});
