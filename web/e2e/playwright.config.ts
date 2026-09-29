/**
 * Playwright configuration for every browser suite of the web lane (plan 001 § Approach ②, T28).
 *
 * One config, three suites, chosen by `E2E_SUITE` (set by `e2e/run.ts`, which the `web/package.json` scripts call):
 *
 *   e2e      `bun run e2e -- <area> -g <name>`            every `<area>.spec.ts` except the visual and browser tiers
 *   visual   `bun run test:visual -- <group> [--theme dark]`  `visual.spec.ts`, `toHaveScreenshot` baselines
 *   browser  `bun run test:browser -- <area>`             `browser/<area>.spec.ts`, the real-Chromium tier
 *   (unset)  plain `playwright test`                      everything, so `--list` shows the whole layout
 *
 * Projects: `chromium` runs all three suites; `webkit` runs only `smoke.spec.ts` (ISC-19.1, the cmux web view).
 * Theme: `E2E_THEME` = `light` (default) | `dark` drives `colorScheme`; the app's system mode follows it. Baselines are
 * stored per project and theme under `e2e/__screenshots__/{projectName}/{theme}/`, and are only ever written inside
 * the pinned Linux container (`bun run test:visual:ci`), never on a developer's host (plan 001 § Risks).
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { suite, theme } from './env';

const ci = Boolean(process.env['CI']);
const inContainer = process.env['SPECTANT_E2E_CONTAINER'] === '1';

/** Loopback only (ISC-2): the served app never binds a public interface. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:4173';
const externalBaseURL = process.env['E2E_BASE_URL'];
const baseURL = externalBaseURL ?? DEFAULT_BASE_URL;

// Baselines are rendered by the container's fonts and Chromium build; one taken on macOS would drift from Linux CI.
const updating = process.argv.some((a) => a === '-u' || a.startsWith('--update-snapshots'));
if (updating && !inContainer) {
  throw new Error(
    'Snapshots are recorded only inside the pinned Playwright Linux container: run `bun run test:visual:ci -- -u` ' +
      '(see web/e2e/README.md).',
  );
}

// Absolute, so the `web/playwright.config.mjs` re-export resolves the same layout as `--config e2e/playwright.config.ts`.
const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB = fileURLToPath(new URL('..', import.meta.url));

// `visual.spec.ts` and every `visual-<page>.spec.ts` (spec 002: `visual-spec`, `visual-spec-notes`, `visual-board`).
const VISUAL = /visual(-[a-z-]+)?\.spec\.ts$/;
const BROWSER = /browser\/.*\.spec\.ts$/;
const SMOKE = /smoke\.spec\.ts$/;

/** The chromium project's slice of the layout for the selected suite. */
function chromiumFiles(): { testMatch?: RegExp; testIgnore?: RegExp[] } {
  switch (suite) {
    case 'visual':
      return { testMatch: VISUAL };
    case 'browser':
      return { testMatch: BROWSER };
    case 'e2e':
      return { testIgnore: [VISUAL, BROWSER] };
    case undefined:
      return {};
  }
}

export default defineConfig({
  testDir: HERE,
  testMatch: /.*\.spec\.ts$/,
  outputDir: join(HERE, '.results'),
  snapshotPathTemplate: `{testDir}/__screenshots__/{projectName}/${theme}/{testFilePath}/{arg}{ext}`,
  // A missing baseline is a failure, not a silent first recording.
  updateSnapshots: 'none',
  fullyParallel: true,
  forbidOnly: ci,
  // A retry would hide exactly the nondeterminism the baselines exist to catch.
  retries: 0,
  ...(ci ? { workers: 2 } : {}),
  reporter: ci ? [['list'], ['html', { open: 'never', outputFolder: join(HERE, '.report') }]] : [['list']],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL,
    colorScheme: theme,
    locale: 'en',
    timezoneId: 'Europe/Berlin',
    // Visual baselines never catch a transition mid-flight; the e2e and browser tiers keep real motion (ISC-66
    // measures reduced motion explicitly with `emulateMedia`).
    reducedMotion: suite === 'visual' ? 'reduce' : 'no-preference',
    screenshot: 'only-on-failure',
    trace: ci ? 'retain-on-failure' : 'off',
    // No request may leave loopback (ISC-2); a service worker would hide requests from `page.route`.
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      // The viewport is set per test with `test.use(atWidth(…))` (fixtures.ts); this is only the fallback.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      ...chromiumFiles(),
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
      testMatch: SMOKE,
    },
  ],
  // `E2E_BASE_URL` points the suites at an app that is already running (the real binary, say); otherwise the built
  // app is served from `web/dist/browser` on loopback by `serve-dist.ts`, built first so `bun run verify` needs no
  // prior build step.
  ...(externalBaseURL === undefined
    ? {
        webServer: {
          command: 'bun run build && bun e2e/serve-dist.ts',
          cwd: WEB,
          url: `${DEFAULT_BASE_URL}/`,
          reuseExistingServer: !ci,
          timeout: 180_000,
          stdout: 'ignore',
          stderr: 'pipe',
        },
      }
    : {}),
});
