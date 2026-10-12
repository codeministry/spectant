/**
 * ISC-149: the elements the parity table (spec 024) marks as missing appear in the app where the prototype puts them.
 * `bun run e2e -- parity -g elements` is the claim's probe. Every group of this file is one `test.describe` named after
 * its probe word (`elements` here; `icons`, `demo`, `routes`, `navigation` follow), so `-g <word>` runs one group.
 *
 * Group `elements`, pilot scope: the spec dashboard's Spec context (018-B14) and the workspace dashboard's Warnings
 * list (018-B15), against the stub API's harbor workspace (`core/fixtures/harbor*.golden.json`). The tests only read,
 * so they share the default stub session.
 *
 * Hook contract (the implementation renders these; nothing else in this file depends on markup):
 *
 *   Spec context, spec dashboard `/w/:ws/s/:id`
 *   - `[data-spec-context]`              the Spec context root. From 1120 px it sits in the 352 px rail
 *                                        (`aside.shell-rail`); below 1120 px it is the last block of the dashboard's
 *                                        main column (inside `main#main`, below every other `[data-section]`).
 *   - `#waiting`                         exactly one visible element per width, inside the visible Spec context: the
 *                                        KPI "Waiting on you" links to it on the dashboard itself (018-B10).
 *   - `[data-context-block="waiting" | "warnings" | "gates"]`
 *                                        the three blocks, in this order, each with a heading (Waiting on you,
 *                                        Warnings, Gates).
 *   - `[data-count-badge]`               the count badge in the heading row of the waiting and warnings blocks.
 *   - `[data-waiting-item]`              one per waiting item, with `data-waiting-kind` (`operator` | `manual` |
 *                                        `question`) and `data-waiting-ref` (the task or claim id); it holds
 *                                        `[data-waiting-kind-label]`, the plain chip with the kind word.
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
 *   - `[data-warnings-list]`             the list root: below 1120 px in the main column after Next up
 *                                        (`[data-next-up]`), from 1120 px in the rail after Next up.
 *   - `[data-warning-spec]`              one group per spec with warnings (value: the spec id), holding the spec link
 *                                        `[data-warning-link]` (text: the id), each `[data-warning-text]` and the
 *                                        command as `ui-command-chip`.
 *   - `[data-warnings-empty]`            the "No warnings" line when no spec has one.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { SpecPageModel } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../core/fixtures/${file}`, import.meta.url), 'utf8'));

const SPECS = read('harbor.spec.golden.json') as Record<string, SpecPageModel>;
function spec(path: string): SpecPageModel {
  const model = SPECS[path];
  if (!model) throw new Error(`harbor.spec.golden.json holds no ${path}`);
  return model;
}
/** Waiting items of all three kinds, no warnings. */
const SPEC_002 = spec('specs/002-web-console');
/** Warnings, one of them with a command. */
const SPEC_005 = spec('specs/005-config-format-choice');

type WarningItem = { readonly spec: string; readonly warning: { readonly kind: string; readonly text: string; readonly command?: string } };
type WarningGroup = { readonly items: readonly WarningItem[] };
const WORKSPACE = read('harbor.golden.json') as { readonly warningGroups: readonly WarningGroup[] };
const WARNED = WORKSPACE.warningGroups.flatMap((group) => group.items);

const GATES = ['reviewed', 'codeReviewed', 'drift', 'diagrams'] as const;
const BLOCKS = ['waiting', 'warnings', 'gates'] as const;
const KINDS = { operator: 'operator', manual: 'manual', question: 'question' } as const;

const TIERS = [
  { width: 390, tier: 'compact', rail: false },
  { width: 820, tier: 'medium', rail: false },
  { width: 1440, tier: 'wide', rail: true },
] as const;

/** Where the Spec context and the Warnings list live at this width: the rail from 1120 px, else the main column. */
const home = (page: Page, rail: boolean): Locator => page.locator(rail ? 'aside.shell-rail' : 'main#main');

async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box.y;
}

test.describe('elements', () => {
  for (const { width, tier, rail } of TIERS) {
    test.describe(`spec context at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('Spec context holds Waiting on you, Warnings and Gates where the prototype puts them', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

        const context = home(page, rail).locator('[data-spec-context]');
        await expect(context).toBeVisible();
        expect(await context.locator('[data-context-block]').evaluateAll((blocks) => blocks.map((b) => b.getAttribute('data-context-block')))).toEqual([...BLOCKS]);
        for (const name of ['Waiting on you', 'Warnings', 'Gates']) {
          await expect(context.getByRole('heading', { name, exact: true })).toBeVisible();
        }
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

      test('Waiting on you lists every item with its kind chip and a count badge', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const block = home(page, rail).locator('[data-spec-context] [data-context-block="waiting"]');
        await expect(block).toBeVisible();
        await expect(block.locator('[data-count-badge]')).toHaveText(String(SPEC_002.waitingOnYou.length));

        const items = block.locator('[data-waiting-item]');
        await expect(items).toHaveCount(SPEC_002.waitingOnYou.length);
        for (const item of SPEC_002.waitingOnYou) {
          const row = block.locator(`[data-waiting-item][data-waiting-kind="${item.kind}"][data-waiting-ref="${item.ref}"]`);
          await expect(row).toBeVisible();
          await expect(row.locator('[data-waiting-kind-label]')).toHaveText(KINDS[item.kind]);
        }
      });

      test('a question item is real data and carries no demo chip', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const questions = home(page, rail).locator('[data-spec-context] [data-waiting-item][data-waiting-kind="question"]');
        await expect(questions.first()).toBeVisible();
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
        await expect(home(page, rail).locator('[data-spec-context] #waiting, [data-spec-context]#waiting').filter({ visible: true })).toHaveCount(1);

        await page.locator('a[data-kpi="waiting"], [data-kpi="waiting"] a').first().click();
        await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/s/002' && url.hash === '#waiting');
        await expect(target).toBeInViewport();
      });
    });

    test.describe(`warnings list at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('the workspace Warnings list follows Next up and names spec, warning and command', async ({ page }) => {
        await page.goto('/w/harbor');
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

        const at = home(page, rail);
        const list = at.locator('[data-warnings-list]');
        await expect(list).toBeVisible();
        await expect(home(page, !rail).locator('[data-warnings-list]:visible')).toHaveCount(0);

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
