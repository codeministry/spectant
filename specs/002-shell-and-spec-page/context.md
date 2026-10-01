---
spec: 002-shell-and-spec-page
created: 2026-09-28T22:08:00Z
updated: 2026-09-29T10:00:00Z
rounds: 3
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 002 — Shell and spec page

## Goal — confirmed 2026-09-28T22:07:00Z
A developer works a spec end to end in Spectant, from dashboard to live board and notes, inside the prototype's shell.

Principal's words, verbatim: see `principal_stated_goal` in the master `ISA.md` (untracked; German and naming a local path, kept out of the public tree by the constitution).

## Round 0 — shaping the idea, 2026-09-28T21:40:00Z
- Shapes offered: reference only into 001 (narrow) | shell + spec page as spec 002 (obvious, recommended) | project spec re-cutting the master to the whole prototype (different). Chosen: shell + spec page as spec 002.
- Ground read first: the Lovable export (static dummy with 20 pages, seven German docs 00–06, a React/Vite wrapper) had landed untracked under `specs/tmp/` inside the public `specs/` tree; it was moved to `specs/001-app-skeleton/.design/prototype/` (gitignored) during shaping. Overlaps named: spec 001's open web tasks T57–T83, the unspecced master blocks F2, F3, F5, and the Remaining Work items "AI chat" and "design pass as app feature". Prototype features the master did not know: library per workspace, workspace identity images, area menu, zen mode, the assistant "dot".

### Q1 · Who owns the shell?
- Offered: 002 owns it and 001 is re-cut (recommended) | 001 finishes the old shell and 002 swaps it | 001 adopts the new shell itself
- Chosen: 002 owns the shell; 001's T59/T60 move to 002 and 001 is re-cut
- Landed in: ISC-73, ISC-77, ISC-98

### Q2 · What feeds the timeline before events.jsonl exists?
- Offered: existing files with derived stages (recommended) | timeline only with F3 | rounds and gates only
- Chosen: existing files (context.md rounds, rounds.jsonl, gate marks, git log), stage transitions derived and marked, events.jsonl preferred once present
- Landed in: ISC-80, ISC-36

### Q3 · How are the two writes protected before activity.jsonl exists?
- Offered: frontier locks + hash CAS, activity.jsonl later (recommended) | block writes until activity.jsonl | reviewed gate only
- Chosen: hash CAS always; LifeOS frontier locks as the agent source when present; `.spectant/activity.jsonl` wired as a second source once the plugin writes it; visible "no agent source" note when neither exists
- Landed in: ISC-86, ISC-90, ISC-85

### Q4 · Where do the golden fixtures come from?
- Offered: own spec 001 + public leadgen specs (recommended) | own + synthetic only | private corpus local, fixtures synthetic
- Chosen: own spec 001 frozen + frozen public leadgen specs (Apache-2.0) + synthetic harbor/lantern/empty-master. Added by the principal mid-shaping: a customer's specs as a further corpus; being a customer's, they stay a private local corpus behind an environment variable and never enter the repository
- Landed in: ISC-69, ISC-70

## Round 1 — before the spec, 2026-09-28T22:07:00Z

### Q1 · Which goal does spec 002 have?
- Offered: shell + spec page from real files with the two writes (recommended) | narrower: read only | wider: every prototype area end to end, from dashboard to live board and notes
- Chosen: the wider sentence. Live board and notes return into 002; workspaces admin, help, library, identity images and "dot" stay out
- Landed in: § Goal; F7 block ISC-87 to ISC-95; carried ISC-49, ISC-49.1, ISC-52, ISC-53

No further gap question was spent: Round 0 had settled shell ownership, timeline sources, write guards and fixtures, and the remaining unknowns are `⟨?: …⟩` marks in spec.md or fog lines below. Budget left for the draft marks: 3.

## Round 2 — before the plan, 2026-09-29T00:30:00Z

### Q1 · How do we build 002?
- Offered: contract first, then shell, then areas, then writes, then Live and Notes, then cross-cutting probes (recommended) | UI first against the stub API, parser last | vertical slices per area
- Chosen: contract first, then shell, then areas; every view renders golden JSON, never a prototype number
- Landed in: plan.md § Approach

### Q2 · How do 001 and 002 run against each other?
- Offered: 001 pauses at 14/47, 002 writes FORMAT.md and the shell, 001's T32/T59/T60 are struck and 001 resumes inside the new shell (recommended) | 001 continues round 10 without T32 in parallel | 001 finishes with the old shell first
- Chosen: 001 pauses; 002 owns FORMAT.md and the shell; T32 joins T59/T60 in the re-cut; 001 renews its review mark afterwards
- Landed in: plan.md § Approach (Spec 001 re-cut), ISC-98; Decisions in the master

