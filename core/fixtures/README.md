# <picture><source media="(prefers-color-scheme: dark)" srcset="../../docs/logo.svg"><img src="../../docs/logo-light.svg" alt="" height="28" align="absmiddle"></picture> core/fixtures

Spec trees that `core/` parses in its golden test (ISC-6). Each one is a small repository root: a master `ISA.md`
and a `specs/` folder.

**Public or synthetic, never private.** The repository is public. A fixture is either synthetic (`harbor/`,
`lantern/`, `empty-master/`: every product, spec title, claim and date invented) or a frozen copy of a public
repository (see [Frozen corpora](#frozen-corpora)). Nothing is ever copied from a private repository. No fixture
names a person, a customer, a machine, a private repository or an absolute home path; `bun run check:leak` holds
every tree to that. Private spec trees are read only through `SPECTANT_PRIVATE_CORPUS` on the principal's machine,
and the private corpus test reports skipped, never passed, when the variable is unset.

**Dates are fixed** in March 2026 (frontmatter, gate marks, `rounds.jsonl`, `tldr.md`). Nothing reads the clock, so
the golden snapshots and the visual baselines built on them stay stable.

**Golden snapshots** live beside the trees as `core/fixtures/<name>.golden.json`. They are written by the golden test
(`core/tests/fixtures.test.ts`), never by hand, and double as stub-API data for the web e2e and visual suites. A
snapshot changes only together with the parser change that explains it.

## The fixtures

| Fixture | Exercises |
|---------|-----------|
| `harbor/` | the rich case. Master with 124 claims in F0–F4, 101 closed: the three-digit/three-digit fraction. Six specs across every type but `infra` and `project`, the stages done, build, tasks, review and code-review, and every dashboard warning class. |
| `lantern/` | the small clean case. Master with 12 claims, spec 001 (feature, building) and 002 (bug, scoping), both reviewed. No archive, no TL;DR, no warning. |
| `empty-master/` | a repository with `ISA.md` and `specs/constitution.md` but no spec folder: zero specs. |

### What each harbor spec carries

| Spec | Type · phase | Carries | Expected (as the old Spec skill derives it) |
|------|--------------|---------|---------------------------------------------|
| `archive/001-manifest-sync` | feature · complete | `archived:` date, all 46 claims `[x]`, reviewed and code-reviewed marks, `events.jsonl` with the whole chain from the creation to done in the stage table's names | archived, stage done, no warning; the timeline shows the seven recorded transitions, none derived |
| `002-web-console` | feature · building | reviewed mark renewed after the re-cut, `rounds.jsonl` with three rounds, 25 of 30 claims closed and 27 of 32 tasks `[x]`, one claim blocked by an edge, dotted IDs `ISC-60.1`/`ISC-60.2`; every card state of the round board (see below) | stage build, no warning; R1 9/30, R2 15/30, R3 25/30 with `stop` "a decision only the principal can make" |
| `003-config-loader` | refactor · scoping | no reviewed mark, no `tasks.md`, no mermaid fence in `spec.md` or `plan.md` | stage tasks, warning review (missing); diagram verdict `warn`, which the dashboard does not list for a refactor |
| `004-retention-policies` | feature · building | every claim `[x]`, `plan.md` without a mermaid fence, current reviewed mark, stale code-reviewed mark | stage code-review, warnings diagrams (`plan.md`) and closed |
| `005-config-format-choice` | spike · scoping | one claim, two `- fog:` lines, no reviewed mark | stage review, warnings review (missing) and fog |
| `006-partial-push` | bug · scoping | stale reviewed mark, `ISC-125` unknown to the master, master claim `ISC-4` of F0 not projected | stage review, warnings drift (`unknown_to_master`, `missing_in_spec`) and review (stale) |

**The round board in 002.** One fixture holds all eleven card states (ISC-88), checked by
`core/tests/harbor-states.test.ts`:

- waiting (`held`, with the plan's reasons: width, `after Tn still open`, operator lane), dispatched, question,
  concerns, fail, done and closed come from the three rounds. R2 has T14 `fail` (`probe exit 1 — …`), T17 `concerns`
  (reader Forge, verdict `concerns`), T22 `done` (its sibling on ISC-69 still out) and T30 `question`. R3 redispatches
  T14 and T17 with a `retry with:` note, keeps the question open (now T29), leaves T27 `dispatched` and stops.
- running comes from `harbor/.spectant/activity.jsonl`: a `claim` line for T27 (ISC-74, `spec-002-ISC-74`, `wt-7`)
  without a release, beside one claimed-and-released pair for T25.
- absent comes from the re-cut between R2 and R3: T27 (registry-list focus order) was struck and T28–T33 renumbered to
  T27–T32, so T33 is gone from R3 and `tasks.md`, and the ids T27–T32 name other tasks than they did in R1–R2. The
  question recorded on T30 in R2 belongs to T29 in R3; T30 is now an operator step. No state may follow the bare id.
- operator open and operator done come from `tasks.md`: T31 `[ ]` and T30 `[x]`, both on ISC-77.

`.spectant/` is ignored at the repository root; `core/fixtures/.gitignore` re-includes it for the fixtures.

`specs/tldr.md` was generated on 2026-03-07, before the newest spec `updated:` (003, 2026-03-09): stale. It does not
name 006, which was opened after it, so the old skill's completeness check fails on it too; that is deliberate.
`specs/constitution.md` names `dev_services: 4200=Web dev, 8080=API`.

The code-reviewed marks hold fixed tree and head ids that match no working tree, so they read as stale wherever the
tree hash is computed. They carry no `root` path, unlike the old skill's marks, because a machine path has no place
in a public fixture. The archived spec keeps `isa_master: ../../ISA.md` unchanged, as the old archive tool leaves it.

### Stage per spec in the other trees

`core/tests/stage.test.ts` walks every spec of every tree and checks the stage, the next command and its reason
against `FORMAT.md`'s stage table and against the Expected column of both tables here. `empty-master/` has no spec.

| Tree | Spec | Type · phase | Expected |
|------|------|--------------|----------|
| `lantern/` | `001-reading-list` | feature · building | stage build, `/spec-implement 001`, "ISC-7 and ISC-9 are takeable" |
| `lantern/` | `002-duplicate-links` | bug · scoping | stage build, `/spec-implement 002`, "ISC-11 and ISC-12 are takeable" |
| `leadgen/` | `012-pwa-install` | feature · building | stage build, `/spec-implement 012`, "ISC-334 is takeable" |
| `leadgen/` | `022-chat-turn-status-and-bulk-delete` | feature · complete | stage done, no command, "phase: complete" |
| `leadgen/` | `archive/013-tech-debt` | refactor · complete | archived, stage done, no command, "phase: complete" |
| `spectant-001/` | `001-app-skeleton` | feature · scoping | stage review (the frozen copy carries no `.gates/`), `/spec-review 001`, "the reviewed mark is missing" |

## Frozen corpora

Copies of public repositories, frozen so their golden snapshots change only for a parser reason. A frozen tree is
not edited after the freeze: a parse diagnostic on it is a finding for `FORMAT.md`, not a reason to change the copy.

| Tree | Source | Licence | Frozen at | Refresh rule |
|------|--------|---------|-----------|--------------|
| `spectant-001/` | this repository, spec 001 | Apache-2.0, as this repository | the commit named in its `COMMIT` file | only on `/spec-complete 001` |
| `leadgen/` | github.com/codeministry/leadgen | Apache-2.0 | the commit named in its `README.md` | only by a deliberate re-freeze, recorded in a Decisions row |

A refresh rewrites the tree from the named source commit, updates the commit it names, and regenerates the golden
snapshot through the golden test in the same change.

## Regenerating

`harbor/` is written by `harbor/generate.ts`, deterministically: running it twice gives byte-identical files.

```bash
bun core/fixtures/harbor/generate.ts
```

`lantern/` and `empty-master/` are written by hand. The reviewed marks in `lantern/` hash the review-relevant text of
`spec.md`, `plan.md` and `tasks.md`; after editing those files, write the mark again with a fixed time:

```bash
bun core/fixtures/harbor/generate.ts --mark-reviewed core/fixtures/lantern/specs/001-reading-list 2026-03-04T10:00:00Z
bun core/fixtures/harbor/generate.ts --mark-reviewed core/fixtures/lantern/specs/002-duplicate-links 2026-03-06T10:30:00Z
```

Either way, the golden snapshots are regenerated by the golden test afterwards, never edited.
