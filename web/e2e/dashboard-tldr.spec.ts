/**
 * T26 · ISC-51: the dashboard shows the workspace's TL;DR (`specs/tldr.md`) as a card below the KPI tiles; where the
 * file does not exist, a compact card with the model's `tldrCommand` (spec 074, ISC-627). `bun run e2e -- dashboard -g tldr`
 * is the probe.
 *
 * Expected texts come from the dashboard goldens (`core/fixtures/<workspace>.golden.json`, the model the stub serves):
 * harbor carries a `brief`, lantern has `brief: null`. Selectors are the Brief's own hooks (`[data-ui="brief"]`,
 * `[data-brief-*]`) and the KPI band's visible tiles (`TILES`).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';

/**
 * The fields of core's `DashboardBrief` (`core/src/dashboard.ts`) this spec reads, re-declared structurally as the
 * Brief does (`brief.ts`): a type import of that module type-checks its whole value graph under `e2e/tsconfig.json`,
 * which rejects it.
 */
interface DashboardBrief {
  readonly markdown: string;
  readonly generated: string | null;
  readonly sections: Readonly<Record<string, string>>;
}

function modelOf(golden: string): { brief: DashboardBrief | null; tldrCommand: string | null } {
  return JSON.parse(readFileSync(new URL(`../../core/fixtures/${golden}.golden.json`, import.meta.url), 'utf8')) as {
    brief: DashboardBrief | null;
    tldrCommand: string | null;
  };
}

const HARBOR = modelOf('harbor').brief;
const LANTERN = modelOf('lantern').brief;
/** Core's `tldrCommand` of each golden (spec 074, ISC-627): `/spec tldr` while tldr.md is absent or stale. */
const HARBOR_COMMAND = modelOf('harbor').tldrCommand;
const LANTERN_COMMAND = modelOf('lantern').tldrCommand;

/**
 * The KPI tiles above the Brief (`kpi-band.html`): the band's tiles from 560 px of band width, the Pulse card (its compact
 * form, `data-kpi="pulse"`) below; the container query hides the other, so only visible ones count.
 */
const TILES = 'app-kpi-band :is(.band > [data-kpi], [data-kpi="pulse"])';

/** The first sentence of the TL;DR's first section (core's `sections`, file order), as the card shows it whole. */
function firstSentence(sections: Readonly<Record<string, string>>): string {
  const first = Object.values(sections)[0];
  const sentence = first?.split(/(?<=\.)\s/u)[0];
  if (!sentence) throw new Error('the golden TL;DR has no first section');
  return sentence;
}

/**
 * Open a dashboard and wait until its model reached the DOM: the KPI tiles render in the same `@if (view())` block as
 * the Brief (`dashboard-page.html`). `awaitReady` is not used, no app route sets `body[data-ready]` (see `smoke.spec.ts`).
 */
async function openDashboard(page: Page, ws: string): Promise<void> {
  await page.goto(`/w/${ws}`);
  await expect(page.locator(TILES).filter({ visible: true }).last()).toBeVisible();
}

for (const width of [1440, 390] as const) {
  test.describe(`dashboard tldr at ${width}`, () => {
    test.use(atWidth(width));

    test(`tldr card sits below the KPI tiles on harbor at ${width}`, async ({ page }) => {
      expect(HARBOR, 'harbor golden carries a brief').not.toBeNull();
      const brief = HARBOR as DashboardBrief;
      await openDashboard(page, 'harbor');

      const card = page.locator('[data-ui="brief"]');
      await expect(card).toBeVisible();

      const tiles = page.locator(TILES).filter({ visible: true });
      await expect(tiles.last()).toBeVisible();
      const lastTile = await tiles.last().boundingBox();
      const band = await page.locator('app-kpi-band').boundingBox();
      const box = await card.boundingBox();
      expect(lastTile && band && box, 'card, band and last tile have boxes').toBeTruthy();
      if (!lastTile || !band || !box) return;
      expect(box.y).toBeGreaterThanOrEqual(lastTile.y + lastTile.height);
      expect(box.y).toBeGreaterThanOrEqual(band.y + band.height);

      await expect(card.locator('[data-brief-label]')).toBeVisible();

      expect(brief.generated, 'harbor golden has a generated date').not.toBeNull();
      const generated = brief.generated as string;
      const asOf = card.locator('[data-brief-as-of]');
      const time = asOf.locator('time');
      await expect(asOf).toBeVisible();
      await expect(time).toHaveAttribute('datetime', generated);
      // `generated:` is an instant: its local date in the test's zone, in the shared `en` date form `03/07/2026`.
      const day = await page.evaluate(
        (iso) => new Intl.DateTimeFormat('en-US', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(Date.parse(iso)),
        generated,
      );
      await expect(time).toHaveText(day);
      await expect(asOf).toHaveText(`as of ${day}`);

      // Spec 021 (T26, ISC-246): the card stands on its first section, whole; the file's title before it is not shown.
      await expect(card.locator('[data-brief-first]')).toContainText(firstSentence(brief.sections));

      // Spec 074 (ISC-627): the model's command for a stale tldr.md stands in the head as a copy chip; none when fresh.
      const command = card.locator('[data-brief-head] [data-brief-command]');
      if (HARBOR_COMMAND === null) await expect(command).toHaveCount(0);
      else await expect(command.locator('code')).toHaveText(HARBOR_COMMAND);
    });

    test(`a compact tldr card with the command on a workspace without specs/tldr.md at ${width}`, async ({ page }) => {
      expect(LANTERN, 'lantern golden has no brief').toBeNull();
      expect(LANTERN_COMMAND, 'lantern golden names the command').toBe('/spec tldr');
      await openDashboard(page, 'lantern');

      await expect(page.locator(TILES).filter({ visible: true }).first()).toBeVisible();
      const card = page.locator('[data-ui="brief"][data-brief-missing]');
      await expect(card).toBeVisible();
      await expect(card.locator('[data-brief-missing-hint]')).toBeVisible();
      await expect(card.locator('[data-brief-command] code')).toHaveText('/spec tldr');
      await expect(card.locator('[data-brief-prose]')).toHaveCount(0);
    });
  });
}
