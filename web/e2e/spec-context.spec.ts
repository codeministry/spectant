/**
 * ISC-149: the spec dashboard's Spec context (018-B14) and the workspace dashboard's Warnings list (018-B15) render in
 * the app's layout at every width tier. `bun run e2e -- spec-context.spec.ts` is the claim's probe; the group keeps
 * its probe word, so `-g elements` runs it too.
 *
 * The tests run against the stub API's harbor workspace (`core/fixtures/harbor*.golden.json`, read through
 * `harbor-fixtures.ts`). They only read, so they share the default stub session.
 *
 * Hook contract (the implementation renders these; nothing else in this file depends on markup):
 *
 *   Spec context, spec dashboard `/w/:ws/s/:id`
 *   - `[data-spec-context]`              the Spec context root. From 1120 px it sits in the 352 px rail
 *                                        (`aside.shell-rail`); below 1120 px it is the last block of the dashboard's
 *                                        main column (inside `main#main`, below every other `[data-section]`).
 *   - `#waiting`                         exactly one visible element per width, inside the visible Spec context: the
 *                                        KPI "Waiting on you" links to it on the dashboard itself (018-B10).
 *   - `[data-context-block="warnings" | "gates"]`
 *                                        the two blocks, in this order, each with a heading (Warnings, Gates). Spec 020
 *                                        (ISC-239): the waiting block is gone; from 1120 px the rail opens with the
 *                                        guidance spot (`app-spec-rail-guide`: `[data-rail-block="next"]` and the
 *                                        spec's `ui-waits-block[data-rail-block="waits"]`), below 1120 px the
 *                                        next-step card `[data-guidance-spot]` holds them (`[data-guidance-waits]`).
 *   - `[data-count-badge]`               the count badge in the heading row of the warnings block.
 *   - `[data-context-warning]`           one per warning of the spec; `[data-warning-command]` inside holds its
 *                                        command when the warning has one.
 *   - `[data-gate-row]`                  one per gate, `data-gate` = `reviewed` | `codeReviewed` | `drift` |
 *                                        `diagrams`, its value in `[data-gate-value]`.
 *   - `[data-context-kbd]`               the key line `[ ] previous / next spec · Esc workspace` below the blocks
 *                                        (rail only).
 *   - `[data-demo-chip]`                 the demo chip (word `demo`) on every mocked block or item (ISC-149.1);
 *                                        Spec context carries none: core delivers all three kinds, warnings and
 *                                        gates (`core/src/spec.ts`), so nothing in it is a mock.
 *
 *   Warnings list, workspace dashboard `/w/:ws`
 *   - `[data-warnings-list]`             the list root: in the main column after Next up (`[data-next-up]`) on every
 *                                        width. Spec 058 (ISC-394): the dashboard has no rail at any tier.
 *   - `[data-warning-spec]`              one group per spec with warnings (value: the spec id), holding the spec link
 *                                        `[data-warning-link]` (text: the id), each `[data-warning-text]` and the
 *                                        command as `ui-command-chip`.
 *   - `[data-warnings-empty]`            the "No warnings" line when no spec has one.
 */
import { atWidth, expect, test } from './fixtures';
import { home, spec, TIERS, top, WARNED } from './harbor-fixtures';

/** Waiting items of all three kinds, no warnings. */
const SPEC_002 = spec('specs/002-web-console');
/** Warnings, one of them with a command. */
const SPEC_005 = spec('specs/005-config-format-choice');

const GATES = ['reviewed', 'codeReviewed', 'drift', 'diagrams'] as const;
const BLOCKS = ['warnings', 'gates'] as const;
const KINDS = { operator: 'operator', manual: 'manual', question: 'question' } as const;

