# <picture><source media="(prefers-color-scheme: dark)" srcset="../../docs/logo.svg"><img src="../../docs/logo-light.svg" alt="" height="28" align="absmiddle"></picture> web/e2e — the Playwright layout

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
Europe/Berlin, `locale` en, service workers blocked, and waits on its own render assertions (a locator with an
expected count or text, e.g. `await expect(page.locator(CARDS)).toHaveCount(n)`), never on a timeout. The app sets
`data-ready` on no real route; only the dev UI gallery (`/__ui`) sets it, so `awaitReady(page)` is for the `browser/` runs
against the gallery. Visual runs add `reducedMotion: 'reduce'`, `animations: 'disabled'` and `caret: 'hide'`. Set
the viewport per test with `test.use(atWidth(390 | 820 | 1440 | 600))`.

The config builds the app and serves it on `http://127.0.0.1:4173`; set `E2E_BASE_URL` to test an app that is
already running instead.

## The stub API

`serve-dist.ts` answers `/api` with `stubApi()` from `stub-api.ts`: the same paths, shapes, status codes, headers and
ETags as the server's routes (`server/src/cli/routes.ts` lists them, `server/src/infra/http/json.ts` answers the JSON
and its ETag, `server/src/settings/routes.ts` the settings), but fed from files. A dashboard body is the golden
snapshot `core/fixtures/<fixture>.golden.json` as the server serializes it; the list's `counts` are that golden's
`kpis`. `stub-api.test.ts` sends the same requests to the stub and to the real handlers and compares them byte for
byte, so a server contract change fails there first.

| Route | Answers |
|-------|---------|
| `GET/HEAD /api/workspaces` | `[{slug, name, pathTail, readable, error?, counts}]`, harbor then lantern |
| `GET/HEAD /api/workspaces/:slug/dashboard` | the golden model; 404 unknown slug, 409 the unreadable workspace |
| `GET/HEAD /api/workspaces/:slug/planning` and every route of `WORKSPACE_ROUTE_TABLE` | the whole golden file of the route's family, `core/fixtures/<fixture>.planning.golden.json` (`GOLDEN_FAMILY.planning`, not keyed by folder), matched with `matchWorkspacePath`; built at `2026-03-20`, so a live server can differ in the milestones' `state` alone; 404 unknown slug, 405 with `allowForWorkspace(route)`, 409 the unreadable workspace |
| `GET/HEAD /api/workspaces/:slug/library` | the workspace's `LibraryCatalog`: core's `readCatalog` over the fixture tree made deterministic (fixed times, group heads and fog lines from the spec goldens and `core/fixtures/<fixture>.tech.golden.json`), plus `STUB_LIBRARY` on harbor; `EMPTY_CATALOG` under `X-Spectant-Stub-Library: empty`; 404 unknown slug, 405 with `allowForWorkspace(route)`, 409 the unreadable workspace |
| `GET/HEAD …/:slug/library/doc?path=` | one Markdown document of that catalog as core's `renderDocsMarkdown` page; 404 for any path the catalog does not list as one |
| `GET/HEAD …/:slug/library/search?q=` | the `LibrarySearchResult` over the catalog's documents; `{query: '', hits: []}` for a blank `q` |
| `GET/HEAD …/:slug/library/asset?path=` | the fixture tree's image under `specs/` (harbor `tech/overview.png`) with `evidenceFileHeaders` of core's `mediaTypeOf` and a strong ETag over the bytes; 403 for a path that leaves `specs/` (`..`, absolute, backslash, a second encoding layer, a symlink out) or a file that is not an image, 404 for no file |
| `GET/HEAD /proto/:ws/:spec/:folder/*` | one file of a catalog prototype through core's resolver, every answer with `PROTOTYPE_CSP` (forwarded by `serve-dist.ts`) |
| `GET/HEAD …/:ws/specs/:id` and every read route of `SPEC_ROUTE_TABLE` (`server/src/contracts/spec-routes.contract.ts`) | the per-spec value of the route's golden family, `core/fixtures/<tree>.<family>.golden.json` (`GOLDEN_FAMILY`, plus `live`); `:id` is `NNN`, the folder or the bare slug, archived specs too |
| `…/evidence/file?path=` | core's `resolveEvidencePath` over the fixture tree's real `artifacts/` and `.evidence/`; the file with `evidenceFileHeaders`, 403 for what confinement refuses, 404 for no file |
| `POST …/gate/reviewed`, `POST …/tasks/:tid/check` | the two writes, validated with the contract's `is…Request` (400), outcome scripted per request (below) |
| `GET/HEAD /api/lifeos` | `{present}`: true only under the `frontier` lock fixture |
| `GET/HEAD/PUT /api/settings` | in memory from the schema defaults (`system`, `en`, 30, `true`, `false`), per session |
| `POST /api/__stub/reset` | stub only: restores the settings and drops the writes of the request's session, 204 |
| `POST /api/__stub/bump-run?ws=&spec=&task=` | stub only (spec 027, T33): moves that task's run one run event on for the request's session, none → `dispatched` → `building` → `patched` → `applied-open` (`applied` once tasks.md ticked it), the last stays; the live frame's body and ETag change. 204; 404 for an unknown workspace, spec or task or an `absent` card; 405 with `Allow: POST`; a reset drops it |

