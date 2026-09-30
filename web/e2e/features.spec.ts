/**
 * T33 · ISC-103: the Features page (`/w/:ws/features`) against the harbor planning golden served by the stub API
 * (`core/fixtures/harbor.planning.golden.json`), at 390 and 1440. `bun run e2e -- features`.
 *
 * The golden is the single source of every expected number: rows, fractions, holders, unheld ids and the meta counts
 * are all derived from it here, so "every count equals the golden JSON" is read literally. The meta line's separators
 * are CSS `::before` content, so the three spans are read one by one and never through the line's `textContent`.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

import type { PlanningModel } from '../../core/src/planning';
import { atWidth, expect, test, WIDTHS } from './fixtures';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const golden = read('../../core/fixtures/harbor.planning.golden.json') as PlanningModel;
type Catalogue = {
  terms: { feature: string; spec: string; claim: string; task: string };
  shell: { pages: { specs: string; features: string; milestones: string } };
  planning: { features: { valueText: string; unheld: string; allHeld: string; titleTerm: string; title: string } };
};
const en = read('../src/i18n/en.json') as Catalogue;
const de = read('../src/i18n/de.json') as Catalogue;

const features = golden.features;
const archivedFeature = features.find((f) => f.holders.some((h) => h.archived));
const withUnheld = features.filter((f) => f.unheld.length > 0);
const allHeld = features.filter((f) => f.unheld.length === 0);
const unheldSum = features.reduce((sum, f) => sum + f.unheld.length, 0);
const recount = golden.recount;
if (!recount || !archivedFeature || withUnheld.length === 0 || allHeld.length === 0 || golden.milestones.length === 0) {
  throw new Error('harbor.planning.golden.json no longer has an archived holder, an unheld claim, a fully held block and a milestone');
}

const template = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/gu, (_, key: string) => String(values[key]));

const VARIANT_ORDER = ['main', 'other', 'archived'];

const open = async (page: Page, hash = ''): Promise<void> => {
  await page.goto(`/w/harbor/features${hash}`);
  await expect(page.locator('ol.rows > li').first()).toBeVisible();
};

const card = (page: Page, id: string) => page.locator(`ol.rows > li:has(article[id="${id}"])`);

for (const width of [WIDTHS.phone, WIDTHS.desktop]) {
  const compact = width === WIDTHS.phone;

  test.describe(`features page at ${String(width)}`, () => {
    test.use(atWidth(width));

    test('one row per feature block of the master, in order, each an anchor target', async ({ page }) => {
      await open(page);
      await expect(page.locator('ol.rows > li')).toHaveCount(features.length);
      const articles = page.locator('ol.rows > li article');
      for (const [index, feature] of features.entries()) {
        const article = articles.nth(index);
        await expect(article).toHaveAttribute('id', feature.id);
        await expect(article).toHaveAttribute('tabindex', '-1');
        await expect(article.locator('h2 > .id')).toHaveText(feature.id);
        await expect(article.locator('h2 > .name')).toHaveText(feature.name);
      }
    });

    test('every fraction and meter equals the golden; a complete block is marked done', async ({ page }) => {
      await open(page);
      for (const feature of features) {
        const row = card(page, feature.id);
        const fraction = row.locator('.fraction');
        await expect(fraction).toHaveText(`${String(feature.closed)}/${String(feature.total)}`);
        await expect(row.locator('ui-meter [aria-valuetext], ui-meter[aria-valuetext]').first()).toHaveAttribute(
          'aria-valuetext',
          template(en.planning.features.valueText, { closed: feature.closed, total: feature.total }),
        );
        const complete = feature.total > 0 && feature.closed === feature.total;
        if (complete) {
          await expect(fraction).toHaveClass(/\bdone\b/u);
          await expect(fraction.locator('ui-icon[name="circle-check"]')).toHaveCount(1);
        } else {
          await expect(fraction).not.toHaveClass(/\bdone\b/u);
          await expect(fraction.locator('ui-icon[name="circle-check"]')).toHaveCount(0);
        }
      }
      expect(features.some((f) => f.total > 0 && f.closed === f.total), 'the golden has a complete block').toBe(true);
      expect(features.some((f) => f.total > 0 && f.closed < f.total), 'the golden has an open block').toBe(true);
    });

    test('unheld claims: a count that opens onto the ids, "all held" otherwise', async ({ page }) => {
      await open(page);
      for (const feature of withUnheld) {
        const row = card(page, feature.id);
        const details = row.locator('details.unheld');
        await expect(details.locator('> summary')).toContainText(template(en.planning.features.unheld, { count: feature.unheld.length }));
        await expect(row.locator('p.unheld')).toHaveCount(0);
        await details.locator('> summary').click();
        await expect(details).toHaveAttribute('open', '');
        const ids = details.locator('.ids');
        await expect(ids).toBeVisible();
        const listed = (await ids.innerText()).split(/[\s,]+/u).filter(Boolean);
        expect(listed).toEqual(feature.unheld);
      }
      for (const feature of allHeld) {
        const row = card(page, feature.id);
        await expect(row.locator('p.unheld')).toHaveText(en.planning.features.allHeld);
        await expect(row.locator('details.unheld')).toHaveCount(0);
      }
    });

    test('the holding specs: golden ids, main then other then archived, archived marked and linked', async ({ page }) => {
      await open(page);
      for (const feature of features) {
        if (compact && feature.holders.length > 4) continue; // the compact tier shows four; the overflow has its own case
        const chips = card(page, feature.id).locator('ul.holders app-spec-chip');
        await expect(chips).toHaveCount(feature.holders.length);
        const variants = await chips.evaluateAll((els) => els.map((el) => el.querySelector('a')?.getAttribute('data-variant') ?? ''));
        const ids = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-spec') ?? ''));
        expect([...ids].sort()).toEqual(feature.holders.map((h) => h.id).sort());
        const ranks = variants.map((v) => VARIANT_ORDER.indexOf(v));
        expect(ranks.every((r) => r >= 0), `known variants ${variants.join(',')}`).toBe(true);
        expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
        for (const holder of feature.holders) {
          const link = chips.and(page.locator(`[data-spec="${holder.id}"]`)).locator('a');
          await expect(link).toHaveAttribute('href', `/w/harbor/s/${holder.id}`);
          await expect(link).toHaveAttribute('data-variant', holder.archived ? 'archived' : holder.main ? 'main' : 'other');
          if (holder.archived) {
            await expect(link).toHaveAttribute('aria-label', /archived$/u);
            await expect(link.locator('ui-icon[name="archive"]')).toHaveCount(1);
            await expect(link.locator('.dot')).toHaveCount(0);
          } else if (holder.main) {
            await expect(link).toHaveAttribute('aria-label', /main feature$/u);
            await expect(link.locator('.dot')).toHaveCount(1);
            await expect(link.locator('ui-icon[name="archive"]')).toHaveCount(0);
          }
        }
      }
      const archived = archivedFeature.holders.find((h) => h.archived);
      const link = card(page, archivedFeature.id).locator(`app-spec-chip[data-spec="${archived?.id ?? ''}"] a`);
      await expect(link).toHaveAttribute('data-variant', 'archived');
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${archived?.id ?? ''}$`, 'u'));
    });

    test('the meta line counts features, closed and total claims, and unheld claims', async ({ page }) => {
      await open(page);
      const meta = page.locator('p.meta');
      const spans = meta.locator('> span');
      await expect(spans).toHaveCount(3);
      // `·` is generated content: each span's own count is read, never the line.
      await expect(spans.nth(0).locator('.n')).toHaveText(String(features.length));
      await expect(spans.nth(1).locator('.n')).toHaveText(`${String(recount.closed)}/${String(recount.total)}`);
      await expect(spans.nth(2).locator('.n')).toHaveText(String(unheldSum));
      // The recount is the sum of the rows.
      expect(features.reduce((sum, f) => sum + f.closed, 0)).toBe(recount.closed);
      expect(features.reduce((sum, f) => sum + f.total, 0)).toBe(recount.total);
    });

    test('the title reads "Features in harbor"; "Features" and "claims" are glossary terms', async ({ page }) => {
      await open(page);
      const h1 = page.locator('h1');
      await expect.poll(async () => (await h1.innerText()).replace(/\s+/gu, ' ').trim()).toBe('Features in harbor');
      const term = h1.locator('ui-term');
      await expect(term.locator('dfn')).toHaveText('Features');
      await expect(term.locator('[role="tooltip"]')).toHaveText(en.terms.feature);
      expect(en.terms.feature).toBe('Epic in a ticket tracker');
      const describedBy = await term.locator('dfn').getAttribute('aria-describedby');
      await expect(term.locator('[role="tooltip"]')).toHaveAttribute('id', describedBy ?? 'missing');
      await expect(page.locator('p.meta ui-term dfn')).toHaveText('claims');
    });

    test('an anchor opens the card: focused, marked as arrived', async ({ page }) => {
      await open(page, '#F2');
      await expect(page.locator('article#F2')).toBeFocused();
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('F2');
      await expect(card(page, 'F2').locator('ui-card')).toHaveAttribute('data-arrived', '');
      await expect(page.locator('ui-card[data-arrived]')).toHaveCount(1);
    });

    if (compact) {
      test('at 390 the page does not overflow; the fraction closes the title row above the meter; chips cap at four', async ({ page }) => {
        await open(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(WIDTHS.phone);
        for (const feature of features) {
          const row = card(page, feature.id);
          const meter = await row.locator('ui-meter').boundingBox();
          const fraction = await row.locator('.fraction').boundingBox();
          if (!meter || !fraction) throw new Error(`no boxes for ${feature.id}`);
          // Design § Features page: the fraction closes the title row, right-aligned above the full-width meter.
          expect(fraction.y + fraction.height, `${feature.id} fraction is above its meter`).toBeLessThanOrEqual(meter.y + 1);
          expect(Math.abs(fraction.x + fraction.width - (meter.x + meter.width)), `${feature.id} fraction is right-aligned`).toBeLessThanOrEqual(2);
        }
        const crowded = features.find((f) => f.holders.length > 4);
        if (crowded) {
          await expect(card(page, crowded.id).locator('.more-chips')).toBeVisible();
        } else {
          // The harbor golden has no block with more than four holders, so the overflow button is absent everywhere.
          await expect(page.locator('.more-chips')).toHaveCount(0);
        }
      });
    }
  });
}

test.describe('features page: the area menu', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('the trigger reads Features; the workspace menu lists Specs, Features, Milestones with Features current', async ({ page }) => {
    await open(page);
    const trigger = page.locator('header [data-control="area"]');
    await expect(trigger).toContainText(en.shell.pages.features);
    await trigger.click();
    const menu = page.getByRole('navigation', { name: 'Areas' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-page]')).toHaveCount(3); // harbor has milestones
    await expect(menu.locator('[data-page] .entry-name')).toHaveText([en.shell.pages.specs, en.shell.pages.features, en.shell.pages.milestones]);
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-page', 'features');
  });
});

/**
 * T42 · ISC-107: the level headers of the Features and Milestones pages and the breadcrumb carry the common terms as a
 * hint in both catalogues, while the visible vocabulary stays Feature · Spec · Claim · Task · Milestone.
 * `bun run e2e -- features -g vocabulary`. The language goes through the app's own path: `PUT /api/settings` under a
 * per-test stub session (set on the context) before `goto`; each session is reset afterwards.
 */
