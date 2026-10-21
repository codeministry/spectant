/**
 * Spec 020 (next-step guidance) against the stub API. Every expectation is read from the API body the page renders
 * (`GET /api/workspaces/<ws>/dashboard`, `DashboardModel.guidance`) and the English catalogue (`guidance-sentence.ts`),
 * never from a hand-typed list. One describe per group, so `-g "guidance <group>"` selects it.
 *
 * - `bun run --cwd web e2e -- -g "guidance board"` (T27, ISC-240): on the workspace board and the workspace dashboard,
 *   the "Waits on you" marker stands exactly on the cards and Specs-table rows (the Specs page since spec 058) whose spec's own entry (`item: 'spec'`)
 *   is in `guidance.waits`; every open card, every guided row and every Next up entry carries the entry's catalogue
 *   sentence, and no Next item carries the marker.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { type GuidanceEntryView, type GuidanceView, sentenceOf } from './guidance-sentence';
import { WAITS_HEADER } from './stub-api';

// ---- shared helpers -------------------------------------------------------------------------------------------------

/** The fields of a `DashboardModel` read here (structural, as the other e2e specs do). */
type DashboardBody = { readonly specs: ReadonlyArray<{ readonly id: string }>; readonly guidance?: GuidanceView };

/** The stub headers of a waits variant (`X-Spectant-Stub-Waits`); `{}` for the default workspace list. */
const waitsHeaders = (variant: '0' | '1' | '7' | null): Record<string, string> => (variant === null ? {} : { [WAITS_HEADER]: variant });

/** The dashboard body the page renders for `ws`, fetched with the same stub headers the page sends. */
async function dashboardBody(request: APIRequestContext, ws: string, headers: Record<string, string>): Promise<DashboardBody> {
  const answer = await request.get(`/api/workspaces/${encodeURIComponent(ws)}/dashboard`, { headers });
  expect(answer.status(), `GET dashboard of ${ws}`).toBe(200);
  return (await answer.json()) as DashboardBody;
}

/** The body's guidance; a server with a clock always sets it, so its absence fails the test. */
function guidanceOf(body: DashboardBody, ws: string): GuidanceView {
  expect(body.guidance, `${ws}: the dashboard carries guidance`).toBeDefined();
  return body.guidance ?? { waits: [], next: [] };
}

/** Each spec's own entry (`item: 'spec'`), with whether it stands in `waits`. */
function specEntries(guidance: GuidanceView): Map<string, { readonly entry: GuidanceEntryView; readonly waits: boolean }> {
  const out = new Map<string, { entry: GuidanceEntryView; waits: boolean }>();
  for (const [list, waits] of [[guidance.waits, true], [guidance.next, false]] as const) {
    for (const entry of list) if (entry.item === 'spec' && !out.has(entry.spec)) out.set(entry.spec, { entry, waits });
  }
  return out;
}

/** The ids of the specs whose own entry waits on you, sorted. */
const waitingSpecs = (guidance: GuidanceView): string[] => [...new Set(guidance.waits.filter((e) => e.item === 'spec').map((e) => e.spec))].sort();

/** `guidance.next` as Next up lists it: in its order, one entry per spec (the first that names it), rows only. */
function nextUpEntries(guidance: GuidanceView, specs: DashboardBody['specs']): GuidanceEntryView[] {
  const ids = new Set(specs.map((s) => s.id));
  const seen = new Set<string>();
  return guidance.next.filter((e) => {
    if (!ids.has(e.spec) || seen.has(e.spec)) return false;
    seen.add(e.spec);
    return true;
  });
}

const text = (s: string | null | undefined): string => (s ?? '').replace(/\s+/gu, ' ').trim();

// ---- guidance board (T27, ISC-240) ----------------------------------------------------------------------------------

/** One rendered board card, read in one pass. */
type CardView = { key: string; id: string; state: string | null; marked: boolean; reason: string };
/** One rendered Specs-table guide row. */
type GuideView = { id: string; guide: string | null; marked: boolean; ring: boolean; hidden: boolean; described: boolean; sentence: string };
/** One rendered Next up entry. */
type NextView = { id: string; guided: boolean; sentence: string; marked: boolean };