Every JSON answer follows `JSON_ANSWER` (strong sha256 ETag, 304 on a match, `HEAD` without a body); 404 is
`{error: "not-found"}` for an unknown workspace, spec or task, 405 carries `Allow: allowFor(route)`. `GET …/:id`
sends `X-Spectant-Reviewed-Hashes` and `GET …/:id/tasks` sends `X-Spectant-Tasks-Hash` (absent without tasks.md):
deterministic fake sha256 hex values, the ones a write must send back. A tick changes the tasks hash; the reviewed
hashes normalise checkboxes away, so they stay.

The state is chosen per request by a header, so each test picks its own without restarting the server, and parallel
workers never race. An unknown value is always a loud 400, never a silent default:

| Header | Values | Absent |
|--------|--------|--------|
| `X-Spectant-Stub-State` | `two-workspaces` (harbor, lantern), `empty` (no workspace), `unreadable` (lantern `readable: false`, `error: 'missing'`, `counts: null`, its dashboard, planning and spec routes 409) | `two-workspaces` |
| `X-Spectant-Stub-Locks` | `none`, `activity`, `frontier`, `claims`, `person` (see the lock fixtures) | `activity`, the goldens as they are |
| `X-Spectant-Stub-Write` | `ok`, `stale`, `locked` (see the writes) | `ok` |
| `X-Spectant-Stub-Library` | `catalog`, `empty` (every readable workspace answers `EMPTY_CATALOG`, a workspace without one document) | `catalog` |
| `X-Spectant-Stub-Session` | any id; scopes the settings and the writes | one shared session |
| `X-Spectant-Stub-Worktrees` | `off`, `on` (the worktree overlay, below) | `off`, the goldens as they are |
| `X-Spectant-Stub-Edges` | `off`, `waiting`, `met` (the spec edges, below; with `Worktrees: on` a 400) | `off`, the goldens as they are |

Lock fixtures, applied to `…/live` (the `LiveFrame`), the spec page's `areas.live` and `keyNumbers.rounds.agentsWorking`
(under every fixture but `activity`), and `/api/lifeos`. Every in-flight card names its `agent` and `subagent` as
core's `live.ts` does (a person's or legacy lock: both null; a released card: both null):

