# web/ — the dashboard UI

Lane `web`: path `web/`. The root `CLAUDE.md` still applies; this file adds only what is specific to the lane.

**Lane probe: `bun run --cwd web test`**

## Purpose

The Angular 22 dashboard: zoneless, standalone, built to `web/dist` and embedded into the binary by `server/`. It
renders the dashboard model from `core/src/dashboard.ts` (T44) as it is and talks only to the loopback `/api`.
Reason: reshaping or re-parsing the model here makes a second parser (ISC-5); any other host breaks ISC-2.

## Framework

- `provideZonelessChangeDetection()` is explicit in the app config. Reason: the intent must not hang on a default.
- Standalone components only, `ChangeDetectionStrategy.OnPush` on every one. Reason: zoneless rendering is driven by
  signals and marked views, never by a global event sweep.
- `input()`, `output()`, `model()`, `viewChild()`, `signal`, `computed`, `linkedSignal`, `inject()`. Reason: one
  reactive model the compiler and the lint rules can check.
- Templates use `@if` / `@for` / `@switch`; decorator inputs and outputs, `*ngIf` / `*ngFor` / `ngSwitch` and `| async`
  are banned, and ESLint enforces it. Reason: one idiom per concern, no imports for control flow.
- RxJS only at the I/O boundary (HTTP, polling timer, `matchMedia`), bridged with `toSignal`. Reason: components read
  signals; a stream in a template brings back `| async` and manual subscriptions.

## State

- Router-driven, never in-memory: `/` all workspaces, `/w/:ws` a dashboard, `/w/:ws/s/:id` a spec open. Filters, sort
  and flags are query params (`?phase=building&sort=next&takeable=1`). Reason: reload, back and the cmux web view land
  on the same screen.
- Settings (theme mode, language, refresh interval, single-key shortcuts) come from `/api/settings`. Reason: they must
  survive a port change, which per-origin browser storage does not (ISC-18.3).
- "Recent" palette entries are the only `localStorage` use, every access wrapped in try/catch. Reason: a per-viewer
  convenience that may be empty or throw in a private window or a web view.

## Design system

- daisyUI 5 on Tailwind 4 CSS-first, `themes: false`, `--depth: 0`, `--noise: 0`. Reason: no stock theme, bevel or
  grain may leak into the inherited look.
- The themes `spec-light` / `spec-dark` in `src/styles.css` are the only colour source, OKLCH with the inherited hex
  in a comment. Reason: ISC-18 round-trips them to the old pages' values.
- Derived tokens (`--muted`, `--track`, `--*-ink`) live in `src/styles/tokens.css`. Reason: they are contrast fixes
  (ISC-65), not inherited values, and ISC-18 does not cover them.
- Text in an accent colour uses that accent's `--*-ink` (the badge's is its text on `--badge-fill`); the prototype's
  `--*-text` inks are for text on the card or page only, never on their own tint (4.2–4.47:1). Reason: ISC-65, guarded
  by `web/tests/tokens.test.ts`.
- Cards carry the prototype's 3 px `edge` and corner `glow` only through `ui-card`'s variants; no other glow, text or
  drop shadow. Reason: master decision 2026-09-29, guarded by `web/tests/no-glow.test.ts`.
- `color-no-hex` everywhere outside those two files. Reason: a stray hex is a colour neither theme knows.
- `data-theme` is set by the pre-paint script and the theme service, never by a `prefers-color-scheme` block.
  Reason: system mode follows `matchMedia` live and a chosen mode wins over it (ISC-18.1).
- Motion tokens only in `src/styles/motion.css`, no literal duration elsewhere; every duration is `0ms` under
  `prefers-reduced-motion: reduce`. Reason: one switch honours reduced motion everywhere (ISC-66).
- Container tiers on the shell container (`container: shell / inline-size`): compact < 640, medium 640–1119, wide
  ≥ 1120, never a viewport media query; spacing on the 8 px scale (4 / 8 / 16 / 24 / 32 / 48). Reason: the app runs
  in a 600 px cmux panel as often as full-window (ISC-63).
- Manrope (text), Sora (wordmark and page title) and JetBrains Mono as local woff2 only (ISC-74); `tabular-nums` on every number; mono for IDs, commands and
  ports. Reason: no font request leaves the machine (ISC-67, 67.1); live numbers never shift layout (ISC-62.1).
- Icons only from the pinned `lucide-static` version, only used icons inlined, rendered through `ui-icon`. Reason:
  ISC-18.2 checks every name against that version, and unused icons are dead weight.
- Shared primitives live in `src/app/shared/ui/`, and each exists because it has two consumers. Reason: a primitive
  with one consumer is an abstraction without a job; it stays in its feature until the second arrives.
