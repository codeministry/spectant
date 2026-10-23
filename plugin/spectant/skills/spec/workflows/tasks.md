# `/spec tasks <NNN>` — break a spec into `tasks.md`

**Purpose:** a `tasks.md` that decomposes the spec into atomic, checkable steps, each hanging on exactly one claim ID,
in an order that matches the spec's own dependency edges. The file defines nothing; it decomposes. It carries no
acceptance criterion, no probe of its own and no diagram.

`CLI` below stands for `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"` (exit 0 ok · 1 bad arguments · 3 drift or gate
open · 4 lock lost; `--json` for machine output).

## When to run

First, before the type: a spec without claims (the total in `progress` from `CLI status NNN --json` is 0) is refused
with one line naming `/spec new NNN`, which mints its claims in its own folder, and nothing is written; every task
hangs on a claim ID. The run still opens and ends `ok`, as for every refusal by design.

For the types `refactor`, `feature` and `project`, after `spec.md` (and `plan.md` where the type has one). Not below
three claims: a task list with one entry is a checkbox with a cover page. A spec of another type (`bug`, `spike`,
`infra`, `chore`), or one below three claims, has no `tasks.md`: it is refused with one line that names the `next` from
`CLI status NNN --json` as the command to run instead, for example "a spike has no tasks.md; next: /spec review 054",
nothing is written, and the run ends `ok`.

## Step 0 — Open the run

Resolve the folder `specs/NNN-slug/` (`NNN` given, else ask). Then:

```bash
CLI run start specs/NNN-slug --session <actor> --command "/spec tasks NNN"
```

Keep the run ID it prints. Every exit from this workflow, a stop, an error or an open question that ends the
turn included, ends with `CLI run end <run-id> --outcome ok` (or `--outcome error`).

## Step 1 — Read the frontier

```bash
CLI frontier specs/NNN-slug        # takeable claims and the blockers of the rest; --json for the full list
```

This is what makes `[P]` derivable instead of invented. Read `spec.md` (claims, their `(after: ISC-…)` edges, the
Test Strategy), `plan.md` (Stack Decisions, Affected Files) and the repository's `specs/constitution.md`
(`## Lanes`, `## Gates`).

## Step 2 — Decompose

Each task line names the task ID, the claim it serves, optionally `[P]` or `[seam]`, the lane, what it does and the
file it touches (format below). Atomic means a task is one sitting and one file where that is possible: if a task
needs a paragraph to explain, it is two tasks. The decomposition is complete when every claim in the spec has at least
one task and every task has exactly one claim.

**When `specs/NNN-slug/design.md` exists, read it too.** Each planned-state decision that needs work becomes part of a
task under the claim it serves, and the task text names the viewport it came from (e.g. "· Mobile"). A design decision
no claim covers is not a task: it goes back to `spec.md` as a claim, minted in the master first (`CLI mint`), or it
stays design intent with no task at all. Without `design.md` this step contributes nothing.

**The lane comes from the path, not from the task's wording.** Read the constitution's `## Lanes` table (lane, path
prefixes, context, lane probe). Without that block, apply the defaults: `web` the frontend tree, `server` the backend
tree, `ai` model, prompt or training code, `infra` charts and deploy config, `test` end-to-end and fixture trees. A
lane is a context key for dispatch, not a permission and not a person. A task whose path column names files in two
lanes is two tasks.

**A step no worker can take gets lane `operator`, whatever its path.** Filling in a real credential, a subjective
bake-off, anything whose evidence is the user's judgement rather than a probe: `/spec implement` never dispatches it,
at any width, until the user ticks it, and the round log keeps it apart from agent work. Use it only when the step
itself is the barrier. A claim that merely closes on the user's word already has `type: manual` in its Test Strategy
row and does not need its task moved to this lane.

**A claim that spans lanes gets its seam first.** Where one claim's tasks land in two lanes (say `web` and `server`),
the contract between them (DTO, endpoint signature, interface, message shape) is a task of its own, marked `[seam]`,
and every task on either side carries `(after: T<seam>)`. The seam's content is a plan-level choice: write it into
`plan.md` § Stack Decisions before the tasks that depend on it exist, so two workers build against one contract
instead of each inventing half of it. If `plan.md` already fixes the contract, the seam task is the one that lands it
in code. A seam task is never `[P]`.

## Step 3 — Get the edges right

The four edge rules are the check:

1. **Claim edges `(after: ISC-N)` live only in `spec.md`.** They are the edges `CLI frontier` reads and validates.
2. **Task edges `(after: T…)` live only in `tasks.md`.** A `T` ID in `spec.md` is an unknown ID there and breaks
   validation.
