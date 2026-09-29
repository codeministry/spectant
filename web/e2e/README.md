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
| `serve-dist.ts` | loopback static server for `web/dist/browser`, SPA fallback, `/api` answered by `stub-api.ts` | the config's `webServer` |
| `stub-api.ts` | the real `/api` contract fed from `core/fixtures/*.golden.json`, states per request (see below) | plugged in by `serve-dist.ts` |
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

## The stub API

`serve-dist.ts` answers `/api` with `stubApi()` from `stub-api.ts`: the same paths, shapes, status codes, headers and
ETags as `server/src/api.ts` and `server/src/settings.ts`, but fed from files. A dashboard body is the golden
snapshot `core/fixtures/<fixture>.golden.json` as the server serializes it; the list's `counts` are that golden's
`kpis`. `stub-api.test.ts` sends the same requests to the stub and to the real handlers and compares them byte for
byte, so a server contract change fails there first.

| Route | Answers |
|-------|---------|
| `GET/HEAD /api/workspaces` | `[{slug, name, pathTail, readable, error?, counts}]`, harbor then lantern |
| `GET/HEAD /api/workspaces/:slug/dashboard` | the golden model; 404 unknown slug, 409 the unreadable workspace |
| `GET/HEAD/PUT /api/settings` | in memory from the schema defaults (`system`, `en`, 30, `true`), per session |
| `POST /api/__stub/reset` | stub only: restores the defaults of the request's session, 204 |

The state is chosen per request by a header, so each test picks its own without restarting the server, and parallel
workers never race:

| Header | Values | Absent |
|--------|--------|--------|
| `X-Spectant-Stub-State` | `two-workspaces` (harbor, lantern), `empty` (no workspace), `unreadable` (lantern `readable: false`, `error: 'missing'`, `counts: null`, its dashboard 409) | `two-workspaces`; an unknown value is a 400 |
| `X-Spectant-Stub-Session` | any id; scopes the settings store | one shared session |

```ts
test.describe('overview: empty', () => {
  test.use({ extraHTTPHeaders: { 'X-Spectant-Stub-State': 'empty' } });
  // …
});

// A spec that PUTs settings (theme -g persist) names its own session, so another worker's theme never leaks in,
// and resets it first, so a retry or a second project starts from the defaults:
test.describe('theme: persist', () => {
  test.use({ extraHTTPHeaders: { 'X-Spectant-Stub-Session': 'theme-persist' } });
  test.beforeEach(async ({ request }) => {
    await request.post('/api/__stub/reset', { headers: { 'X-Spectant-Stub-Session': 'theme-persist' } });
  });
  // …
});
```

`extraHTTPHeaders` reaches every request of the page, the app's `fetch('/api/…')` included. Import `STATE_HEADER`,
`SESSION_HEADER` and `STUB_STATES` from `./stub-api` rather than spelling the names. The stub reads no clock and no
registry: every answer is a function of the golden files and the request.

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
