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

## Layers and files

- `src/app` has four layers, lowest first: `core/` (services without UI; `core/api.service.ts` is the facade over the
  clients in `core/api/`, the pure board, planning and guidance derivations live in `core/model/`), `shared/` (the UI
  primitives in `shared/ui/` and small helpers), `layout/` (the frame: shell, spec head, tab bar, menus, palette,
  sidebars; the keyboard and refresh services sit in `layout/shell/`) and `features/` (the routed views). A layer
  imports only itself and the layers before it: `core` nothing above it, `shared` only `core`, `layout` `core` and
  `shared`, `features` all three. The files directly in `src/app` (`app.ts`, `app.config.ts`, `app.routes.ts`) and the
  developer gallery `dev/` belong to no layer. Imports name the file; no `index.ts` barrels. Reason: a lower layer that
  reaches up makes the frame depend on a view; the rule `layers` of `bun run check:architecture` reports every such
  import, type-only ones included, and `bun test tests/architecture.test.ts -t layers` holds the app to it.
- No folder under `features/` imports another, statically, type-only or through a dynamic `import()`. A part two
  features need moves down: pure derivations to `core/model/` (backlog order, planning page state, stage track), UI
  primitives and helpers to `shared/` (`shared/brief/`, `shared/page-nav/`, `shared/arrival.ts`, drag config and
  stage edge in `shared/ui/`), frame parts to `layout/` (the backlog writer and its menus). Routes that join several
  features (`spec-area.routes.ts`) sit directly in `src/app`. Reason: a feature that reaches into another couples two
  views that change for different reasons; the rule `isolation` of `bun run check:architecture` reports every such
  import, and `bun test tests/architecture.test.ts -t isolation` holds the app to it.
- Board, library, spec and planning are cut into a page, a signal store and part components. A store
  (`<name>.store.ts`, `@Injectable()`, provided by its page) holds the state as signals, the derivations as
  `computed` and the changes as methods, and touches no template, `ElementRef` or `DOCUMENT`; a page (a route, a
  tab, a planning lens or the library reader) provides and injects its store, keeps the DOM work (observers, focus,
  scrolling, `viewChild`) and is the only component there that injects a store or `ApiClient`; a part component
  gets its data through `input()`, `output()` and `model()` and may inject the router, selection, shell and live
  sources. Pure helpers of a feature live beside it (`board-view.ts`, `library-view.ts`, `spec/spec-view.ts`).
  `web/tests/feature-shape.test.ts` lists the stores and pages (`-t store`, `-t pages`). Reason: a part that loads
  its own data cannot be reused or tested without the network, and state spread over a page is hard to follow.
- Every component in `src/app` keeps its template and styles in files of their own beside the `.ts`, same base name:
  `templateUrl: './x.html'`, `styleUrl: './x.css'` (several `styleUrls` in cascade order when one stylesheet would pass
  400 lines), never `template:` or `styles:`. ESLint enforces it with
  `@angular-eslint/component-max-inline-declarations` (`template: 0`, `styles: 0`), guarded by
  `web/tests/inline-declarations.test.ts`; a test host component inside a `*.spec.ts` may stay inline. Reason: the
  size and duplicate guards see markup and CSS only as files, and a review reads one concern per file.
- The web entry of `bun run check:architecture` (`scripts/architecture/web.entry.ts`, listed in
  `scripts/architecture.config.ts`, part of `bun run check:static`) checks `web/src/app` without tests and generated
  files: at most 400 lines per `.ts`, `.html` and `.css` file, no copied block of 50 tokens or more (jscpd
  `typescript`, `markup`, `css`), the layers and the feature isolation above. Only `dev/**` (the developer gallery)
  is outside size and duplicates. A clone that has no shared rule without changing the DOM or a computed value is a
  named exception in the entry's `duplicates.allow`, its two files and a `why`; code is
  never reordered just to slip under jscpd. Reason: small files without copies keep every change reviewable, and an
  exception is visible with its reason instead of hidden.
- A rule two components share lives in a CSS partial (`shared/ui/overlay/_overlay-surface.css`,
  `shared/ui/_visually-hidden.css`, `layout/menu-rows.css`) that each component's stylesheet pulls in with a relative
  `@import`, so Angular scopes it per component like the rest of that stylesheet. A stylelint hit on rule order
  (`no-descending-specificity`, `no-duplicate-selectors`) is fixed by reordering or merging rules whose cascade cannot
  change, with a short CSS comment saying why, never by a `stylelint-disable` comment. Reason: one copy of the rule
  without a global selector, and the computed styles stay what the visual baselines hold.