async function boardCards(page: Page): Promise<CardView[]> {
  return page.locator('app-board-page app-board-card').evaluateAll((els) =>
    els.map((el) => ({
      key: el.getAttribute('data-key') ?? '',
      id: el.querySelector('.r1 .num')?.textContent.trim() ?? '',
      state: el.querySelector('[data-card-state] ui-item-state')?.getAttribute('data-state') ?? null,
      marked: el.querySelector('[data-card-marker]') !== null,
      reason: el.querySelector('[data-card-state] [data-reason-shown]')?.textContent ?? '',
    })),
  );
}

/**
 * The Specs list's guided rows (spec 021, R1; ISC-240 refined): a row with its own entry carries the reason as the
 * hidden `why-<id>` (with `data-guide`), named in the row link's `aria-describedby` and on its own line of the link's
 * `title`; a waiting row shows the "Waits on you" mark, a Next row the open ring. No guide line stands in the row.
 */
async function guideRows(page: Page): Promise<GuideView[]> {
  return page.locator('app-spec-table li:has([data-guide])').evaluateAll((els) =>
    els.map((el) => {
      const why = el.querySelector('[data-guide]');
      const link = el.querySelector('a.row-link');
      const sentence = why?.textContent ?? '';
      const describedBy = (link?.getAttribute('aria-describedby') ?? '').split(' ');
      return {
        id: why?.getAttribute('data-reason') ?? '',
        guide: why?.getAttribute('data-guide') ?? null,
        marked: el.querySelector('app-spec-row [data-waits-mark]') !== null,
        ring: el.querySelector('app-spec-row [data-next-mark]') !== null,
        hidden: why?.hasAttribute('hidden') === true,
        described: describedBy.includes(why?.id ?? '-') && (link?.getAttribute('title') ?? '').endsWith(`\n${sentence}`),
        sentence,
      };
    }),
  );
}

async function nextUp(page: Page): Promise<NextView[]> {
  return page.locator('app-next-up-list app-next-up-entry').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-next-entry') ?? '',
      guided: el.querySelector('[data-next-guide]') !== null,
      sentence: el.querySelector('[data-next-guide] [data-next-sentence]')?.textContent ?? '',
      marked: el.querySelector('[data-waits-mark], [data-card-marker]') !== null,
    })),
  );
}

/** The workspaces probed: harbor (three specs wait, three are next) and beacon under `Waits: 1` (one waits). */
const BOARD_CASES = [
  { ws: 'harbor', variant: null },
  { ws: 'beacon', variant: '1' },
] as const;

