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

## Still open
- none. The three fog lines of Round 1 closed in Round 3 (spec.md § Decisions 2026-09-29).