## Round 3 — review before implement, 2026-09-29T10:00:00Z

### Q1 · Release now or apply the design and plan follow-ups first?
- Offered: apply the wording follow-ups and close the fog first, then mark (recommended) | release as is | not yet
- Chosen: follow-ups first — ISC-73 id at compact, ISC-97 `z`, Vision five tiles, three fog lines closed with the plan's decisions
- Landed in: spec.md ISC-73, ISC-97, § Vision, § Decisions; master ISA.md

## Round 4 — build, 2026-09-29

Run started 2026-09-29T06:45:00Z with the review mark of 06:38 UTC. Second look: off (default). Width 4 (feature
default). Prerequisite note: spec 001's core skeleton (T33) and dashboard model (T39) had not landed when round 1
started; round 1 dispatches only the seam T1 (`core/src/files.ts`, types and stubs), which does not depend on them.
Rounds that would touch 001's modules (T9 golden test, T11 `stage.ts`) are held by the parent until 001 lands them,
whatever `SpecRun.ts plan` proposes.

Round 1 (T1, Engineer): landed as a patch; typecheck, `bun test core/` (19 pass) and `check:single-core` green on the
main tree. Marks worth keeping: the seam defines **13** file kinds (spec, plan, tasks, context, design, constitution,
rounds, events, gateReviewed, gateCodeReviewed, artifacts, evidence, master) while ISC-68.1's Test Strategy threshold
says "11 kinds" — the threshold is corrected to 13 at the next `/spec-review 002` checkpoint together with the master,
because a Test Strategy edit mid-run invalidates the review mark (same rule as 001, round 1). Stubs live one per module
file (`spec.ts`, `timeline.ts`, …) so `files.ts` stays free of runtime imports for the web bundle; `resolve.ts` is
T13's to create; model inputs are a `SpecFiles {folder, texts}` record read by the caller, so nothing depends on 001's
parser until it lands. `bun run check:leak` fails because `scripts/check-leak.ts` does not exist yet (001's T54).

Round 2 (T4, T5, T6, T7, four Engineers in parallel): ISC-69 closed on `core/tests/fixtures.test.ts -t corpus` (4 pass).
Marks kept: every core probe row in spec.md writes `bun test core/<name>.test.ts` while the files live under
`core/tests/` (bun's filter is a path substring, so the rows as written match nothing) — all core rows are corrected to
`core/tests/…` at the next `/spec-review 002`, together with ISC-68.1's "11 kinds" → 13 and T6's path column. leadgen's
frozen specs are 012 (feature), archive/013 (refactor) and 022 (feature) at source commit 20c39e4; a `bug` exists
there (archive/011) but spans six feature blocks and was left out. `022/.gates/code-reviewed.json` had an absolute
`root`, replaced by `<leadgen-root>`. Tilde paths in copied text are kept (not absolute).

### Q1 · Copy leadgen's NOTICE copyright line (the principal's own name) into the fixture's licence file?
- From: T5 (ISC-69), lane `core`
- Offered: URL reference only (recommended by the parent) | copy the NOTICE line
- Chosen: copy the NOTICE line — Apache-2.0 § 4(d) attribution in full
- Landed in: `core/fixtures/leadgen/LICENSE-leadgen.txt`; constitution § Adaptations (XC-10 exception for licence attributions); the corpus test exempts `LICENSE-*.txt` from the person check; master Decisions 2026-09-29

Round 3 (planned at width 6: T8, T10, T12, T13, T14, T15; dispatched T8, T13, T14; **held by the parent** T10 and T12
because they need spec 001's parser (T33) and T15 because it needs the stage table (001's T37 / 002's T11)).
T13 landed `core/src/resolve.ts` (30 tests: unknown id, unknown slug, ambiguous, no specs dir; never a fallback); T14
landed `buildTimeline` (9 tests; entries ordered by parsed instant, not lexically, because `git log` prints committer
offsets; ids `decision-R1.Q2`, `round-3`, `gate-reviewed`, `commit-<sha>`; stage entries left to T15). **Claim-close
rule applied:** a claim whose probe is green but whose other tasks are unbuilt stays open, because the write order
ticks every task of the claim — ISC-71 waits for T45/T48, ISC-80 for T26/T46/T55. T14's context.md grammar (Goal /
Round header / Q block) is owed to FORMAT.md by T2.
T8 landed the harbor 002 fixture with all eleven card states (seven from `rounds.jsonl`, running from
`core/fixtures/harbor/.spectant/activity.jsonl`, absent from a re-cut between R2 and R3, operator open/done from
`tasks.md`), generated by `core/fixtures/harbor/generate.ts` (idempotent, sha-checked). The re-cut deliberately
reuses an id (old T30 held the question, new T30 is an operator step): the ISC-91 trap T18/T27 must test against.
Fixture README row for 002 updated; `core/fixtures/.gitignore` re-includes `!.spectant/` and
`!**/.spectant/activity.jsonl` (the brief's `!.spectant/activity.jsonl` was a no-op, replaced by the parent). A
strict-mode typecheck slip in `harbor-states.test.ts` (`match[1]` possibly undefined) was fixed by the parent. Round 3
recorded with T10, T12, T15 as `skipped` (held for 001). Round 4 plan proposes only T9 (golden test), which needs
001's parser and golden-test harness (T33, T40): **the run stops here** until 001's core rounds land — a decision only
the principal can make (spec 001's ordering).

Round 4 landed (2026-09-29, after 001 rounds 13–18): T9 `core/tests/golden.test.ts` — **ISC-68 closed** (2/48). Two new golden
families for all five trees (`<tree>.specs.golden.json`: listSpecs/resolve listing; `<tree>.timeline.golden.json`:
`buildTimeline` per spec folder, commits pinned to `[]` because the fixtures are not git repos), byte-equal via the shared
`core/tests/helpers/golden.ts` that 001's `fixtures.test.ts` now uses too; inventory checks both ways, no path-shaped strings,
non-vacuity by in-memory mutation. Marks: `specFilePath` lands one level too shallow for the constitution/master kinds of an
archived folder (FORMAT.md or `files.ts` follow-up); next families join in the same task as their parser (T12 spec page,
T13 tasks/claim views, T15 derived stages); the probe row still says `core/golden.test.ts` (review fix). Round 5 plan: T2
`FORMAT.md` alone.

## Still open
- none. The three fog lines of Round 1 closed in Round 3 (spec.md § Decisions 2026-09-29).

Round 5 landed (2026-09-29): T2 `FORMAT.md` (595 lines; 13 kind sections in `files.ts` order, 22 examples quoted verbatim
from the fixtures and checked byte for byte by `scripts/check-format-doc.ts`, which T2 also delivered together with its
9 tests and the `check:static` wiring — so **T3 is ticked as done by the same patch**). ISC-68.1 stays open: three kinds
(`events`, `artifacts`, `evidence`) have no fixture anywhere, so "one real example each" holds for 10 of 13; closing it
needs harbor's `generate.ts` to add those three (a `core/fixtures` task the review should mint or fold into T111–T113).
Marks for the review: the ISC-68.1 threshold "11 kinds" is 13; `STAGE_RULES` runs done → plan → tasks → review → build →
code-review → close → blocked (blocked is the fallback row; ISC-79/T29 compares that order); a `---` inside `## Features`
hides every claim after it; `[DROPPED` anywhere in a claim drops it; claim IDs beyond `ISC-N` are accepted; `## Ziel`
aliases `## Goal`; the reviewed hash strips only the first `## Decisions` / `## Not yet specified` / `## Verification`;
`specFilePath` resolves constitution/master one level too shallow under `specs/archive/` (T9 saw it too); events
vocabulary must be decided before T16 (ISC-24 says `tasked → reviewed`, the stage table says `tasks`/`review`; ISC-24
writes `.gates/reviewed` without `.json`); evidence-to-claim naming (T24) and frontier lock shape/location (T20) are not
written anywhere; `rounds.jsonl` `v` is never checked. Whole tree 809 pass / 9 skip, static green.

Round 6 landed (2026-09-29, commits 1b0a0ff + next): T10 (**ISC-70 closed**, 3/48; private corpus behind
`SPECTANT_PRIVATE_CORPUS`, 10 pass on the local customer corpus, skipped when unset, fail on an empty dir; output
shows spec numbers and basenames only), T12 (`spec.ts` spec page model: head, keyNumbers, ideaQuote/ideaSource, next
with reasons, lanes in constitution order, four gates, warnings, waitingOnYou, six area tiles, tldr; row-equality
with `buildDashboard` for all ten active fixture specs = the ISC-72 guard; golden family `spec`), T15 (`derived-stages.ts`:
derived stage transitions in `stage.ts` names, dated from `created:`/`started:`/context rounds/gate marks, undated ones
flagged; events replace them when given; timeline goldens +543 lines of stage entries, spec goldens' timeline counts
followed), T17 (`frames.ts`: dispatch/result frames per round, severity fail > question > concerns > waiting >
operatorOpen > dispatched > running > done > operatorDone > closed > absent, carry-forward guarded by same text,
`recut` hook for T18; golden family `frames`, spectant-001's is 626 kB because every card sits in every frame), T20
(`locks.ts`: frontier locks read from the one hashed `isa-locks/<sha1(realpath ISA.md)[0..16]>/` dir, stale > 2 h and
foreign ones as diagnostics; activity.jsonl replay; `none` proven to touch nothing outside the repo; frontier wins on a
shared claim because `partitionClaims` is last-wins). T16 skipped: the events vocabulary (stage.ts names vs ISC-24's
`tasked → reviewed`) is the principal's call. Parent merges: T15's types/inventory/FORMAT paragraph by hand over
T12, T17's golden.test.ts import and FAMILIES line by hand over T12; spec-test timeline pins 5→9 and 3→9. Core lane
592 pass, whole tree green, static green. Marks for the review: probe paths `core/tests/…` (ISC-36, 37, 68, 70, 87);
five vs six area tiles (design.md says five, model has six incl. Board); `specFilePath` depth under `specs/archive/`;
FORMAT.md gaps T17 listed (task state `skipped`, operator open/done rule, note prefixes, `claims.*` arrays, `mode`/`width`
not read by frames); state-dir discovery for locks (`SPECTANT_LIFEOS_STATE_DIR` proposed); T47's loader must pass
`locks` (also into T21's live frame and the ISC-86 write guard). Round 7 plan: T22 claim view, T23 task grammar, T24
evidence, T25 markdown docs, T32 fonts; T16 still held.

Round 7 landed (2026-09-29, commits 9d0a125 + next): T22 (`claim-view.ts`: states from `partitionClaims`, kinds,
edges/blockedBy, probe row, verification line, lock on taken, features with `Why:`, fog list, counts; row-equality with
the dashboard for every fixture spec; golden family `claim-view`), T23 (`tasks.ts`: the full task grammar — box, id,
claim, `[P]`/`[seam]`, lane validated against the constitution's `## Lanes`, text up to the last ` · ` outside code
spans, paths and `(…)` path notes, `(after: …)` with ranges, struck bullets, Probe Mapping with four warning kinds,
status from the newest frames card; `spec.ts` now uses it instead of its interim reader; parity with the old SpecRun
reader except one code-span path the old reader split; golden family `tasks`), T24 (`evidence.ts`: listing of
`artifacts/` and `.evidence/` with media types, claim grouping by id-in-path then verification line, symlinks flagged,
`resolveEvidencePath` with six confinement rules — the core half of ISC-83's probe; harbor 002 gained generated
artifacts and evidence files plus five verification notes, so FORMAT.md now quotes real examples for 12 of 13 kinds),
T25 (`markdown.ts` grew a document mode — mermaid and image figures, hard breaks, open marks, checkboxes, two Brief
bugs fixed; `markdown-docs.ts` = frontmatter, TOC, sections, `docsFor(type)`; browser-safe, guarded by a static-import
test; golden family `docs`), T32+T33 (Manrope, Sora, JetBrains Mono as local latin woff2 from the Google Fonts CSS
endpoint, OFL texts from the pinned upstream commits, Inter removed, fonts guard rewritten; Sora on h1 only per
design.md § tokens). Parent work: the offline container check expected the pre-T50 start-up line (CI's first run was
green on `verify`, red on `offline` for that reason) — fixed plus a permission reset inside the container; `check-leak`
gained the derived-golden rule (a hit in `core/fixtures/<tree>.*.golden.json` is allowed when the same text sits on an
allow-marked line of that tree); three hand merges in `golden.test.ts`; claim-view pin and golden followed T24's
verification notes. Whole tree 1044 pass, static green. Marks for the review: glyph state `open` never emitted (the
row counts takeable regardless of stage — decide whether the stage table gates takeable before the reviewed mark);
design.md contradicts itself on Sora for section titles; `spec.ts` still has its own `constitutionLanes()` (use
`lanesOf`); the claim-ID regex is copied into `tasks.ts` (export it from `claims.ts`); fog grammar and first-wins rules
for FORMAT.md § spec; evidence route contract (403 outside/symlink-escape, 404 not-found, nosniff, html as attachment);
frozen spectant-001 has 83 tasks (the live 001 has 81 + 2 struck) and the live-file test needs updating on a re-cut.
Round 8 plan: T16 (held, vocabulary) and T34 tokens; parent adds T21 live frame (non-[P], different lane, no file
overlap with T34).

Round 8 landed (2026-09-29, commits 7a04ed1 + next): T34 (tokens: three prototype tokens the app lacked — `--hover-t`,
`--scrim`, `--page-glass`; `--held-ink` derived; every accent asserted to have an `-ink`; the two narrow dark values
pinned at their measured ratios; `no-glow.test.ts` with `ui-card`'s inherited corner glow pinned as the one known
exception — **ISC-74 closed**, 5/48), T44 (`server/src/spec-routes.contract.ts`: builders, matcher, `SPEC_ROUTE_TABLE`,
response and error types over the core types, golden family per route, `X-Spectant-Reviewed-Hashes` /
`X-Spectant-Tasks-Hash` headers as the client's hash source, evidence file headers incl. CSP sandbox; error spelling
fixed to kebab-case `not-found` — plan.md's `not_found` and T45's line are the outliers, plus `http.ts`'s `not found`
fallback), T51 (`server/src/lifeos.ts`: present only via `SPECTANT_LIFEOS_STATE_DIR` naming an existing absolute dir,
one stat at start; `GET /api/lifeos {present}`; locks wired into the dashboard loader and list so counts agree; a
`node:fs` spy proves nothing outside the repo is read when absent — **ISC-37 closed**; `tests/dashboard.test.ts` now
applies harbor's one activity lock to the golden), T21+T28 (`live.ts`: last result frame carried forward, tasks.md's
boxes overlaid, locks overlaid as `running` with session/since/elapsed/stale (45 min default), `agents` rail, `needsYou`;
operator-lane tasks never `running`; golden family `live` with a fixed now and each tree's activity reading). Parent
overrides this round: T44 and T51 ran beside T34 (different lanes, no shared file); T21 followed once ISC-37 closed.
Whole tree 1117 pass, static green. Review marks: `DashboardSpecRow` has no lock session field (the row shows a lock only
as a claim leaving takeable; a `taken: {id, session, since}[]` field is the follow-up), lock diagnostics are dropped by
`buildDashboard`, `ui-card` corner glow vs design.md's no-glow rule (decision + hover replacement), prototype light
badge #007e9a vs inherited #1c8ca8, `needsYou` order (brief: question/concerns/operatorOpen; design.md: + fail, operator
under "Your steps"), probe paths `core/tests/live.test.ts` and `core/tests/lifeos-optional.test.ts`, `http.ts` fallback
spelling. Round 9 plan: T16 still held (vocabulary); T46 timeline route; parent adds the seams T35 (shell) and T52
(stub) plus T45/T47 (routes) where files do not overlap.

Principal clarification (2026-09-29, during round 9): Spectant ships **with** its Spec skill (the Claude Code plugin);
the developer starts spec work from the AI chat and the app runs alongside for control and administration. Written for
Claude Code first, expected to work with other agents that understand skills (a later portability claim). Recorded as a
master Decisions row; README and the root CLAUDE.md reworded from "a plugin follows later".

Review 2026-09-29 (mid-run, principal): mark renewed on the unchanged text ("Sofort freigeben"); the textual
amendments stay pending for the next edit — probe paths `core/tests/…` (ISC-36, 68, 70, 79, 80, 83, 87, 90, 91),
ISC-68.1 threshold 13, ISC-98 probe without the skill's install path (the two leak hits), `not-found` in T45, the
skill+app framing in the Vision, the lock-session field on the dashboard row. Two decisions taken: events.jsonl uses the
stage table's names (T16 unblocked; ISC-24 → `tasks → review`), and takeable is gated on a fresh reviewed mark (claims
show `open` before it) — a core task to mint at the next edit, because it moves `status.ts`/`stage.ts` and the goldens.

Review 2026-09-29 (second, amendments applied, mark renewed): probe paths under `core/tests/…`; ISC-68.1 threshold 13;
ISC-98 probe names the Spec skill's gate tool without an install path (check:leak now 0 hits, so CI's leak job can drop
`continue-on-error`); `not-found` in T45, plan.md and resolve.ts's comment; ISC-24 and T69 say `tasks → review`; the
Vision names the skill+app framing; **ISC-99 minted in the master** (takeable only while the reviewed mark is fresh;
claims show `open` before it) with T114 (core rule, goldens) and T115 (`DashboardSpecRow.taken` with session, lock
diagnostics as row warnings). Progress 8/49, master 33/123.

Round 9 landed (2026-09-29, commits 40c9faf … 158f01c): T35 in two parts (data layer: `ApiClient` with ETag cache and
typed results, `LockSourceService`, the area/tab registry; then the shell: one header with eight `data-control` slots,
tiers via ResizeObserver, 352 px rail at wide, tab-bar slot per tier, area routes with redirects, not-found page decided
from the dashboard list, placeholders; shell e2e 24 → 30 passed after the anchors pass made every header control a real
link and gave the area menu a popover), T45+T47 (`spec-routes.ts` + `evidence.ts`: every read route from the files with
ETag/304, hash headers, git-backed timeline ETag folding HEAD, evidence confined — **ISC-71 and ISC-83 closed**; a
session restart lost the first worker mid-way, its worktree diff was saved and a second worker finished it), T46
(`git.ts` read-only commits with head cache), T52 (stub serves every contract route from the goldens with three lock
states and scripted write outcomes), T26 (timeline source tests), T16+T30 (events validator — **ISC-32 closed**).
Round 10 (parent override beside T36): T55 Timeline tab (**ISC-80 closed**), T56 Claims tab (**ISC-81 closed** on the
e2e, taken-card case skipped until the stub overlays locks on claims), T57 Tasks tab (**ISC-82 closed**; no "+N more
done" fold because design.md rules it out), T59 Docs tabs with mermaid 11.17.2 as a lazy chunk (**ISC-84 closed**).
Marks: `data-ready` is never set on spec routes (docs e2e waits on the tab instead); the initial bundle is ~13 kB over
budget and `shell-header.css` over its budget (T36); the `spec` and `claim-view` goldens are built without lock
sources while `live` is built with the activity reading (ISC-72 consistency — decide one rule for all golden
families); the two write routes answer 405 until T67/T69, which need the read-only carve-out T111 names; no `lock`
icon in the icon set; `ui-filter-chips` has no multi-select. CI: `offline` green, `verify` red on the T46 repo
integration test (`source: none` on the runner — diagnostic now surfaced), `leak` can drop `continue-on-error`.
Round 10 landed T36 as commit 19dfa7a (2026-09-29): the header per design at the three tiers — living ring, workspace
and spec pickers as popover at wide and bottom sheet at compact, live states with text for screen readers, palette
field from 1280 px; the overlay primitives gained `data-autofocus` and a safe focus return (**ISC-73 stays open** for
T37/T38, which share it). Shell e2e 39 passed on the main tree. Header CSS is under budget again; the initial bundle
is still ~20 kB over (both i18n catalogues eager, eager page routes, `contract`/`files.ts` in main). Operator tasks of
spec 001 stay with the principal: T59 (shell prerequisite, now met by T35/T36) awaits his tick, T16 the first release,
T83 T78/T65.
Round 11 dispatched (2026-09-29): T37 area menu and tab bar (ISC-76), then five parent overrides whose files overlap
nothing else in flight — T53 spec dashboard (ISC-78), T58 evidence tab (ISC-83.1), T60 primitives glyph/state-chip/
scrubber/disclosure/toast (ISC-88), T114 review-gate rule in core (ISC-99), T50 timeline route tests (ISC-36). T38 zen
is held one round because it edits the same shell files as T37.
Round 11 landed (2026-09-29, commits abf5268 … 9bd1ecc): T50 timeline route tests (**ISC-36 closed**), T114 review gate
as one rule in `partitionClaims` with goldens regenerated (**ISC-99 closed**; harbor KPI takeable 16 → 4, spectant-001
29 → 0 because the frozen copy's mark is stale), T60 primitives glyph / state-chip / scrubber / toast and a disclosure
count (ISC-88 waits for the board), T58 Evidence tab (**ISC-83.1 closed**, T65 ticked with it), T37 area menu and tab
bar (**ISC-76 closed**, T42 ticked with it), T53 spec dashboard (**ISC-78 closed**, T62 ticked with it; a compact
cascade bug — hidden rail cards outranked by `.card`, growing implicit page columns — was fixed on landing after
full-page captures at 390/820/1440). Worktrees are cut from origin/main, so three web workers had to fast-forward onto
the local head mid-round; the parent applies every patch three-way and hand-merges i18n and shared e2e files.
Marks: the shell must mount `<ui-toast>` exactly once; the new primitives are not on the `/__ui` gallery, so the
contrast, focus and motion browser specs do not measure them; the Claims tab still carries its own Unicode glyph map;
the ring prints a percent the model does not carry (decorative under a strict ISC-72 reading); the desktop ring is
96 px, design says 88; `g`-key hints are provisional until T102; invalid `events.jsonl` lines vanish silently from the
timeline (only `parseEvents` reports them). CI: the verify job's "dubious ownership" failure was the git integration
test's own empty global config dropping the runner's safe.directory; the test now trusts its own path.
Round 12 landed (2026-09-29, commits b4b0b02 … 92daff9): T111/T112/T113 lane notes by the parent (**ISC-68.1 closed** on
`check:format-doc`), T67 writes contract (ISC-26 open until `writes.ts`; the reviewed event is `review → build`, the
earlier `tasks → review` wording of ISC-24 was a transcription slip and is corrected in the master, the spec and T69
with a Decisions row, mark renewed), T94 notes contract and migration 2 (ISC-94 open until `notes.ts`; note shape with
title, nullable workspace on orphaning, split anchor `{kind, spec, id?}` instead of the plan's `ref` string because
claim ids repeat across specs, PUT instead of PATCH, counts on their own `/note-counts` route — plan deviations to
confirm at review), T38 zen and rail collapse (**ISC-75 closed**; `railCollapsed` became a real settings key in the
server schema, the client service and the stub), T102 keyboard service (**ISC-97 closed**; T103 ticked with it since
the e2e lives in `keyboard.spec.ts`). CI: the verify job now reads git (the test trusts its own path) and only the
round-subject assertion failed on the depth-1 checkout; it is conditional on a full clone now (376f0dc).
Marks: `ShellState.handleKey` is dead code since the service owns Esc and `[` `]`; `g h` for the dashboard is not in
`SPEC_AREAS`; the existing hints in the area menu, palette and tiles use their own media queries instead of
`showHints`; no `termHints` setting exists; the settings menu/help entry (T40/T41) must call `keyboard.openSheet()`;
the initial bundle is 560 kB against the 500 kB budget (mermaid notices aside), `spec-dashboard.css` and
`tasks-tab.css` are over their 4 kB budgets; the shell host became a flex column (visual baselines unverified).
Round 13 landed (2026-09-29, commits e92c4ef … the Status tab): T40 header e2e (**ISC-73 closed**, read as one banner;
on landing the overlay sheet/dialog heads and the evidence preview head became `<div>`s so the literal "no second
header" holds too), T11 stage table as data with reason templates and a 12-spec fixture walk, T54 Status tab
(**ISC-79 closed**), T68–T77 the two writes with their five probes (**ISC-24, ISC-26, ISC-27, ISC-86 closed**), T80
checkbox wiring (**ISC-25 closed**), T95/T96 notes store (**ISC-94 closed**). Progress 28/49, master 53/123.
Marks: the header's spec picker shows the dashboard row title while the spec head and the zen footer show the spec's
own title (two goldens, decide one); server answers 409 before 423 when both apply, the stub the reverse; the stub's
409 carries no `files`; read-compare-write is atomic only within the process; orphaned notes stay editable from any
workspace and a malformed note id is 404; the rail at wide is still the placeholder, so Waiting on you and Warnings
are not visible at wide and `#waiting` finds no heading there (T54 finding); the gate's `done` state is not clickable;
no 423 e2e for the gate; the ▾ marker uses CSS alt-text syntax (older WebKit shows none); initial bundle 570 kB.
Round 14 landed (2026-09-29, commits 091a201 … the board): T61 counts e2e (**ISC-72 closed**, decisions rows fixme:
the Docs tab has no per-decision hook), T115 `taken` on the dashboard row from the one lock reading (ISC-90 open),
T97–T99 notes persist with `pinned` as migration 3, `import-notes`/`export-notes`, `db rollback` (**ISC-52, ISC-53
closed**), T78/T79 spec head with the shared gate button (**ISC-85 closed**; the head's description is `ideaQuote`,
the Status tab lost its own banner), T100 Notes area (ISC-95 open until the claim-card badge T101), T81 Board Lanes
view (**ISC-89 closed**; ISC-87 waits for Flow and the scrub-changes-no-file e2e, ISC-88 for the fixture gap below,
ISC-90 for T85's agent chips, ISC-93 for the probe's `narrow` file). T39 skipped: spec 001 has no views to move.
Whole e2e suite 426 passed, 8 skipped; initial bundle 609 kB against the 500 kB budget.
Marks: harbor 002 holds 10 of the 11 card states — `absent` appears in no harbor frame (T33 is struck without a
card), only in leadgen's goldens, so ISC-88's threshold needs a fixture edit or a re-read; the Live area's `built`
flag is still false (the board is reachable through the tab bar, `g l` and the status link, the area menu shows it
disabled); `?frame` absent means live on the board but 0 in the keyboard service; the operator lane renders cards, not
the guarded checkbox; This frame / Needs you / Your steps render inline under the lanes until the rail task; the
compact scrubber buttons are 32 px; `notes.contract.ts` `parseFields` destructures for the web tsconfig; a pinned
marker is not in the notes rows; the Edit/Preview choice is component state; the worker's e2e cleanup (`pkill` on
`serve-dist.ts`) can kill sibling servers — brief the next round to kill by pid.
Round 15 landed (2026-09-29, commits ec91a0e … the rail): T93 narrow-board guard (**ISC-93 closed**), T101 note-count
badge (**ISC-95 closed**), T104 offline e2e over every route and write in both themes plus the docker half
(**ISC-2 closed**), T82/T89 Flow view with FLIP on motion tokens and the scrub-changes-no-file e2e, T27/T83 the
eleventh state in harbor 002 (T34 struck after a hold; generator edited), frames tests on harbor and spectant-001, the
card in both densities with the detail dialog and state history, T85/T88 rail blocks, bottom bar merged with the zen
footer, agent chips (**ISC-87 and ISC-90 closed**). T90 (board-states e2e) not written: the worker ran out of turns.
Whole e2e suite 444 passed, 8 skipped, one load flake ("header controls lead where they say" at 820 — 9/9 alone).
Progress 39/49, master 64/123. Port 7717 held a stale smoke-test binary from the day before; stopped.
Marks: `detectRecut` and `buildMatrix` are still stubs (T18/T19; five frames tests are todos); the board tab's inline
card-detail dialog, `openCard` and the `#cardList` template are dead since the card owns its dialog; `FrameCard` and
`LiveCard` carry no path or probe status (a core contract change if the detail is to show them); the medium tier's
stacked rail still shows the T54 placeholder; the board's compact scrubber buttons are 32 px; the e2e README's
`data-ready` sentence is stale; the counts suite's fixme rows need a per-decision hook in the Docs tab; the initial
bundle is 613 kB against 500 kB.
Round 16, partial (2026-09-29 evening): T90 board-states e2e and the board-tab cleanup, T18/T86 re-cut detection as
one rule, T19/T87/T92 matrix model and tab are on main with static, core (844, no todo left), server and web unit
checks green. The browser tier could not be re-run for the last three landings: under a load average above 800 (five
Playwright workers plus two container recordings while Docker Desktop updated itself) the user's launchd domain
wedged — `launchctl print gui/501` answers "Reentrancy avoided", `dscl` eServerError, `id -un` prints the uid —
and Chromium fails at launch. ISC-88, ISC-91 and ISC-92 close on their probes once the browser tier runs again.
Visual baselines (T105–T110): both workers' partial states are saved as patches; 8 of 24 board PNGs recorded before
Docker died; the `VISUAL` file pattern in `web/e2e/playwright.config.ts` must widen to `visual(-[a-z-]+)?.spec.ts`;
the ISC-49/49.1 probe rows still say `-- report`; the e2e fixture's `awaitReady` promise is false for the real app.
(Correction: round 15 ended at 38/49, not 39.)
Round 16, resumed (2026-09-29 night): launchd recovered and Chromium launches again; `board -g states` 6 pass,
`board -g matrix|recut` 8 pass, `frames.test.ts -t recut` 7 pass — **ISC-88, ISC-91, ISC-92 closed**, T92 ticked,
progress 41/49. The board visual-baseline partial state (T107/T108, `visual-board.spec.ts` and 8 PNGs) is lost: the
patches lived in the previous session's scratchpad, which no longer exists; both tasks restart from nothing. T39/T43
(ISC-77) have nothing to move: spec 001's views (its T61–T71: dashboard, overview, inspector, palette) have not been
built, so ISC-77 waits on spec 001, not on this spec's frontier. Docker Desktop is down; T105–T110 wait on it.
Gate fix (2026-09-29, found by 001 round 20): `bun test web/tests` was red on `no-glow` (ISC-74) since the matrix landing (337d9c0): the Matrix tab's edge scroll-shadow used `radial-gradient()`; now a `linear-gradient(to left, …)` of the same 14 px, guard 125/0, stylelint clean, `board -g "matrix scroll"` 1 pass.
Visual claims closed (2026-09-30): **ISC-23, ISC-23.1, ISC-49, ISC-49.1, ISC-96, ISC-96.1** on the pinned container (48/48 per theme); the spec-page, notes-390 and board-390 baselines re-recorded after spec 003's breadcrumb row; T107/T108's `visual-board.spec.ts` rewritten. Stale round-16 locks released. 48/49: only ISC-77 (T39/T43) remains — 001's dashboard, overview and palette now render inside the shell; the inspector (001-T69) is the missing piece.
Handover 2026-09-30: this session's 001 work stops after round 23; see 001 context.md § Handover. 002 stands at 48/49 (ISC-77 open), uncommitted closes since 17b9c14 listed there.