- Spec 002 adds `ui-glyph` (eleven card states and six claim states, each its own shape and tone pair, `aria-hidden`),
  `ui-state-chip` (glyph plus the visible state word from `states.*`), `ui-scrubber` (a real `<input type="range">` with
  `aria-valuetext` and typed ticks), `ui-toast` (the app's single toast, mounted once in the app root) and a `count` on
  `ui-disclosure`. A state word is never a tooltip. Reason: touch has no hover (ISC-88, DS-APP-25).
- Spec 040 adds the glyph family `item`: the five item states (open, waiting, running, aborted, done), each its own
  pair, `aborted` the one warning glyph. A card or claim word that means one of them (`ITEM_ALIASES`) shares its entry
  and reads its word in both catalogues; "waiting" / „wartet" names only that state. Reason: one state vocabulary on
  every surface (ISC-224), guarded by `web/tests/states-complete.test.ts` and the glossary parity test.

## Shell

- Every route but `/__ui` renders in `app-shell` (`layout/shell/`); `ShellState` holds tier, zen, rail and the route (`ws`, `specId`, `area`, `tab`), `ShellData` the workspace list, dashboard and spec as `resource()`s over `ApiClient`.
- Tiers are measured on the shell container (`container: shell / inline-size`) by `ShellState` through a ResizeObserver and exposed as `data-tier="compact|medium|wide"`: compact < 640 stacks everything and turns popovers into bottom sheets, medium keeps one column with the tab bar under the spec head, wide adds the 352 px rail. Reason: the same app runs in a 600 px cmux panel and full-window (ISC-63), and a viewport query would lie inside a panel.
- The tab bar is one `app-tab-bar` rendered by `app-tab-bar-slot`: `placement="header"` (row 2, horizontally scrolling with a trailing fade) at compact, `placement="main"` under the spec head, sticky at `top: 64px`, at medium and wide. It shows only the current area's tabs with the counts the spec model carries (claims closed/total, tasks landed/total). Reason: exactly one bar exists per tier, and a count the model does not hold is not invented here (ISC-72).
- The area menu is `app-area-menu` (`layout/area-menu/`), a native popover at medium and wide and a bottom sheet at compact, listing the six areas with `aria-current="page"` on the current one and no `role="menu"`; areas whose views are not built render as disabled entries with the reason as visible text. Reason: ISC-76, and a menu role would take over arrow-key handling the browser already provides.
- Areas and tabs come only from `SPEC_AREAS` (`layout/shell/areas.ts`); a feature registers its view in `VIEW_LOADERS` (`features/spec/spec-area.routes.ts`) keyed by tab id (or `dashboard`); an unregistered key renders `app-area-placeholder`.
- `ShellData` feeds `LockSourceService.connect()` with the spec payload's `areas.live`; `source` stays `none` until the spec route answers `ok`.
- Header controls carry `data-control="brand|workspace|spec|area|palette|live|zen|settings"`; T36 to T38 replace them in place, never add a second `<header>`.
- An unknown path, workspace, spec or tab renders `app-not-found` (ISC-71); a catch-all 404 (`served: false`) renders the placeholder instead.

## i18n

- Transloco, English default, German formal (Sie); every key in both `src/i18n/en.json` and `src/i18n/de.json`.
  Reason: ISC-22 fails on a missing key or an informal form.
- No literal user-facing string in a template, `aria-label` and `title` included. Reason: a literal skips both
  catalogues and the parity check. Lay out for German, the long case.

## Accessibility and motion

- One global `:focus-visible` ring: 2 px `--disp` outline, 2 px offset, 4 px `--bg` halo. Reason: ISC-64, both themes.
- Native `popover` and `<dialog>` (`showPopover()`, `showModal()`), Esc and backdrop click handled in the primitives.
  Reason: top layer and inertness come free; `closedby` and `commandfor` are missing in WebKit 17.
- Focus returns to the trigger on close; section jumps (`g` sequences) move focus to the section heading. Reason: a
  keyboard user never loses their place.
- Under `pointer: coarse` the `ui-button` / `ui-icon-button` primitive adds a 44 × 44 hit area. Reason: WCAG 2.5.8
  is solved once, not per feature.
- WebKit (the cmux web view, floor WebKit 17) is a first-class target: feature-detect anchor positioning, view
  transitions and `@starting-style`; ship `-webkit-backdrop-filter` and `-webkit-line-clamp`. Reason: ISC-19 and
  ISC-19.1 run there, and Chromium-only CSS fails silently.

## Testing

- `bun run --cwd web test`: component specs on Vitest through Angular's `unit-test` builder, the lane probe. Reason:
  `bun test` cannot compile TestBed specs.
- Anything touching layout, cascade, focus or gestures is a `*.browser.spec.ts` on real Chromium
  (`bun run test:browser`). Reason: a DOM emulation has no layout and no cascade (ISC-64 to ISC-66).
- Playwright suites under `web/e2e/` (`bun run e2e`, `bun run test:visual`) run inside the pinned Playwright Linux
  container, against the stub API fed from `core/fixtures/*.golden.json`, with a fixed clock and animations off.
  Reason: committed baselines must match CI byte for byte.
- Pure TypeScript guards (tokens, icons, i18n parity, fonts) live in `web/tests/*.test.ts` and run under root
  `bun test`, where `bunfig.toml` excludes `web/src`. Reason: they need no Angular, and Bun must skip Vitest specs.

## Driving the board writes from an e2e spec

The stub answers the Stage-3 board (spec 008, T119) from the planning golden and an in-memory state per
`X-Spectant-Stub-Session`; `POST /api/__stub/reset` restores the golden for that session. A spec picks the answer by
what it sends, never by a hidden switch:

- **200**: send the hash the page read (the planning holder's `hash`, or `X-Spectant-Spec-Hash` on `GET …/specs/:id`;
  for a story `IdeaPage.hash`) and a move the spec's workflow row lists, on a spec no lock holds. The session's tree
  then shows the card moved (stage, `stageSource: explicit`, a new `hash`, `stageCounts`); an allocation removes the
  story and adds the new spec at `plan` (`010-console-audit-log` on harbor). Reason: the next poll must render the move.
- **409**: send any other hash (`'0'.repeat(64)`), or the old hash after a move; or `X-Spectant-Stub-Write: stale`.
- **423**: transition a spec the lock fixture holds: harbor 002 under the default `activity` locks (`a:claude:sess-2`
  on ISC-74), every spec with an open claim under `X-Spectant-Stub-Locks: frontier`, none under `none`; or send
  `X-Spectant-Stub-Write: locked` (the only way for an allocation, which the real server never locks). Lock sessions
  follow the actor grammar; made-up ones read `a:claude:stub-<id>-<claim>`.
- **422**: a move the row does not list (`006` `review → done`, or the stage it already stands in), answered with the
  stage-table phrase and the spec's next command; allocating `registry-webhooks`, which the story index does not name,
  is `not-in-index`. Reason: these are the refusals the real write gives for the same fixture.

## Driving the backlog writes from an e2e spec

The stub answers `POST …/:ws/backlog` (spec 036) with core's `planBacklogMove` / `planBacklogPriority` over the fixture
tree's master and `specs/backlog.md` (none on harbor), per `X-Spectant-Stub-Session`; `POST /api/__stub/reset` drops the
session's writes. After a write the session's next `GET …/planning` carries the new ranks, priorities and
`backlogHash` (`withBacklogText` in `stub-board.ts`, spec 037 T26), as the real route does. On harbor no feature has a
`Milestone:` line, so every feature moves within the one no-milestone group of the route, while the tree shows them
under the milestones their specs name; a milestone boundary is the browser tier's to probe, not the e2e's.

- **200**: send the `backlogHash` the page read (the empty text's sha256 on harbor before any write) and a move or a
  priority that changes something. Watch the call with `page.waitForRequest`; the stub keeps no call log.
- **409**: any other hash (`'0'.repeat(64)`), the old hash after a write, or `X-Spectant-Stub-Write: stale`.
- **422**: a no-op (a move to where the feature stands, its current priority) or an unknown feature, answered with
  core's reason phrase. The stub never answers 423 here, like the real route.

## Changing a workflow from an e2e spec

`PUT /api/__stub/workflow?ws=<slug>` with a `specs/workflow.md` text as the body stands in for an edit of that file
(T151): core's `parseWorkflow` reads it, and that `X-Spectant-Stub-Session`'s planning tree carries the result as
`workflow` (and `boardStages` of it as `stages`) until `POST /api/__stub/reset`. 204; 404 for an unknown slug; 405 with
`Allow: PUT`. Set the session on the context (`setExtraHTTPHeaders`), send the edited fixture file, reload, assert;
reset after. Reason: the next read must show the changed table without touching the fixture tree, and the parse
stays core's.

## Driving who works a task from an e2e spec

The agent and sub-agent chips (T135, ISC-131.1; `web/e2e/live.spec.ts`, `-g subagents`) read core's `LiveCard.agent` and
`.subagent`; the stub fills them in every lock fixture as core's `live.ts` `workersOf` does. Pin the clock to
`STUB_NOW` (`test.use({ clockAt: STUB_NOW })`) so a lock is stale exactly past `LIVE_STALE_MS`, and pick the holder with
`X-Spectant-Stub-Locks`:

- **agent, stale**: `activity` (default), harbor 002 T27 by `a:claude:sess-2`, 54 minutes without a release.
- **agent, fresh**: `frontier`, harbor 002 T28 by `syntheticSession('002', 'ISC-75')`, 20 minutes.
- **sub-agent**: `claims`, the fixture tree's activity claim lines without their releases, landed cards re-opened as
  `core/tests/live.test.ts` does; harbor 002 T4 by `a:claude:sess-2/T4` under `a:claude:sess-2`, stale. Reason: the
  golden log releases T4's claim, so no golden frame holds a sub-agent.
- **person**: `person`, the golden's locks held by `STUB_PERSON` (`u:3f9c0a7d`); T27 runs and no agent chip shows.

## Driving a run's state from an e2e spec

The item states (spec 040, ISC-224, ISC-224.1) come from core's `itemStates` over the activity log's `run-start` and
`run-end` lines. `X-Spectant-Stub-Locks: runs` adds the fixture tree `beacon` to the workspace list, rebuilt by core
from its files and its log (`runVariant` in `stub-api.ts`); every other workspace stays its golden. Pin the clock to
`STUB_NOW`, which the goldens' durations count from, and pick the run of `STUB_RUN` (beacon 003, `/spec-tasks 003`)
with `X-Spectant-Stub-Run`:

- **none**: the run's `run-start` line is dropped; 003 reads `open` with the chip `/spec-tasks 003`.
- **running** (absent): the log as it is, every body beacon's golden; 003 reads `running` since 14:52 by
  `a:claude:sess-32`, and the story `uptime-badges` runs `/spec new uptime-badges`.
- **ended**: the run's `run-end` with outcome `ok` is appended and 003 gets the `tasks.md` the run wrote (in memory);
  003 reads the stage its files then give, `review`, open with `/spec-review 003`.

Switch the header between two polls to step a card through a run within one refresh tick. The header is a 400 under
any other lock fixture, and `runs` is a 400 beside the worktree, edge or midnight overlays. Reason: the state is core's
decision over the same log the server reads, never hand-written JSON (`stub-api.test.ts`, `-t "run variants"`).

## Driving a step from an e2e spec

An agent's steps (spec 015) come from step lines in `.spectant/activity.jsonl`; the stub serves harbor's from core's
steps golden (`core/fixtures/harbor.steps.golden.json`) on the live and tasks answers. To make a step arrive while a
page is open (ISC-233, `web/e2e/agent-steps.spec.ts`, `-g live`), `POST /api/__stub/step?ws=<slug>&spec=<id>&task=<tid>&kind=<kind>`
with `&result=red|green` on a `probe` and `&text=` on a `question`, under the test's `X-Spectant-Stub-Session`:

- The step lands after the task's own, a minute after its latest step (or `STUB_NOW`), by that step's actor; body and
  ETag of both answers change as a log line would change them. 400 for a malformed step, 404 for an unknown task.
- Before its 204 it pushes one `update` frame to that session's open `/api/events` streams, as `bump` does. Leave the
  stream connected (never route `/api/events` away), wait for its 200 response before the POST, and prove "no reload"
  with a marker on `window` and no `document` request. `POST /api/__stub/reset` drops the steps and closes the streams.
- Views re-read the live frame on `RefreshService.refreshes()`, the count, never on `lastRefresh`: under the pinned
  clock every refresh stamps the same instant, so a view keyed on the clock would never re-read. Reason: a step must
  reach the page through the stream within 2 s, and only the count moves on every refresh.

## Driving what waits on you from an e2e spec

The block "Waits on you" (spec 020, ISC-238) reads `guidance.waits` from each workspace's dashboard. Pick how many
entries the first workspace column of the start holds with `X-Spectant-Stub-Waits` (`STUB_WAITS` in `stub-api.ts`):

- **0**: lantern alone, its golden as it is (no waiting entry; Next up still has two).
- **1**: beacon, rebuilt by core without its folder `009-timezone-labels`, then lantern; only `/spec-review 004` waits.
- **7**: harbor, then lantern, the goldens as they are; the first column shows the top entry, four more and "+2 more".

Absent, the workspaces are the default list. The header is a 400 for any other value and beside `X-Spectant-Stub-Locks:
runs`, the worktree, edge or midnight overlays. Reason: every body is core's output over a real fixture tree, never
hand-written JSON (`stub-api.test.ts`, `-t "Waits"`).
