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
- Chosen: own spec 001 frozen + frozen public leadgen specs (Apache-2.0) + synthetic harbor/lantern/empty-master. Added by the principal mid-shaping: the porzellan-shop specs as a further corpus; being a customer's, they stay a private local corpus behind an environment variable and never enter the repository
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