| `X-Spectant-Stub-Locks` | Live frame | `/api/lifeos` | Gate button (ISC-85) |
|-------------------------|------------|---------------|----------------------|
| `none` | `lockSource: 'none'`, `locks: []`, `agents: []`, running cards back to `waiting` without lock fields | `{present: false}` | writes proceed, "no agent source" |
| `activity` | the golden: harbor 002 has one stale activity session on ISC-74 (T27 running, agent `a:claude:sess-2`) | `{present: false}` | ready / stale / done |
| `frontier` | every golden lock relabelled `frontier`, plus a synthetic agent `a:claude:stub-<NNN>-<claim>` on the first open claim no lock holds (harbor 002: ISC-75, T28 running, 20 min, not stale) | `{present: true}` | paused |
| `claims` | the tree's `.spectant/activity.jsonl` claim lines without their releases (as `core/tests/live.test.ts`); a held card runs, a landed one re-opened (harbor 002: T4 by the sub-agent `a:claude:sess-2/T4`, T25 and T27 by `a:claude:sess-2`, all stale) | `{present: false}` | as `activity` |
| `person` | the golden's locks held by the person `STUB_PERSON` (`u:3f9c0a7d`): harbor 002 T27 running, `agent` and `subagent` null | `{present: false}` | as `activity` |

Writes, per `X-Spectant-Stub-Write`:

| Outcome | `POST …/gate/reviewed` `{hashes}` | `POST …/tasks/:tid/check` `{checked, hash}` |
|---------|-----------------------------------|---------------------------------------------|
| `ok` | as the server: hashes equal to the header → 200 `{at: STUB_NOW, hashes, lockSource}` and the session's next `GET …/:id` shows `gates.reviewed` `fresh` at `2026-03-08T15:00:00Z`; else 409 | hash equal to the header → 200 `{task, checked, hash, lockSource}` with the new hash, and the session's next `GET …/tasks` shows the box (row `state`/`status`, `counts`); else 409 |
| `stale` | 409 `{error: 'hash-mismatch', expected: <the current hashes>}`, nothing written | 409 `{error: 'hash-mismatch', expected: {tasks: <current hash>}}` |
| `locked` | 423 `{error: 'locked', lock}`: the lock fixture's lock on the spec, else a frontier lock | 423 with the lock on the task's claim, else as for the gate |

`lockSource` in a 200 is the lock fixture's live `lockSource` (`none` renders "no agent source", ISC-86). Unticking a
box restores the golden row and the golden hash. An unknown or struck task, or a spec without tasks.md, is 404.

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

```ts
// The gate under a frontier lock, and a scripted 409 for the stale path (T79):
test.describe('gate: paused', () => {
  test.use({ extraHTTPHeaders: { 'X-Spectant-Stub-Locks': 'frontier' } });
  // …
});
test('gate: stale answer', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'X-Spectant-Stub-Write': 'stale', 'X-Spectant-Stub-Session': 'gate-stale' });
  // …
});
```

`extraHTTPHeaders` reaches every request of the page, the app's `fetch('/api/…')` included. Import `STATE_HEADER`,
`SESSION_HEADER`, `LOCKS_HEADER`, `WRITE_HEADER`, `STUB_STATES`, `LOCK_STATES`, `WRITE_OUTCOMES` and `STUB_NOW` from
`./stub-api` rather than spelling the names. The stub reads no clock and no registry: every answer is a function of
the fixture files and the request.

## The worktree overlay (spec 027)

`X-Spectant-Stub-Worktrees: on` lays harbor's worktree facts over its goldens (`stub-board.ts`, T33), in memory and
never over the golden files; under `off` every answer stays the golden, so the parity half and every other suite see
no change. Each fact has the shape core emits for it, typed by core's own types. Import `WORKTREES_HEADER`,
`WORKTREE_STATES` and `BUMP_RUN_PATH` from `./stub-api`.

