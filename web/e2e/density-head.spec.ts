/**
 * Spec 021 (density and readability), the spec head group (T52 · ISC-250, `bun run e2e -- density -g spec-head`):
 *
 * - The spec dashboard names the spec's goal sentence exactly once on the whole page: the head carries it, and the idea
 *   card does not repeat it. `uiClamp` shortens the head's copy to the words that fit, so an occurrence is counted by
 *   the sentence's opening words, once per element that shows them, whether clamped or whole.
 * - On every tab of the spec page (`SPEC_AREAS`, the dashboard included) the head stays within its budget with the
 *   overlaps and details folds collapsed: at most 160 px at 1440 × 900, at most 20 % of the first screen at 390 × 900.
 *   The head is measured from its own top edge to the bottom of its last row, the collapsed folds included; the shell
 *   bar, the tab row (outside the head) and spec 020's guide card `app-spec-guide` are not part of it. The agent banner
 *   below the folds is left out by the same rule, and its height is recorded beside the head's.
 *
 * Two pages: harbor 002 under the dense stub (`DENSE_HEADER`), whose goal is long enough to clamp at every width
 * (`STUB_DENSE.goalSpec`), and harbor 002 as the golden has it, the golden spec with the most overlaps (one overlap
 * warning, the only one in the default workspaces), so its overlaps fold is present. Each tab's measured height is an
 * annotation of its test. The goal sentence is read from the stub's own spec route, never from a literal copy of it.
 */
import type { Page } from '@playwright/test';
import type { SpecPageModel } from '../../core/src/files.ts';
import { specRoutes } from '../../server/src/contracts/spec-routes.contract.ts';
import { SPEC_AREAS } from '../src/app/layout/shell/areas';
import { expect, test } from './fixtures';
import { DENSE_HEADER, STUB_DENSE } from './stub-api';

const WS = STUB_DENSE.workspace.slug;
/** The first screen's height at both widths. */
const SCREEN = 900;
/** ISC-250's budget per width: 160 px wide, 20 % of the first screen at the phone. */
const BUDGETS = [
  { width: 1440, budget: 160 },
  { width: 390, budget: 0.2 * SCREEN },
] as const;

/** The two pages: the long, clamped goal under the dense stub and the golden spec with the overlaps fold. */
const PAGES = [
  { label: 'the dense long-goal spec', id: STUB_DENSE.goalSpec, headers: { [DENSE_HEADER]: 'on' }, overlaps: false },
  { label: 'the golden spec with overlaps', id: '002', headers: {}, overlaps: true },
] as const;

type Target = (typeof PAGES)[number];

/** Every tab of the spec page: the dashboard ('') and each area's tabs, in the shell's order. */
const TABS: readonly string[] = ['', ...SPEC_AREAS.flatMap((area) => area.tabs)];

const tabPath = (id: string, tab: string): string => (tab ? `/w/${WS}/s/${id}/${tab}` : `/w/${WS}/s/${id}`);

/** The goal sentence the spec route serves for the page, as the head reads it (`ideaQuote`). */
async function goalOf(page: Page, target: Target): Promise<string> {
  const res = await page.request.get(specRoutes.spec(WS, target.id), { headers: target.headers });
  expect(res.status()).toBe(200);
  const quote = ((await res.json()) as SpecPageModel).ideaQuote;
  if (!quote) throw new Error(`harbor ${target.id} serves no goal sentence`);
  return quote.replace(/\s+/gu, ' ').trim();
}

/** The sentence's opening words, at most 32 characters: what a clamped copy shows at any width. */
function opening(sentence: string): string {
  const words = sentence.split(' ');
  let out = words[0] ?? '';
  for (const word of words.slice(1)) {
    if (`${out} ${word}`.length > 32) break;
    out = `${out} ${word}`;
  }
  return out;
}

/** Open a tab of the target with every fold collapsed (no `?open=`), and wait until the head shows the spec. */
async function openTab(page: Page, target: Target, tab: string): Promise<void> {
  await page.context().setExtraHTTPHeaders(target.headers);
  await page.goto(tabPath(target.id, tab));
  const head = page.locator('app-spec-head');
  await expect(head.locator('h1')).toContainText(target.id);
  await expect(head.locator('[data-description]')).not.toBeEmpty();
  if (target.overlaps) await expect(head.locator('[data-head-overlaps]')).toHaveCount(1);
}