test.describe('elements', () => {
  for (const { width, tier, rail } of TIERS) {
    test.describe(`spec context at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('Spec context holds Waiting on you, Warnings and Gates in the rail from 1120 px, else last in the main column', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

        const context = home(page, rail).locator('[data-spec-context]');
        await expect(context).toBeVisible();
        expect(await context.locator('[data-context-block]').evaluateAll((blocks) => blocks.map((b) => b.getAttribute('data-context-block')))).toEqual([...BLOCKS]);
        for (const name of ['Warnings', 'Gates']) {
          await expect(context.getByRole('heading', { name, exact: true })).toBeVisible();
        }
        // Spec 020 (ISC-239): from 1120 px the Spec context opens with the guidance spot, as every tab's rail does.
        if (rail) await expect(context.locator('app-spec-rail-guide [data-rail-block="next"]')).toBeVisible();
        // The other home never holds a second, visible Spec context.
        await expect(home(page, !rail).locator('[data-spec-context]:visible')).toHaveCount(0);

        if (rail) {
          const box = await page.locator('aside.shell-rail').boundingBox();
          expect(box?.width).toBe(352);
          await expect(context.locator('[data-context-kbd]')).toBeVisible();
        } else {
          // The last block of the main column: below every other section of the dashboard.
          const contextTop = await top(context);
          for (const section of await page.locator('main#main [data-section]:visible').all()) {
            expect(await top(section)).toBeLessThan(contextTop);
          }
        }
      });

      test('Waits on you lists every waiting entry of the spec with its kind chip and a count', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        // Spec 020 (ISC-239): the guidance spot holds the spec's Waits on you, the rail's from 1120 px, the card's below.
        const block = rail
          ? home(page, rail).locator('[data-spec-context] ui-waits-block[data-rail-block="waits"]')
          : home(page, rail).locator('[data-guidance-spot] ui-waits-block[data-guidance-waits]');
        await expect(block).toBeVisible();
        const total = String(SPEC_002.waitingOnYou.length);
        await expect(block).toHaveAttribute('data-count', total);
        await expect(block.locator('ui-section-header ui-chip')).toHaveText(total);
        const kinds = block.locator('[data-top] [data-kind], [data-row] [data-kind]');
        await expect(kinds).toHaveCount(SPEC_002.waitingOnYou.length);
        const shown = (await kinds.allTextContents()).map((t) => t.trim()).sort();
        expect(shown).toEqual(SPEC_002.waitingOnYou.map((item) => KINDS[item.kind]).sort());
        await expect(block.locator('input[type="checkbox"]')).toHaveCount(0);
      });

      test('a question item is real data and carries no demo chip', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const spot = home(page, rail).locator(rail ? '[data-spec-context]' : '[data-guidance-spot]');
        await expect(spot.locator('ui-waits-block [data-row][data-item="question"]').first()).toBeVisible();
        await expect(spot.locator('[data-demo-chip]')).toHaveCount(0);
        await expect(home(page, rail).locator('[data-spec-context] [data-demo-chip]')).toHaveCount(0);
      });

      test('Warnings lists every warning of the spec with its command', async ({ page }) => {
        await page.goto('/w/harbor/s/005');
        const block = home(page, rail).locator('[data-spec-context] [data-context-block="warnings"]');
        await expect(block).toBeVisible();
        await expect(block.locator('[data-count-badge]')).toHaveText(String(SPEC_005.warnings.length));
        const lines = block.locator('[data-context-warning]');
        await expect(lines).toHaveCount(SPEC_005.warnings.length);
        for (const warning of SPEC_005.warnings) {
          const line = lines.filter({ hasText: warning.text });
          await expect(line).toHaveCount(1);
          if (warning.command) await expect(line.locator('[data-warning-command]')).toHaveText(warning.command);
        }
      });

      test('Gates shows one row per gate with its value', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const block = home(page, rail).locator('[data-spec-context] [data-context-block="gates"]');
        await expect(block).toBeVisible();
        expect(await block.locator('[data-gate-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-gate')))).toEqual([...GATES]);
        for (const gate of GATES) {
          await expect(block.locator(`[data-gate-row][data-gate="${gate}"] [data-gate-value]`)).not.toBeEmpty();
        }
      });

      test('the KPI Waiting on you jumps to #waiting on the dashboard itself', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const target = page.locator('#waiting:visible');
        await expect(target).toHaveCount(1);
        // Spec 020 (T19, ISC-239): from 1120 px `#waiting` is the rail's Spec context; below it the guidance spot, the
        // next-step card right under the spec head, carries it.
        const holder = rail
          ? home(page, rail).locator('[data-spec-context] #waiting, [data-spec-context]#waiting')
          : home(page, rail).locator('app-spec-dashboard [data-section="next"][data-guidance-spot]#waiting');
        await expect(holder.filter({ visible: true })).toHaveCount(1);

        await page.locator('a[data-kpi="waiting"], [data-kpi="waiting"] a').first().click();
        await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/s/002' && url.hash === '#waiting');
        await expect(target).toBeInViewport();
      });
    });

    test.describe(`warnings list at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('the workspace Warnings list follows Next up and names spec, warning and command', async ({ page }) => {
        await page.goto('/w/harbor?open=warnings');
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

        // Spec 058 (ISC-394): one column at every tier, no rail on the dashboard; the list sits in the main column.
        const at = page.locator('main#main');
        const list = at.locator('[data-warnings-list]');
        await expect(list).toBeVisible();
        await expect(page.locator('aside.shell-rail')).toHaveCount(0);
        await expect(page.locator('[data-warnings-list]:visible')).toHaveCount(1);

        const nextUp = at.locator('[data-next-up]');
        await expect(nextUp).toBeVisible();
        const box = await nextUp.boundingBox();
        expect(await top(list)).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));

        for (const { spec: id, warning } of WARNED) {
          const group = list.locator(`[data-warning-spec="${id}"]`);
          await expect(group).toBeVisible();
          await expect(group.locator('[data-warning-link]').first()).toHaveText(id);
          if (warning.kind === 'fog') continue; // open fog has its own line, worded by the app
          await expect(group.locator('[data-warning-text]', { hasText: warning.text })).toHaveCount(1);
          if (warning.command) await expect(group.locator('ui-command-chip', { hasText: warning.command })).toHaveCount(1);
        }
      });
    });
  }
});