## State

- Router-driven, never in-memory: `/` all workspaces, `/w/:ws` a dashboard, `/w/:ws/s/:id` a spec open. Filters, sort
  and flags are query params (`?phase=building&sort=next&takeable=1`). Reason: reload, back and the cmux web view land
  on the same screen.
- Settings (theme mode, language, single-key shortcuts) come from `/api/settings`. Reason: they must
  survive a port change, which per-origin browser storage does not (ISC-18.3).
- `localStorage` holds exactly three things, every access wrapped in try/catch: the "Recent" palette entries
  (`spectant.palette.recent`), the status widget window's last bounds (`spectant.statusWidget.bounds`,
  `layout/shell/widget-window.ts`, spec 071) and the status widget's filter selection (`spectant.statusWidget.filter`,
  `features/status-widget/widget-filter.ts`, spec 072). Reason: per-viewer conveniences that may be empty or throw in
  a private window or a web view.

## Design system

- daisyUI 5 on Tailwind 4 CSS-first, `themes: false`, `--depth: 0`, `--noise: 0`. Reason: no stock theme, bevel or
  grain may leak into the app's look.
- The app is the only reference of its look: `web/tests/fixtures/look-snapshot.json` holds its tokens, icons and
  primitives, guarded by `web/tests/look-snapshot.test.ts` (tokens, icons) and `web/e2e/browser/primitives.spec.ts`
  (primitives). Reason: a look change must be deliberate; it rewrites the snapshot (`bun run look:snapshot`, and
  `LOOK_SNAPSHOT=write` on the primitives spec) in the same commit, and the diff is reviewed (spec 063).
- The themes `spec-light` / `spec-dark` in `src/styles.css` are the only colour source, OKLCH with each slot's hex
  in a comment. Reason: ISC-18 round-trips them to the snapshot's hex values (`web/tests/theme-colors.test.ts`).
- Derived tokens (`--muted`, `--track`, `--*-ink`) live in `src/styles/tokens.css`. Reason: they are contrast fixes
  (ISC-65), not theme slots, and ISC-18 does not cover them.
- Text in an accent colour uses that accent's `--*-ink` (the badge's is its text on `--badge-fill`); the
  `--*-text` inks are for text on the card or page only, never on their own tint (4.2–4.47:1). Reason: ISC-65, guarded
  by `web/tests/tokens.test.ts`.
- Cards carry the 3 px top `edge` and corner `glow` only through `ui-card`'s variants; no other glow, text or
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
- Areas and tabs come only from `SPEC_AREAS` (`layout/shell/areas.ts`); a feature registers its view in `VIEW_LOADERS` (`src/app/spec-area.routes.ts`) keyed by tab id (or `dashboard`); an unregistered key renders `app-area-placeholder`.
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
  then shows the card moved (stage, `stageSource: explicit`, a new `hash`, `stageCounts`), and after a transition its
  `…/dashboard` (body and ETag) is core's rebuild over the moved spec.md and events.jsonl (`movedDashboard`, spec 067
  T29): the row's stage, group, source and item state, the counts and the guidance, as the server re-reads them; a
  variant overlay (dense, sidebar, waits, `runs`, edges, worktrees) keeps its own dashboard. An allocation removes the
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
`STUB_NOW`, which the goldens' durations count from, and pick the run of `STUB_RUN` (beacon 003; its log records the old command name, the app shows `STUB_RUN.shown`, `/spec tasks 003`)
with `X-Spectant-Stub-Run`:

- **none**: the run's `run-start` line is dropped; 003 reads `open` with the chip `/spec tasks 003`.
- **running** (absent): the log as it is, every body but the dashboard (see below) beacon's golden; 003 reads `running` since 14:52 by
  `a:claude:sess-32`, and the story `uptime-badges` runs `/spec new uptime-badges`.
- **ended**: the run's `run-end` with outcome `ok` is appended and 003 gets the `tasks.md` the run wrote (in memory);
  003 reads the stage its files then give, `review`, open with `/spec review 003`.
- **phases** (spec 070, ISC-571): `running` plus the two lines of `STUB_PHASES`: a `/spec done 009` run by
  `a:claude:sess-91` since 14:55 (009 leaves "Waits on you") and a red probe of 005's T5 after its `implement` run, so
  005's latest step reads as testing.