/** The head's height by ISC-250's rule, and the agent banner's, which the rule leaves out. */
function measure(page: Page): Promise<{ head: number; banner: number }> {
  return page.locator('app-spec-head').evaluate((host) => {
    const top = host.getBoundingClientRect().top;
    let bottom = top;
    let banner = 0;
    for (const child of Array.from(host.children)) {
      const box = child.getBoundingClientRect();
      if (child.matches('[data-agent-banner]')) banner = Math.round(box.height);
      if (child.matches('app-spec-guide, [data-agent-banner]') || box.height === 0) continue;
      bottom = Math.max(bottom, box.bottom);
    }
    return { head: Math.round(bottom - top), banner };
  });
}

/** The head's rows (its children and theirs, guide card and banner left out) as `name top+height`, from the head's top. */
function rows(page: Page): Promise<string> {
  return page.locator('app-spec-head').evaluate((host) => {
    const top = host.getBoundingClientRect().top;
    const name = (el: Element): string => {
      const hook = Array.from(el.attributes).find((attr) => attr.name.startsWith('data-') && !attr.name.startsWith('data-ng'));
      return el.tagName.toLowerCase() + (el.classList[0] ? `.${el.classList[0]}` : '') + (hook ? `[${hook.name}]` : '');
    };
    const out: string[] = [];
    for (const child of Array.from(host.children)) {
      if (child.matches('app-spec-guide, [data-agent-banner]')) continue;
      for (const row of [child, ...Array.from(child.children)]) {
        const box = row.getBoundingClientRect();
        if (box.height > 0) out.push(`${name(row)} ${Math.round(box.top - top)}+${Math.round(box.height)}`);
      }
    }
    return out.join('; ');
  });
}

/** The height once two reads in a row agree: the payloads behind the head have rendered. */
async function settledHeight(page: Page): Promise<{ head: number; banner: number }> {
  let last = -1;
  let result = { head: 0, banner: 0 };
  await expect
    .poll(async () => {
      result = await measure(page);
      const same = result.head === last;
      last = result.head;
      return same;
    })
    .toBe(true);
  return result;
}

for (const { width, budget } of BUDGETS) {
  test.describe(`density spec-head at ${width}`, () => {
    test.use({ viewport: { width, height: SCREEN } });

    for (const target of PAGES) {
      test(`density spec-head names the goal once on the dashboard of ${target.label} at ${width}`, async ({ page }) => {
        const goal = await goalOf(page, target);
        const words = opening(goal);
        await openTab(page, target, '');
        await expect(page.locator('app-spec-dashboard')).toBeVisible();
        const holders = await page.locator('app-shell').evaluate((shell, start) => {
          const norm = (text: string | null): string => (text ?? '').replace(/\s+/gu, ' ').trim();
          // One per innermost element whose own text shows the opening words: a clamped copy and a whole copy alike.
          return Array.from(shell.querySelectorAll('*'))
            .filter((el) => norm(el.textContent).includes(start))
            .filter((el) => !Array.from(el.children).some((child) => norm(child.textContent).includes(start)))
            .map((el) => el.tagName.toLowerCase() + (el.hasAttribute('data-description') ? '[data-description]' : ''));
        }, words);
        test.info().annotations.push({ type: 'goal holders', description: holders.join(', ') || 'none' });
        expect(holders, `"${words}…" on the dashboard of harbor ${target.id}`).toHaveLength(1);
        await expect(page.locator('app-spec-head [data-description]')).toContainText(words);
      });

      test(`density spec-head stays within ${budget} px on every tab of ${target.label} at ${width}`, async ({ page }) => {
        const heights: Array<{ tab: string; head: number; banner: number }> = [];
        for (const tab of TABS) {
          await openTab(page, target, tab);
          const folds = page.locator('app-spec-head :is([data-head-overlap-fold], [data-head-details]) button.summary');
          for (const toggle of await folds.all()) await expect(toggle).toHaveAttribute('aria-expanded', 'false');
          const { head, banner } = await settledHeight(page);
          heights.push({ tab: tab || 'dashboard', head, banner });
          test.info().annotations.push({
            type: `head height ${tab || 'dashboard'}`,
            description: `${head} px of ${budget}${banner ? ` (agent banner ${banner} px below, not counted)` : ''}`,
          });
          if (head > budget) test.info().annotations.push({ type: `head rows ${tab || 'dashboard'}`, description: await rows(page) });
        }
        const over = heights.filter((entry) => entry.head > budget);
        expect(over, `tabs over ${budget} px: ${JSON.stringify(heights)}`).toEqual([]);
      });
    }
  });
}
