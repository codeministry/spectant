/**
 * T66 · T67 · ISC-152 (spec 024): the visual baselines of every prototype view and every new design of the parity
 * sweep, at 390, 600 (the cmux panel), 820 and 1440, in both themes:
 *
 *   bun run test:visual -- parity                 light (T66)
 *   bun run test:visual -- parity --theme dark    dark  (T67)
 *
 * The table `VIEWS` holds the 19 prototype views `parity.spec.ts` group `routes` reaches (spec-board.html and
 * board-live.html share one route, so one row), the two state galleries under `/__ui` captured as their own sections,
 * and the new designs: Settings, NotFound and its spec variant, Features, Milestones, Idea, the Tech tabs, the
 * workspace board, the spec's data and docs tabs. Baselines live under
 * `__screenshots__/chromium/{light,dark}/visual-parity.spec.ts/` and are recorded only in the pinned container
 * (`bun run test:visual:ci -- parity -u`). The clock is pinned by the fixtures (FIXED_NOW); each test runs in its own
 * stub session, reset first. Pages are full page; an open dialog or the palette is a viewport capture, since the top
 * layer is fixed to the viewport. Grep words of the other visual groups (`help`, `tech`, `overview`) also match the
 * rows of those pages here; the probes stay green, they only run more.
 */
import type { Page } from '@playwright/test';