3. **Claim edges reach through.** If `spec.md` says `ISC-B … (after: ISC-A)`, every task of B carries an `after`
   chain reaching at least one task of A. A violation is a broken decomposition, not a formatting slip.
4. **`[P]` is derived, not invented.** A task may carry it when its claim came back takeable in step 1, it has no
   `after` edge other than one pointing at a `[seam]` task, and no other `[P]` task names the same file in its path
   column (same-file edits collide regardless of claim edges). The marker says a task *may* run in parallel, the seam
   says *when*; the live plan in `/spec implement` is the authority at dispatch.

**Spec edges.** When a task needs another spec merged first, its `(after: …)` names that spec's three-digit number,
`(after: T3, 041)`, on the task lines where the dependency actually bites. A spec edge goes on a task line, never on a
claim line: claim text is the master's, and `041` is an unknown claim ID. `/spec implement` holds the task as waiting
on that spec until its branch is merged into the default branch or, without a branch, until it is `phase: complete` or
archived; Spectant shows the same token as `waits on 041`. A spec edge does not count against `[P]` in rule 4. It
holds only the task that carries it, not the tasks chained after it, so a spec that should wait as a whole carries the
edge on every task that starts a chain. Prose like "builds after 041" in Constraints or Decisions is for people; no
tool reads it.

**The probe mapping copies; it never invents.** Each task maps to the probe its claim already names in `spec.md`
§ Test Strategy, copied verbatim. A probe defined here would be a claim in the wrong file. A conformance gate is never
a task row: it is the repository's ladder, named once in the constitution's `## Gates` and run by `/spec implement` at
each stop. A task whose only purpose is satisfying a gate (adding a missing lint script, say) hangs on a claim like any
other; if no claim covers it, it is not a task: name it to the user as remaining work.

## The `tasks.md` format

Write the file in the spec's prose language (from the repository's `specs/constitution.md` or `CLAUDE.md`); IDs,
lanes, flags, paths and probe commands stay as they are.

```markdown
---
spec: NNN-slug
plan: plan.md
updated: <YYYY-MM-DD>
---

# Tasks NNN — <title>

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

- [ ] T1 · ISC-34 · [seam] · server — DTO and endpoint signature for the derived order · `server/src/order.contract.ts`
- [ ] T2 · ISC-34 · [P] · server — derive the order from the model (after: T1) · `server/src/order.ts`
- [ ] T3 · ISC-34 · [P] · web — the view consumes the derived order (after: T1) · `web/src/app/order/view.ts`
- [ ] T4 · ISC-35 · operator — enter the staging credential in the vault (after: T2) · `docs/staging.md`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1–T3 | ISC-34 | `<the probe ISC-34 names, verbatim>` |
| T4 | ISC-35 | `<the probe ISC-35 names, verbatim>` |
```

The line grammar the parser reads:

`- [ ] T<n> · <claim ID> · [flags · ] <lane> — <text> [(after: T<a>, T<b>)] · <paths>`

- The head, up to the first ` — ` outside code spans, is the claim ID, then the flags, then the lane token.
- Flags are `[P]` and `[seam]`, in either order.
- The lane is checked against the first column of the constitution's `## Lanes` table; `operator` is always valid.
- `(after: …)` names tasks, not claims (`T3–T5` ranges expand) and may stand anywhere in the text; a token of exactly
  three digits in it is a spec edge.
- The text runs to the last ` · ` outside code spans; the paths follow it, split on `, `. A code span (or a bare token
  with a `/` or `.`) is one path; a parenthesised item such as `(probe only)` is a note, not a path.
- A checked box `- [x]` means landed. A struck task is a plain bullet, `- ~~T<n> · …~~ — struck <date>: <reason>`,
  never a checkbox; it counts in no fraction.
- `## Probe Mapping` is a table `Task | Claim | Probe`; the first cell lists task IDs or ranges, `\|` in a cell is a
  pipe. Every task has a row, and the claim in the row is the task line's.

## Step 4 — Record the stage and close the run

When the spec stood in `tasks` (no `tasks.md` before this run), move it on with one event:

```bash
CLI transition specs/NNN-slug review      # tasks → review under the default workflow
```

A repository whose `specs/workflow.md` reorders the stages names a different successor; the CLI refuses a pair the
workflow does not allow (say what it printed, do not force it). Then `CLI run end <run-id> --outcome ok`.

## Done

Every claim decomposed, every task anchored, every task carrying a lane, every cross-lane claim behind a seam, the order
consistent with the spec's edges. Offer `/spec review <NNN>` to read the result and set the review mark before
`/spec implement <NNN>`; `CLI frontier specs/NNN-slug` shows what the first round could take.
