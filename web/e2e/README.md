# web/e2e — the Playwright layout

Every browser suite of the web lane lives here and runs through one config, `playwright.config.ts` (T28). Import
`test`, `expect`, `atWidth`, `awaitReady`, `pinClock` and `theme` from `./fixtures`, never from `@playwright/test`.

## Layout

| Path | Holds | Run with |
|------|-------|----------|
| `<area>.spec.ts` | e2e specs, one file per area: `palette`, `keyboard`, `refresh`, `narrow`, `theme`, `offline`, `smoke` | `bun run e2e -- <area> -g <name>` |
| `visual.spec.ts` | `toHaveScreenshot` baselines, `test.describe('dashboard')` and `test.describe('overview')` | `bun run test:visual -- <group> [--theme dark]` |
| `browser/<area>.spec.ts` | the real-Chromium tier: `focus`, `contrast`, `motion` (T29–T31) | `bun run test:browser -- <area>` |
| `__screenshots__/{project}/{theme}/` | committed baselines, recorded only in the container | — |
| `fixtures.ts`, `env.ts` | fixtures and the `E2E_SUITE` / `E2E_THEME` switches | — |
| `run.ts` | maps the Test Strategy's command shapes onto `playwright test` | the `web/package.json` scripts |
| `serve-dist.ts` | loopback static server for `web/dist/browser`, SPA fallback, `/api` seam for `stub-api.ts` | the config's `webServer` |
| `Dockerfile`, `container.ts` | the pinned Linux runner | `bun run test:visual:ci` |

Test names follow the Test Strategy's `-g` names: `palette -g open|filter|enter`, `keyboard -g move|enter|help`,
`refresh -g in-place|cls`, `narrow -g dashboard|column`, `theme -g system|persist`, `offline`, `smoke`.

## Command shapes

```sh
bun run e2e -- palette -g open                  # chromium, file filter + grep
bun run e2e -- --project webkit smoke           # ISC-19.1; also: bun run --cwd web test:e2e:webkit
bun run test:visual -- dashboard                # the group becomes -g dashboard
bun run test:visual -- dashboard --theme dark   # --theme becomes E2E_THEME=dark (colorScheme)
bun run test:browser -- contrast
```

Every test runs with the clock pinned (`FIXED_NOW`, opt out with `test.use({ clockAt: null })`), `timezoneId`
Europe/Berlin, `locale` en, service workers blocked, and waits on `awaitReady(page)` (`<body data-ready="true">`),
never on a timeout. Visual runs add `reducedMotion: 'reduce'`, `animations: 'disabled'` and `caret: 'hide'`. Set
the viewport per test with `test.use(atWidth(390 | 820 | 1440 | 600))`.

The config builds the app and serves it on `http://127.0.0.1:4173`; set `E2E_BASE_URL` to test an app that is
already running instead.

## Browsers and the container

`bun install` does not download browsers. Once per machine, for local e2e runs: `bunx playwright install chromium webkit`
(from `web/`).

Baselines are recorded and compared only inside `mcr.microsoft.com/playwright:v1.63.0-noble` (tag and digest in
`Dockerfile`, equal to the `@playwright/test` devDependency; `container.ts` refuses a mismatch). The config refuses
`-u` outside it.

```sh
bun run test:visual:ci -- dashboard            # compare
bun run test:visual:ci -- -u                   # record or update
bun web/e2e/container.ts e2e palette           # any suite
```

The container runs `linux/amd64` like CI; `E2E_PLATFORM=linux/arm64` gives a faster, non-authoritative look on Apple
Silicon.