test.describe('guidance board', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const { ws, variant } of BOARD_CASES) {
    const headers = waitsHeaders(variant);
    const label = variant === null ? ws : `${ws} (${WAITS_HEADER}: ${variant})`;

    test(`board: ${label} marks exactly the waiting cards; every open card carries its sentence`, async ({ page, request }) => {
      await page.context().setExtraHTTPHeaders(headers);
      const body = await dashboardBody(request, ws, headers);
      const guidance = guidanceOf(body, ws);
      const entries = specEntries(guidance);
      const waiting = waitingSpecs(guidance);
      expect(waiting.length, `${ws}: at least one spec waits on you`).toBeGreaterThan(0);
      expect([...entries.values()].some((e) => !e.waits), `${ws}: at least one spec is next`).toBe(true);

      await page.goto(`/w/${ws}/board`);
      await expect(page.locator('app-board-page app-board-card').first()).toBeVisible();
      const cards = await boardCards(page);
      const specCards = cards.filter((c) => c.key.startsWith('spec:'));

      // The marker stands exactly on the cards whose spec's own entry waits on you.
      expect(specCards.filter((c) => c.marked).map((c) => c.id).sort(), `${ws}: marked cards`).toEqual(waiting);
      expect(cards.filter((c) => !c.key.startsWith('spec:') && c.marked), `${ws}: no story carries the marker`).toEqual([]);
      // Every spec with its own entry has its card on the board, and the card reads the entry's catalogue sentence.
      for (const [id, { entry, waits }] of entries) {
        const card = specCards.find((c) => c.id === id);
        expect(card, `${ws}: the card of ${id}`).toBeDefined();
        expect(card?.marked, `${ws} ${id}: marker ${waits ? 'on a waiting' : 'absent from a Next'} card`).toBe(waits);
        expect(text(card?.reason), `${ws} ${id}: the card's sentence`).toBe(text(sentenceOf(entry.reason)));
      }
      // Every open card carries a reason; a waiting or done card carries no marker unless its own entry waits.
      const open = cards.filter((c) => c.state === 'open');
      expect(open.length, `${ws}: open cards`).toBeGreaterThan(0);
      for (const card of open) expect(text(card.reason), `${ws} ${card.key}: the open card's reason`).not.toBe('');
    });

    test(`board: ${label} dashboard marks exactly the waiting rows; every guided row and Next up entry carries its sentence`, async ({
      page,
      request,
    }) => {
      await page.context().setExtraHTTPHeaders(headers);
      const body = await dashboardBody(request, ws, headers);
      const guidance = guidanceOf(body, ws);
      const entries = specEntries(guidance);
      const waiting = waitingSpecs(guidance);

      // Spec 021: the spec list folds behind its first five rows; `?open=specs` opens it so every guide row renders.
      // Spec 058: the list stands on the Specs page, Next up on the dashboard.
      await page.goto(`/w/${ws}/specs?open=specs`);
      await expect(page.locator('app-spec-table [data-spec-row]').first()).toBeVisible();
      // Spec 021 (R1): no guide line, sentence or command chip in the list rows; they stand in Waits on you and Next up.
      await expect(page.locator('app-spec-table :is(app-spec-row-guide, [data-guide-sentence], ui-command-chip)'), `${ws}: no guide line in the list`).toHaveCount(0);

      // Specs table: one guided row per spec with its own entry, the mark exactly on the waiting ones, the ring on the rest.
      const rows = await guideRows(page);
      expect(rows.map((r) => r.id).sort(), `${ws}: guided rows`).toEqual([...entries.keys()].sort());
      expect(rows.filter((r) => r.marked).map((r) => r.id).sort(), `${ws}: marked rows`).toEqual(waiting);
      await expect(page.locator('app-spec-table [data-waits-mark]'), `${ws}: marks in the table`).toHaveCount(waiting.length);
      for (const row of rows) {
        const own = entries.get(row.id);
        expect(row.guide, `${ws} ${row.id}: guide kind`).toBe(own?.waits ? 'waits' : 'next');
        expect(row.ring, `${ws} ${row.id}: the Next ring`).toBe(!own?.waits);
        expect(row.hidden, `${ws} ${row.id}: the reason is no visible line`).toBe(true);
        expect(row.described, `${ws} ${row.id}: the reason describes the row link and ends its title`).toBe(true);
        expect(text(row.sentence), `${ws} ${row.id}: the row's sentence`).toBe(text(own ? sentenceOf(own.entry.reason) : '?'));
      }

      // Next up: every entry of guidance.next, in order, each with its sentence and never the marker.
      await page.goto(`/w/${ws}`);
      await expect(page.locator('app-next-up-list app-next-up-entry').first(), `${ws}: Next up renders`).toBeVisible();
      await expect(page.locator('app-spec-table'), `${ws}: no spec list on the dashboard`).toHaveCount(0);
      const fold = page.locator('app-next-up-list [data-show-all] button').first();
      if ((await fold.count()) > 0 && (await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
      const expected = nextUpEntries(guidance, body.specs);
      expect(expected.length, `${ws}: Next up has entries`).toBeGreaterThan(0);
      const shown = await nextUp(page);
      expect(shown.map((n) => n.id), `${ws}: Next up entries`).toEqual(expected.map((e) => e.spec));
      for (const [i, entry] of expected.entries()) {
        const item = shown[i];
        expect(item?.guided, `${ws} Next up ${entry.spec}: the guide line`).toBe(true);
        expect(text(item?.sentence), `${ws} Next up ${entry.spec}: the sentence`).toBe(text(sentenceOf(entry.reason)));
        expect(item?.marked, `${ws} Next up ${entry.spec}: no marker`).toBe(false);
      }
    });
  }
});