import { TECH_TABS } from '../src/app/layout/shell/page-tabs';
import { atWidth, awaitReady, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';
import { STUB_NOTES } from './stub-api';

const SESSION = 'X-Spectant-Stub-Session';
const SPEC = '/w/harbor/s/002';
const NOTE = STUB_NOTES.find((note) => note.workspace === 'harbor' && note.anchor?.spec === '002');
const COMPARE = { maxDiffPixelRatio: 0 } as const;

interface View {
  readonly name: string;
  readonly path: string;
  /** The host that must be visible before the capture. */
  readonly host: string;
  /** A step after load (open a dialog or the palette); the capture is then the viewport. */
  readonly open?: (page: Page) => Promise<void>;
  /** Content drawn after the host (a figure, a diagram) that must be there before the capture. */
  readonly ready?: string;
  /** Capture only this element (a gallery section) instead of the page. */
  readonly element?: string;
}

const click =
  (selector: string) =>
  async (page: Page): Promise<void> => {
    await page.locator(selector).first().click();
  };

const VIEWS: readonly View[] = [
  // The 19 prototype views (parity.spec.ts group `routes`).
  { name: 'index', path: '/', host: 'app-overview-page' },
  { name: 'workspace', path: '/w/harbor', host: 'app-dashboard-page' },
  { name: 'spec', path: SPEC, host: 'app-spec-dashboard' },
  { name: 'spec-detail', path: `${SPEC}/status`, host: 'app-status-tab' },
  {
    name: 'gate-dialog',
    path: '/w/harbor/s/003/status',
    host: 'app-status-tab',
    open: click('app-spec-head [data-gate-action]'),
    ready: 'app-spec-head [data-gate-dialog]',
  },
  { name: 'spec-tasks', path: `${SPEC}/tasks`, host: 'app-tasks-tab' },
  { name: 'spec-timeline', path: `${SPEC}/timeline`, host: 'app-timeline-tab' },
  {
    name: 'board-live',
    path: `${SPEC}/board`,
    host: 'app-board-tab section.board[data-view="lanes"]',
  },
  {
    name: 'board-flow',
    path: `${SPEC}/board?view=flow`,
    host: 'app-board-tab app-flow-view',
  },
  {
    name: 'board-history',
    path: `${SPEC}/board?frame=0`,
    host: 'app-board-tab [data-frame-chip="history"]',
  },
  { name: 'board-matrix', path: `${SPEC}/matrix`, host: 'app-matrix-tab' },
  {
    name: 'states',
    path: '/__ui',
    host: '[data-gallery="states"]',
    element: '[data-gallery="states"]',
  },
  {
    name: 'board-states',
    path: '/__ui',
    host: '[data-gallery="board-states"]',
    element: '[data-gallery="board-states"]',
  },
  { name: 'library', path: '/w/harbor/library', host: 'app-library-page' },
  {
    name: 'note',
    path: `${SPEC}/notes/${NOTE?.id ?? ''}`,
    host: '[data-notes-editor]',
  },
  {
    name: 'workspaces',
    path: '/settings/workspaces',
    host: 'app-settings-workspaces-page',
  },
  {
    name: 'help',
    path: '/help',
    host: 'app-help-page',
    ready: 'figure[data-workflow-figure] [data-diagram][data-rendered] svg[role="img"]',
  },
  {
    name: 'palette',
    path: '/w/harbor',
    host: 'app-dashboard-page',
    open: click('header [data-control="palette"]'),
    ready: '[data-ui="command-palette"]',
  },
  // The new designs.
  { name: 'settings', path: '/settings', host: 'app-settings-page' },
  { name: 'not-found', path: '/nowhere', host: 'app-not-found' },
  { name: 'not-found-spec', path: '/w/harbor/s/099', host: 'app-not-found' },
  { name: 'features', path: '/w/harbor/features', host: 'app-features-page' },
  {
    name: 'milestones',
    path: '/w/harbor/milestones',
    host: 'app-milestones-page',
  },
  {
    name: 'idea',
    path: '/w/harbor/ideas/console-audit-log',
    host: 'app-idea-page',
  },
  { name: 'ws-board', path: '/w/harbor/board', host: 'app-board-page' },
  ...TECH_TABS.map((tab) => ({
    name: `tech-${tab}`,
    path: `/w/harbor/tech/${tab}`,
    host: 'app-tech-page',
    ...(tab === 'architecture' ? { ready: 'app-tech-docs-tab figure.mermaid-figure .mermaid-svg svg' } : {}),
  })),
  ...(['claims', 'evidence'] as const).map((tab) => ({
    name: `data-${tab}`,
    path: `${SPEC}/${tab}`,
    host: `app-${tab}-tab`,
  })),
  ...(['plan', 'design', 'decisions', 'constitution'] as const).map((tab) => ({
    name: `docs-${tab}`,
    path: `${SPEC}/${tab}`,
    host: 'app-docs-tab',
  })),
];

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-parity-${info.testId}-${String(info.retry)}`;
  await page.setExtraHTTPHeaders({ [SESSION]: session });
  const reset = await request.post('/api/__stub/reset', {
    headers: { [SESSION]: session },
  });
  expect(reset.status()).toBe(204);
});

/** Network quiet, fonts loaded, no skeleton or busy notice, the run's theme, the view's own content drawn. */
async function settle(page: Page, view: View): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator(view.host).first()).toBeVisible();
  // The dev gallery shows skeletons and busy states on purpose; it sets `data-ready` once its popover is open and the
  // fonts are loaded. Every other view is settled once no skeleton or busy notice is left.
  if (view.path.startsWith('/__ui')) await awaitReady(page);
  else await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  if (view.open) await view.open(page);
  if (view.ready !== undefined) await expect(page.locator(view.ready).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('parity', () => {
  expect(NOTE, 'the stub holds a harbor note anchored on 002').toBeDefined();

  for (const width of [WIDTHS.phone, WIDTHS.panel, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const view of VIEWS) {
        test(`${view.name} ${String(width)}`, async ({ page }) => {
          // The dev gallery sits outside the shell and takes its theme from `?theme=`, not from the system.
          await page.goto(view.path.startsWith('/__ui') ? `${view.path}?theme=${theme}` : view.path);
          await settle(page, view);
          const file = `${view.name}-${String(width)}.png`;
          if (view.element !== undefined) await expect(page.locator(view.element)).toHaveScreenshot(file, COMPARE);
          else
            await expect(page).toHaveScreenshot(file, {
              ...COMPARE,
              fullPage: view.open === undefined,
            });
        });
      }
    });
  }
});
