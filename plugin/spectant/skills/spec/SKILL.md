---
name: spec
description: "Spec-driven feature folders: specs/NNN-slug/ with spec.md, plan.md, tasks.md, one master ISA.md and one specs/constitution.md. Sets a repo up, shapes an idea into a spec, plans it, breaks it into tasks, reviews it, implements the tasks until each claim closes on its probe's evidence, closes and archives it, and reports status and drift. USE WHEN spec, spec idea, shape an idea, write a spec, new spec, plan the spec, plan.md, break into tasks, tasks.md, review the spec, implement the spec, work the tasks, spec done, close the spec, spec status, spec drift, specs/NNN, constitution, spec-driven."
argument-hint: "[init | idea <sentences> | new <type> [notes] | plan|tasks|review|implement|done [NNN]]"
---

# Spec

Turns a request into a numbered spec folder in the repository, `specs/NNN-slug/`, and scales the ceremony to the kind
of work: a bug gets one short document, a project gets a constitution, a spec, a plan and a task breakdown. `spec.md`
holds every claim; `plan.md` and `tasks.md` hold none. Claims are minted **in the master `ISA.md` first** and only then
projected into the spec, so a spec never holds an ID the master does not know. Files in the repository are the only
source of truth; the Spectant app, when it runs, reads the same files and is never required.

## Subcommands