Under every one of these variants beacon's dashboard rows are built over the log's locks, as the server's
`loadDashboard` builds them (`stub-api.test.ts` pins the `running` body to it): each row carries its held claims in
`taken` and its open run in `run`, so "In progress" lists 006 (`review`), 005 (`implement`, which also holds ISC-15
and ISC-16) and 003 (`tasks`), plus 009 (`done`) under `phases` (`web/e2e/run-state-progress.spec.ts`). The pulsing
agent dot of those tiles is an endless animation: wait on finite animations only.

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

## Driving specs in work from an e2e spec

The block "In Arbeit" (spec 064) reads each dashboard row's `taken`, which the harbor golden leaves empty. Two ways to
fill it (`stub-api.ts`, `stub-api.test.ts`, `-t "specs in work"`):

- **Over the limit**: `X-Spectant-Stub-Locks: working` puts one `taken` entry on harbor 005, 006, 002 and 009
  (`STUB_WORKING`: ISC-94, ISC-1, ISC-74, ISC-131; session `a:claude:stub-<NNN>-<claim>`, since `STUB_NOW`), one more
  than the tile limit of three. Only harbor's dashboard body changes; every other value keeps it byte for byte.
- **Live**: `POST /api/__stub/lock?ws=harbor` with `{"spec": "003", "claim": "ISC-81", "session": "a:claude:stub-live",
  "release": false}` under the test's `X-Spectant-Stub-Session` stands in for a claim line, `"release": true` for its
  release (a fixture's entry too). 204; the session's dashboard body and ETag change, and before the 204 one `update`
  frame goes to its open `/api/events` streams, as `bump` does: leave the stream connected and wait for its 200 before
  the POST. 400 `invalid-lock`, 404 for an unknown workspace or spec; `POST /api/__stub/reset` drops the session's locks.

## Driving the detail sidebar from an e2e or browser spec

The sidebar's overview (spec 067) reads the dashboard row of a spec and the planning tree's `relations`, whose
`facts` (feature, milestone, claim, idea) the stub serves from core's planning golden as it is. Its fixtures
(`stub-api.ts`, `stub-api.test.ts`, `-t "sidebar fixtures"`):

- **Long title, childless milestone**: `X-Spectant-Stub-Sidebar: on` serves harbor rebuilt by core (`STUB_SIDEBAR`):
  003's title is exactly 200 characters in its dashboard row, Next-up entry and planning relation (and so in F3's
  link row), and the master gains `Harbor 3.0` (`milestone:harbor-3-0`), which nothing names: no children, target and
  description as facts. Every other value stays the golden's; a 400 beside the dense, waits, `runs`, worktree, edge or
  midnight overlays. Set it with `page.setExtraHTTPHeaders`.
- **Open run**: `X-Spectant-Stub-Locks: runs` (see "Driving a run's state"): beacon 003 and its story `uptime-badges`
  run; `POST …/beacon/runs/r-0308-1452/release` with the dashboard's `X-Spectant-Activity-Hash` answers 200 for the
  test's session, and the next read shows the run ended.
- **Open tasks**: harbor 002's T28 (ISC-75), T29 (ISC-76) and T32 (ISC-78) are open and no lock holds their claims;
  `POST …/specs/002/tasks/:task/check` with the `X-Spectant-Tasks-Hash` of `GET …/specs/002/tasks` answers 200 (T27
  on ISC-74 is held by `a:claude:sess-2`). Tick in the test's own `X-Spectant-Stub-Session` and reset it after.

Reason: every body stays core's output over a fixture tree, never hand-written JSON.

## Driving what waits on you from an e2e spec

The block "Waits on you" (spec 020, ISC-238) reads `guidance.waits` from each workspace's dashboard. Pick how many
entries the first workspace column of the start holds with `X-Spectant-Stub-Waits` (`STUB_WAITS` in `stub-api.ts`):

- **0**: lantern alone, its golden as it is (no waiting entry; Next up still has two).
- **1**: beacon, rebuilt by core without its folder `009-timezone-labels`, then lantern; only `/spec review 004` waits.
- **7**: harbor, then lantern, the goldens as they are. Harbor's seven waiting items are four entries, one per spec
  (spec 070, ISC-568: 006, 002 with two folded, 005 with one folded, 004), so the first tile on `/` shows three rows
  and "Show all 4", and harbor's `#waiting` three tiles and the fold "Show all 4" with one more.

Absent, the workspaces are the default list. The header is a 400 for any other value and beside `X-Spectant-Stub-Locks:
runs`, the worktree, edge or midnight overlays. Reason: every body is core's output over a real fixture tree, never
hand-written JSON (`stub-api.test.ts`, `-t "Waits"`).
