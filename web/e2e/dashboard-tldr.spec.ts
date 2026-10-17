/**
 * T26 · ISC-51: the dashboard shows the workspace's TL;DR (`specs/tldr.md`) as a card below the KPI tiles, and no card
 * where the file does not exist. `bun run e2e -- dashboard -g tldr` is the probe.
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
}

function briefOf(golden: string): DashboardBrief | null {
  const model = JSON.parse(readFileSync(new URL(`../../core/fixtures/${golden}.golden.json`, import.meta.url), 'utf8')) as {
    brief: DashboardBrief | null;
  };
  return model.brief;
}

const HARBOR = briefOf('harbor');
const LANTERN = briefOf('lantern');

/** The skill command the card offers; the golden holds the TL;DR, not the command that writes it. */
const TLDR_COMMAND = '/spec-tldr';
/**
 * The KPI tiles above the Brief (`kpi-band.html`): the band's tiles from 560 px of band width, the Pulse card (its compact
 * form, `data-kpi="pulse"`) below; the container query hides the other, so only visible ones count.
 */
const TILES = 'app-kpi-band :is(.band > [data-kpi], [data-kpi="pulse"])';

/** The first Markdown heading of the TL;DR, as the reader sees it above the sections. */
function firstHeading(markdown: string): string {
  const match = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(markdown);
  if (!match?.[1]) throw new Error('the golden TL;DR has no heading');
  return match[1];
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

      await expect(card.locator('[data-brief-prose] :is(h1, h2, h3, h4, h5, h6)').first()).toHaveText(
        firstHeading(brief.markdown),
      );

      const command = card.locator('[data-brief-command]');
      await expect(command).toBeVisible();
      await expect(command).toContainText(TLDR_COMMAND);
    });

    test(`no tldr card on a workspace without specs/tldr.md at ${width}`, async ({ page }) => {
      expect(LANTERN, 'lantern golden has no brief').toBeNull();
      await openDashboard(page, 'lantern');

      await expect(page.locator(TILES).filter({ visible: true }).first()).toBeVisible();
      await expect(page.locator('[data-ui="brief"]')).toHaveCount(0);
      await expect(page.locator('app-brief')).toBeHidden();
    });
  });
}