Arguments: `$ARGUMENTS`. The first word (`$0`) picks the row; the rest is passed on. Read the row's workflow file
(relative to this skill's folder) and follow it; read nothing else up front.

| Subcommand | Arguments | Workflow | Covers |
|---|---|---|---|
| `/spec` | none, or `NNN` | `workflows/status.md` | help, status of every spec, drift against the master, sync of a spec with the master |
| `init` | none | `workflows/init.md` | set the repo up: master `ISA.md`, `specs/constitution.md`, the first spec |
| `idea` | `<sentences>` | `workflows/idea.md` | shape a rough idea: three shapes, a short question round, a filled template, then `new` on a yes |
| `new` | `<type> [notes]` | `workflows/new.md` | allocate and write a spec of one of the six types from its template |
| `plan` | `[NNN]` | `workflows/plan.md` | write `plan.md`, the how, locked in one question; the design pass for a UI spec |
| `tasks` | `[NNN]` | `workflows/tasks.md` | break the spec into `tasks.md`, atomic steps anchored to claim IDs |
| `review` | `[NNN]` | `workflows/review.md` | review a spec before `implement` and set the review mark on a yes; the code review of a finished feature |
| `implement` | `[NNN]` | `workflows/implement.md` | work the tasks in rounds until claims close on probe evidence |
| `done` | `[NNN]` | `workflows/done.md` | check every close condition, close the spec, reconcile the master, archive finished specs |

- An empty `$0`, `help`, `status`, `drift`, `sync` or a bare number (`/spec 031`) routes to the `/spec` row.
- Any other unknown word: show the help from `workflows/status.md` and stop; never guess a subcommand.
- `NNN` missing where a row takes one: take it from the branch or worktree name (`<prefix>/NNN-slug`), else ask.

## Output header

The first line of every reply names the spec and carries the reply's core sentence, so a console, the app and a
terminal sidebar preview (about 150 characters) all point at the same spec:

```
📐 Spec NNN · <subcommand>: <core sentence, at most about 100 characters>
```

- Several specs in one reply (status, drift): `📐 Spec 003 · 007 · 016 · status`. No spec yet (help, `init`, a
  template before a folder exists): `📐 Spec · <subcommand>`. A new spec takes its number as soon as `allocate` gave it.
- A reply that spans steps (implement rounds, review, done) repeats the header at each visible status note.

## Prerequisites

- `bun` on the `PATH`; the CLI below is a bundled bun script. Missing: say so in one line and stop.
- A git repository. Its own `CLAUDE.md` and `specs/constitution.md` decide the prose language of a spec, the branch
  prefix and whether an agent may commit or push. Structure stays English everywhere: slugs, section names, claim and
  task IDs, frontmatter keys and enum values.
- **Never commit or push** unless the repository's `CLAUDE.md` allows it; then only on a feature branch, never on the
  default branch.

## The CLI is the only writer of bookkeeping

```bash
bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check" <command> … [--json]
```

Exit codes: `0` ok · `1` bad arguments · `3` drift or gate open · `4` lock lost. Claims, Verification and Decisions
lines, progress counts, locks, gate marks, events and run lines are written by the CLI and never by hand; prose (Goal,
Context, plan text, task text, `context.md`) is written directly.

| Command | Does |
|---|---|
| `allocate <type> <slug>` | the next free number, the folder `specs/NNN-slug/` and its first files from the type template |
| `mint <spec> …` | claims into the master `ISA.md` first, then into the spec |
| `verify <spec> <ISC-N> <type> "<stub>"` | the Verification line in spec and master, the claim ticked, progress recounted |
| `decide <file> "<line>"` | one Decisions row |
| `status [NNN]` · `drift [NNN]` · `frontier <spec>` | stage and progress · drift against the master · takeable claims and blockers |
| `claim <ISC-N> --session <actor>` · `release <ISC-N> --session <actor>` | locks, in `.spectant/activity.jsonl` only |
| `gate check reviewed\|code-reviewed <spec>` · `gate reviewed <spec> --yes` · `gate code-reviewed <spec> --yes --code N --security N` | read and set the marks in `.gates/`; setting the review mark appends the one `review → build` line to `events.jsonl` |
| `transition <spec> <to>` | one `events.jsonl` line per stage change |
| `run start <spec\|idea> --session <actor> --command "<…>"` · `run end <run-id> --outcome ok\|error` | the run pair the app shows |
| `rounds record <spec> …` · `activity <event> …` | the round log line · one step line (dispatch, build, patch, apply, probe, question) |

`<actor>` follows the actor grammar in the repository's `FORMAT.md` when it has one: `a:<kind>:<id>` for an agent
session, `a:<kind>:<id>/T<n>` for a sub-agent on one task.

## Runs and stage changes

- Every subcommand that works on a spec or an idea starts with `spec-check run start <spec|idea> --session <actor> --command "/spec
  <subcommand> <args>"` and ends with `spec-check run end <run-id> --outcome ok`, or `--outcome error` when it fails or
  is aborted. End the run before the reply that ends the turn, also when that reply is an open question; the next turn
  starts a new run.
- The `--session <actor>` of a run is the session's own actor (`a:claude:spec-NNN` for the session working spec NNN). Without
  it the CLI records its own name, and the app shows every task of the running spec as locked by the CLI.
- Every subcommand that moves a spec's stage appends exactly one event through `spec-check transition`, never by
  editing `stage:` or `events.jsonl` by hand.
- `implement` checks `spec-check gate check reviewed <spec>` first; exit 3 stops it and points at `/spec review NNN`.

## The six types

The type is asked first and decides everything downstream; the templates live in `templates/`.

| Type | Artifacts | Depth |
|---|---|---|
| **bug** | `spec.md` | trivial: reproduction, one regression claim |
| **spike** | `spec.md` | trivial plus fog: one question, one claim, no build |
| **refactor** | `spec.md`, `tasks.md` | reduced: behaviour is held, not changed |
| **feature** | `spec.md`, `plan.md`, `tasks.md` | substantial |
| **infra** | `spec.md`, `plan.md` | substantial: rollback is a required answer |
| **project** | all four, constitution included | deepest: full interview before building |

## Layout

```
<repo>/ISA.md                        # the master: every claim ID is minted here first
<repo>/specs/constitution.md         # once per repo: binding rules, probes, adaptations, lanes
<repo>/specs/ideas/<slug>.md         # a shaped idea (story), the stage before a spec
<repo>/specs/NNN-slug/spec.md        # the only place a claim is allowed
<repo>/specs/NNN-slug/plan.md        # the how; no acceptance criterion
<repo>/specs/NNN-slug/tasks.md       # atomic steps, each anchored to one claim ID
<repo>/specs/NNN-slug/context.md     # what was asked before each artifact; gates nothing
<repo>/specs/NNN-slug/design.md      # after the design pass, UI specs only
<repo>/specs/NNN-slug/events.jsonl   # one line per stage change (spec-check transition)
<repo>/specs/NNN-slug/rounds.jsonl   # one line per implement round (spec-check rounds record)
<repo>/specs/NNN-slug/.gates/        # review marks (gitignored)
<repo>/specs/NNN-slug/artifacts/     # results the tasks produce (versioned)
<repo>/specs/NNN-slug/.evidence/     # raw evidence: screenshots, exports, transcripts (gitignored)
<repo>/specs/archive/NNN-slug/       # an archived spec: number still taken, claims still in the master
<repo>/.spectant/activity.jsonl      # locks, runs and step lines (spec-check only)
```

A repository without a master `ISA.md` keeps its claims in the spec itself; say so once, and the master half of every
rule below does not apply.

## Rules that hold in every subcommand

- **Master first.** Claims are minted in `ISA.md` before the spec names them (`spec-check mint`); `drift` exit 3 is a
  defect to fix, not a warning.
- **Evidence before the checkmark.** Probe, then `spec-check verify` (stub, tick, progress), then the `tasks.md` box,
  then `release`. One claim at a time, per claim, never batched at the end. Only the parent session writes `spec.md`,
  `tasks.md` and `ISA.md`; sub-agents change code and return evidence.
- **One question per `AskUserQuestion`**, the recommended option first and marked as such. Ask only what changes the
  claim set, the seam or the probe; mark everything else inline as `⟨?: … ⟩` and move on.
- **No acceptance criteria in `plan.md` or `tasks.md`.** They point at claim IDs; a claim lives only in `spec.md`.
- **No `.html` written by any subcommand.**

## Gotchas

- **The Test Strategy columns are positional:** `isc | type | check | threshold | tool | anchors_to | severity`. An
  omitted `threshold` is an empty cell, never a removed column; drop the column and `anchors_to` slides into the
  `tool` slot.
- **A spike does not close with open fog.** Every `- fog:` line graduates to a claim or dies in a Decisions row.
- **An empty Probe cell is a `review` or `unenforced` row and must read as one.** A plausible command nobody runs turns
  an honest gap into a false green.
- **A number is an address, not an identity.** Only `spec-check allocate` picks it (local folders, archive, history and
  branch names); no claim or decision points at it.