| Harbor spec | Dashboard row and spec head | Elsewhere |
|-------------|-----------------------------|-----------|
| 002 | `.worktrees/002-web-console` on `feature/002-web-console`, `ahead: 2`, `dirty: true`; `source: 'worktree'`, `main: {stage: 'build', progress: 23/30}` | live: T26 `applied`, T27 `patched`, T28 `applied-open`, T29 `building`, T32 `dispatched`; `inRound` round 4, furthest along first |
| 003 | `.worktrees/003-config-loader` on `feature/005-config-format-choice`, `ahead: 1`, clean: the path wins | one `worktree-branch-mismatch` warning (core's sentence, `ref` the path) on the row and the spec page, last in `warningGroups`; `kpis.warnings`, `attention` and the list's counts one higher |
| 009 | `.worktrees/009-chunked-upload-limits`, `ahead: 0`, `dirty: false` | — |
| 007 | `worktree: null` | timeline: a `worktree` entry `merged` at `2026-03-09T08:45:00Z` (commit `4f1c2ab`), between two dated entries |
| 006 | `worktree: null` | timeline: a `worktree` entry `removed`, `undated`, `ts: ''`, after the entries of its newest instant |
| every other spec, lantern | `worktree: null`, `source: 'main'`, `main: null`: no chip | — |

`POST /api/__stub/bump-run?ws=harbor&spec=002&task=T32` with an `X-Spectant-Stub-Session` moves T32 from `dispatched` to
`building` on that session's next `…/live` read, with a new ETag, so a refresh test sees a run chip change within one
tick; T28 (`applied-open`) stays and its ETag holds. A bump applies under `off` too, where a task without a run starts
at `dispatched`. Reason: the e2e suites `worktree -g chip|tasks`, the timeline and offline need these facts
deterministically, and the fixture trees have no git to read them from.

## The spec edges (spec 025)

`X-Spectant-Stub-Edges: waiting | met` serves harbor rebuilt by core from its fixture tree (`STUB_EDGES`, T20): the
edges are added to the texts in memory, never to the fixture files, and the dashboard, planning, spec page, claims,
tasks and live frame come from core's own builders (`buildDashboard` with a `MergeState`, `buildPlanning` with each
row's `waits`, `buildSpecPage`, `buildClaimViews` and `buildLiveFrame` with the spec's resolved edges). A reviewed
mark that matched a file before the edit is re-marked over it, so a fresh review stays fresh. Under `off` (or no
header) every answer stays the golden. Lantern and every spec below without an edge answer as their goldens. Import
`EDGES_HEADER`, `EDGE_STATES`, `STUB_EDGES` and `stubMergeState` from `./stub-api`.

| Harbor spec | Edge | `waiting` (002 and 006 on unmerged branches) | `met` (both merged) |
|-------------|------|----------------------------------------------|---------------------|
| 009 | ISC-131 `(after: ISC-130, 002)` | full hold: `waits` `{blockers: [002], full: true}` on row, board holder and head; stage `blocked`, reason `waits on 002`; ISC-131 `blocked`, `waitsOn: ['002']` | `waits: null`; back on `build`, ISC-131 takeable, as the golden |
| 002 | T27, T28, T29, T32 `(after: …, 006)` | partial hold: `{blockers: [006], heldTasks: 3, readyTasks: 1, openTasks: 5, full: false}` (Tasks tab units: one edged task keeps its round's word), stage `build` kept; the web lane waits whole, the operator's T31 does not | `waits: null` |
| 002 | ticked T1 `(after: 042)` | one `spec-edge` warning on 002's row (no spec 042), no hold | the same warning |
| 002 / 004 | none | the `spec-overlap` of the golden stays: `web/src/app/retention/`, `waiting: '002'`, `edge: '(after: 004)'` | the same |

The live cards of 002's held tasks come from its `rounds.jsonl` and, at this commit, keep the round's reason instead of
`waits on 006`. That changes with core's `live.ts` fix, and the pin in `stub-api.test.ts` changes with it. Reason: the
e2e suites `blockers -g waits|overlap` need a waiting spec and its disappearance deterministically, and every other
suite must keep the goldens.

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

The container runs `linux/arm64`, native on Apple Silicon; the baselines are arm64 renderings, and CI does not compare
them. It uses every CPU Docker grants; `E2E_WORKERS=<n>` sets the worker count.
