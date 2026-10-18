/**
 * Spec 020 (next-step guidance) against the stub API: the spec page's guidance spot (T22, ISC-239). Every expectation
 * is read from the API body the page renders (`GET /api/workspaces/<ws>/specs/<id>`, its `guidance` slice and `next`)
 * and the English catalogue (`guidance-sentence.ts`), never from a hand-typed list.
 *
 * - `bun run --cwd web e2e -- -g "guidance spec page"`: at 1440 × 900, on the spec dashboard and on every tab of the
 *   spec page, for a spec with waiting entries (harbor 002) and one without (harbor 009), the guidance spot lies fully
 *   above the fold without a scroll: the next step's sentence and its copy chip, and the spec's entries of "Waits on
 *   you" with their sentence where it has some. From 1120 px the spot is the spec rail (Status, Data and Notes areas),
 *   the compact guide card under the spec head where the tab registers no spec rail (the live area, the Library), and
 *   on the dashboard tab the next-step card under the KPI band with the head's canonical chip beside it.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { type GuidanceEntryView, type GuidanceView, sentenceOf, specEntryOf } from './guidance-sentence';

/** The fields of a `SpecPageModel` read here (structural, as the other e2e specs do). */
type SpecBody = {
  readonly head: { readonly id: string };
  readonly next: { readonly command?: string | null; readonly reasons: readonly string[] };
  readonly guidance?: GuidanceView;
};

const WS = 'harbor';
const FOLD = 900;

/** The spec page's routes: the dashboard ('') and every tab of `SPEC_AREAS`, in menu order. */
const TABS = ['', 'status', 'timeline', 'board', 'matrix', 'claims', 'tasks', 'library', 'notes'] as const;
type Tab = (typeof TABS)[number];

/** The tabs that register no spec rail and show the compact guide card from 1120 px (`guideCardShown`). */
const CARD_TABS: ReadonlySet<Tab> = new Set(['board', 'matrix', 'library']);

/** One spec under test: harbor 002 has waiting entries beside its own next step, 009 has none. */
const SPECS = [
  { id: '002', waits: true },
  { id: '009', waits: false },
] as const;

async function specBody(request: APIRequestContext, id: string): Promise<SpecBody> {
  const answer = await request.get(`/api/workspaces/${WS}/specs/${id}`);
  expect(answer.status(), `GET spec ${id}`).toBe(200);
  return (await answer.json()) as SpecBody;
}

/** What the spot must say: the spec's own entry's sentence (else the model's first reason) and the next command. */
function expected(body: SpecBody): { sentence: string; command: string; others: readonly GuidanceEntryView[] } {
  expect(body.guidance, `${body.head.id}: the spec page carries guidance`).toBeDefined();
  const guidance = body.guidance ?? { waits: [], next: [] };
  const own = specEntryOf(guidance, body.head.id);
  const waits = guidance.waits.filter((e) => e.spec === body.head.id);
  return {
    sentence: own ? sentenceOf(own.reason) : (body.next.reasons[0] ?? ''),
    command: (own as { command?: string | null } | undefined)?.command ?? body.next.command ?? '',
    others: waits.filter((e) => e !== own),
  };
}

const text = (s: string | null | undefined): string => (s ?? '').replace(/\s+/gu, ' ').trim();

/** The element lies fully inside the 1440 × 900 viewport as the page loaded, without a scroll. */
async function aboveFold(locator: Locator, what: string): Promise<void> {
  await expect(locator, what).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${what}: has a box`).not.toBeNull();
  const { y = -1, height = FOLD + 1, x = -1, width = WIDTHS.desktop + 1 } = box ?? {};
  expect(y, `${what}: top at ${String(y)}`).toBeGreaterThanOrEqual(0);
  expect(y + height, `${what}: bottom at ${String(y + height)}`).toBeLessThanOrEqual(FOLD);
  expect(x, `${what}: left at ${String(x)}`).toBeGreaterThanOrEqual(0);
  expect(x + width, `${what}: right at ${String(x + width)}`).toBeLessThanOrEqual(WIDTHS.desktop);
}

/** The spot's parts on one route: its box, the sentence, the copy chip and the waiting rows' sentences. */
function spotOf(page: Page, tab: Tab): { spot: Locator; sentence: Locator; chip: Locator; rows: Locator } {
  if (tab === '') {
    const spot = page.locator('app-spec-dashboard [data-section="next"]');
    const context = page.locator('[data-spec-context]');
    return {
      spot,
      sentence: spot.locator('[data-guidance-reason]'),
      chip: page.locator('app-spec-head [data-head-command]'),
      rows: context.locator('ui-waits-block [data-top] [data-reason], ui-waits-block [data-row] [data-reason]'),
    };
  }
  if (CARD_TABS.has(tab)) {
    const spot = page.locator('app-spec-guide [data-spec-guide]');
    return {
      spot,
      sentence: spot.locator('[data-guide-reason]'),
      chip: spot.locator('[data-guide-command]'),
      rows: spot.locator('[data-guide-waiting]'),
    };
  }
  const spot = page.locator('app-spec-rail [data-rail-block="next"]');
  const waits = page.locator('app-spec-rail ui-waits-block[data-rail-block="waits"]');
  return {
    spot,
    sentence: spot.locator('[data-rail-reason]'),
    chip: spot.locator('[data-rail-next]'),
    rows: waits.locator('[data-top] [data-reason], [data-row] [data-reason]'),
  };
}

test.describe('guidance spec page', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const spec of SPECS) {
    for (const tab of TABS) {
      const route = `/w/${WS}/s/${spec.id}${tab ? `/${tab}` : ''}`;

      test(`${spec.id} ${tab || 'dashboard'}: the guidance spot is above the fold at 1440 × 900`, async ({ page, request }) => {
        const body = await specBody(request, spec.id);
        const want = expected(body);
        expect(want.others.length > 0, `${spec.id}: has waiting entries beside its next step`).toBe(spec.waits);

        await page.goto(route);
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'wide');
        const { spot, sentence, chip, rows } = spotOf(page, tab);

        await aboveFold(spot, `${route} spot`);
        await expect(sentence).toHaveCount(1);
        expect(text(await sentence.textContent()), `${route} sentence`).toContain(want.sentence);
        await aboveFold(sentence, `${route} sentence`);
        await expect(chip.locator('code')).toHaveText(want.command);
        await aboveFold(chip, `${route} copy chip`);

        if (CARD_TABS.has(tab)) {
          // The compact card links "+n waiting" to the dashboard tab's `#waiting` in place of the rows.
          if (want.others.length === 0) {
            await expect(rows).toHaveCount(0);
          } else {
            await expect(rows).toHaveCount(1);
            await expect(rows).toHaveAttribute('href', `/w/${WS}/s/${spec.id}#waiting`);
            await expect(rows).toContainText(String(want.others.length));
            await aboveFold(rows, `${route} +n waiting`);
          }
        } else {
          const shown = want.others.slice(0, 5);
          await expect(rows).toHaveCount(shown.length);
          expect((await rows.allTextContents()).map(text), `${route} waiting sentences`).toEqual(shown.map((e) => sentenceOf(e.reason)));
          for (let i = 0; i < shown.length; i += 1) await aboveFold(rows.nth(i), `${route} waiting row ${String(i + 1)}`);
        }
        expect(await page.evaluate(() => window.scrollY), `${route} did not scroll`).toBe(0);
      });
    }
  }
});