const SESSION = 'X-Spectant-Stub-Session';
const LANGS = { en, de } as const;

for (const [lang, cat] of Object.entries(LANGS) as Array<[keyof typeof LANGS, Catalogue]>) {
  for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
    const touch = width === WIDTHS.phone;

    test.describe(`vocabulary: ${lang} at ${String(width)}`, () => {
      test.use({ ...atWidth(width), ...(touch ? { hasTouch: true, isMobile: true } : {}) });

      // One stub session per test: the cases of a block run in parallel workers, and a shared session would let one
      // case's reset wipe another's language.
      let session = '';
      test.beforeEach(async ({ page, request }, info) => {
        session = `vocabulary-${lang}-${String(width)}-${info.testId}`;
        await page.context().setExtraHTTPHeaders({ [SESSION]: session });
        await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
        const saved = await request.put('/api/settings', { data: { language: lang }, headers: { [SESSION]: session } });
        expect(saved.ok()).toBe(true);
      });
      test.afterEach(async ({ request }) => {
        await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
      });

      const hintOpens = async (page: Page, host: ReturnType<Page['locator']>, text: string): Promise<void> => {
        const dfn = host.locator('dfn');
        const tip = host.locator('[role="tooltip"]');
        await expect(tip).toBeHidden();
        await expect(tip).toHaveText(text);
        if (touch) {
          await dfn.tap();
          await expect(tip).toBeVisible();
          await dfn.tap();
          await expect(tip).toBeHidden();
        } else {
          await dfn.hover();
          await expect(tip).toBeVisible();
          await page.mouse.move(2, 2);
          await expect(tip).toBeHidden();
          // Keyboard: Tab until the dfn holds focus (focus-visible), then Esc closes.
          await page.mouse.move(2, 2);
          await dfn.evaluate((el) => (el.ownerDocument.activeElement as HTMLElement | null)?.blur());
          for (let i = 0; i < 40; i++) {
            if (await dfn.evaluate((el) => el === el.ownerDocument.activeElement)) break;
            await page.keyboard.press('Tab');
          }
          await expect(dfn).toBeFocused();
          await expect(tip).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(tip).toBeHidden();
        }
      };

      test(`vocabulary: the Features H1 and meta terms keep the file word and open the ${lang} hint`, async ({ page }) => {
        await open(page);
        const h1Term = page.locator('h1 ui-term');
        await expect(h1Term.locator('dfn')).toHaveText('Features');
        await expect(h1Term.locator('dfn')).toHaveAttribute('tabindex', '0');
        await expect(h1Term.locator('[role="tooltip"]')).toHaveAttribute('popover', /hint|manual/u);
        const describedBy = await h1Term.locator('dfn').getAttribute('aria-describedby');
        await expect(h1Term.locator('[role="tooltip"]')).toHaveAttribute('id', describedBy ?? 'missing');
        await expect.poll(async () => (await page.locator('h1').innerText()).replace(/\s+/gu, ' ').trim()).toBe(template(cat.planning.features.title, { ws: 'harbor' }));
        await hintOpens(page, h1Term, cat.terms.feature);

        const claimTerm = page.locator('p.meta ui-term');
        await expect(claimTerm.locator('dfn')).toBeVisible();
        await hintOpens(page, claimTerm, cat.terms.claim);
      });

      test('vocabulary: no common term shows as visible text outside a hint on the Features page', async ({ page }) => {
        await open(page);
        const common = [en, de].flatMap((c) => Object.values(c.terms).map((t) => t.replace(/ (in a ticket tracker|im Ticket-Tracker)$/u, '')));
        const words = ['Epic', 'Story', 'Acceptance criterion', 'Sub-task', 'Akzeptanzkriterium', 'Sub-Task', ...common].map((w) => w.toLowerCase());
        const offenders = await page.evaluate((needles) => {
          const found: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = (node.textContent ?? '').trim().toLowerCase();
            if (!text || node.parentElement?.closest('[role="tooltip"]')) continue;
            if (needles.includes(text)) found.push(text);
          }
          return found;
        }, words);
        expect(offenders).toEqual([]);
      });

      test('vocabulary: the Milestones Features label carries the hint; the Milestones H1 has no term', async ({ page }) => {
        await page.goto('/w/harbor/milestones');
        await expect(page.locator('h1#milestones')).toBeVisible();
        await expect(page.locator('h1 ui-term')).toHaveCount(0);
        const term = page.locator('dt ui-term').first();
        await expect(term.locator('dfn')).toHaveText('Features');
        await hintOpens(page, term, cat.terms.feature);
      });

      test(`vocabulary: the breadcrumb levels carry the ${lang} terms as aria-description`, async ({ page }) => {
        await page.goto('/w/harbor/s/002/claims#claim-ISC-51');
        const feature = page.locator('[data-crumb="feature"]');
        await expect(feature).toHaveAttribute('aria-description', cat.terms.feature);
        await expect(feature).toContainText(/^\s*F\d+/u);
        await expect(page.locator('[data-crumb="spec"]')).toHaveAttribute('aria-description', cat.terms.spec);
        await expect(page.locator('[data-crumb="spec"]')).toContainText('002');
        const claim = page.locator('[data-crumb="claim"]');
        await expect(claim).toHaveAttribute('aria-description', cat.terms.claim);
        await expect(claim).toHaveText('ISC-51');

        await page.goto('/w/harbor/s/002/tasks#task-T27');
        const task = page.locator('[data-crumb="task"]');
        await expect(task).toHaveAttribute('aria-description', cat.terms.task);
        await expect(task).toHaveText('T27');
      });
    });
  }
}
