# done — close a spec, optionally archive it

`/spec done <NNN>` closes one spec. `/spec done <NNN> archive` closes it and then moves it to `specs/archive/`. A spec
is closed only when everything that makes it done is proven at once: claims, drift, gates and a code review of exactly
the code that is there. Then it says so in one place, `phase: complete`.

`spec-check …` below is the plugin CLI, invoked as `SKILL.md` names it. Exit codes: 0 ok, 1 bad arguments, 3 drift or
gate open, 4 lock lost. Add `--json` wherever the output is read by a step rather than shown to the user.

## Run lines

Start with `spec-check run start <NNN> --command "/spec done <NNN>"` and keep the run id it prints. End with
`spec-check run end <run-id> --outcome ok`, or `--outcome error` on any stop: a failed close condition, a refused
transition, a write that did not land, the user saying no. Every path out of this workflow writes the end line.

## Done looks like this

`specs/NNN-slug/spec.md` carries `phase: complete`, a current `updated:` and `completed:`, and `stage: done` with its
one `events.jsonl` line. `plan.md`, where it exists, carries `status: approved` unless it was `superseded`. The master
`ISA.md` knows every close: the drift audit comes back clean. Nothing is committed unless the target repository's own
`CLAUDE.md` allows it and the user says yes in this session.

## Step 1: the close conditions

*(safety gate: every condition is checked with the probe named, every failure is reported, none is waived here)*

Run all of them before writing anything and report the full table, never just the first failure.

| Condition | Probe | On failure |
|---|---|---|
| Every claim `[x]` or `[DROPPED — …]` | `spec-check frontier <NNN>` lists no open claim | name the open claims; `/spec implement <NNN>` (a `manual` claim: Step 2) |
| No `- fog:` line left in `## Not yet specified` | read `spec.md` | the fog becomes a claim or moves to the master's `## Remaining Work`: the user's call |
| Declared progress equals the count, no drift | `spec-check drift <NNN>` exits 0 | reconcile first: the sync section of `workflows/status.md` |
| The spec parses without an error diagnostic | `spec-check status <NNN>` shows no error | fix the spec, never the check |
| The gate tier the constitution names for a spec close is green | that command from `specs/constitution.md` § Gates | red for a cause outside `## Conformance baseline` → stop |
| The reviewed mark is fresh | `spec-check gate check reviewed <NNN>` exits 0 | `/spec review <NNN>` |
| The code that is there was reviewed | `spec-check gate check code-reviewed <NNN>` exits 0 | the code-review step of `/spec review <NNN>`; a gate the workflow skips: Step 3 |

Also report, without blocking: whether the reviewed state is committed (`git status --short` empty outside
`specs/NNN-slug/.gates/`) and whether the branch is pushed (`git status -sb` shows no `ahead`).

## Step 2: a `manual` claim

A claim whose Test Strategy row has type `manual` (the second column; the columns are positional) has no probe this
workflow can run. It closes only on the user's own words in this session:

1. Show the claim and its Test Strategy row, then ask one question (`AskUserQuestion`, recommended option first):
   confirmed as stated, or not yet.
2. On a confirmation, record the user's words verbatim, quoted, never paraphrased:
   `spec-check verify <NNN> <ISC-N> "confirmed by the user: \"<their words>\""`. The Verification line lands in the
   master and the spec before the checkmark; the command keeps that order and recounts progress.
3. "Not yet" leaves the claim open and the close fails on it. A claim the user wants dropped is a change to the claim
   set, not a close: it is made in the master first, never by ticking or editing the spec here.

Apart from this, the workflow never closes a claim. An open claim with a probe is `/spec implement` work, not a
formality to tick here.

## Step 3: a gate the workflow skips

`specs/workflow.md` sets `code_review` per spec type: `spec` (one code-reviewed mark per spec), `feature` (one mark for
every spec of the main feature) or `none` (no code-reviewed mark at all).

- **`none`**: the code-reviewed condition does not apply. Pass it deliberately and record that it was passed:
  `spec-check decide specs/NNN-slug/spec.md "<date> — code review passed deliberately: code_review is none for <type>"`.
  A mark set anyway changes nothing.
- **`feature`**: the mark is the feature's (`scope: F<n>`), set once for every spec of `F<n>`. While a sibling spec of
  the feature is still open, this spec waits in `close-pending`: report it and stop, nothing is written.
- **`spec`** or no `specs/workflow.md`: the condition holds as in the table.

When the condition fails but the user wants to close anyway (a repository whose constitution makes the review
optional per spec), ask one question with "Pass deliberately" as an option, never as the recommendation. On the
user's yes, record a Decisions row with `spec-check decide` naming the gate, the date and the user's reason in their
words. Without that row the gate is not passed.

## Step 4: the writes

Only when every condition holds or was passed with its Decisions row. This workflow is the only writer, in this order:

1. `spec-check transition <NNN> done`: it plans the stage move against the stage table and its fixed gates, writes
   `stage: done` into `spec.md` and appends exactly one line to `events.jsonl`. A refused plan writes nothing; report
   its reason and stop with `--outcome error`.
2. `spec.md` frontmatter: `phase: complete`, `completed: <today>`, `updated: <now, ISO>`. Nothing else in the file
   changes.
3. `plan.md` frontmatter: `status: draft` → `status: approved`. `superseded` stays.
4. Reconcile with the master: the sync section of `workflows/status.md` for `<NNN>`. After a clean `/spec implement`
   run it finds nothing to do. The master's own `phase` is not touched: a master spans many specs.

## Step 5: after the writes

The close edits changed `spec.md` (and maybe `plan.md` and the master) after the code review, so the code-reviewed
mark is now stale on exactly those files. That is expected. Confirm it with `spec-check gate check code-reviewed
<NNN>`: every changed path it names must lie under `specs/NNN-slug/` or be the master `ISA.md`. Any other path means
code changed after the review: report it and offer no commit.

Otherwise, and only when the target repository's `CLAUDE.md` allows agents to commit, offer one commit: message
`Close spec NNN-slug` in the repository's commit language, the body listing the claims closed, on the repository's
branch rule; push only if the branch is already tracked. Run it only on the user's explicit yes in this session:
`git add` of exactly those paths, no `--no-verify`, no force push.

## Step 6 (optional): archive — `/spec done <NNN> archive`

`specs/` shows the work that is still alive. A finished or abandoned spec moves to `specs/archive/NNN-slug/`, keeps
its number and its claims in the master, and can come back.

```bash
spec-check archive <NNN> [<NNN>…] --dry-run            # always first: every blocker and every reference left behind
spec-check archive <NNN> [<NNN>…] [--reason "<text>"]  # the move
spec-check archive restore <NNN>                       # bring one back
```

*(safety gate)*

- **A soft blocker is the user's call.** A spec that is not complete, or still has an open claim, moves only with
  `--reason` in the user's own words from this session. Offer the close (Steps 1 to 5) as the alternative when the
  only thing missing is the close.
- **Hard blockers are never worked around.** Drift goes to the sync section of `workflows/status.md`, a lock to
  whoever holds it.
- **References are reported, never edited.** Tracked files that name the old path are listed from the dry run; the
  master's paths change only on the user's yes after they saw that list.
- **The number stays taken.** `spec-check allocate` numbers above every archived spec. `specs/` may be untracked; then
  the archived folder is the only record of its number, so an archived spec is never deleted.

Verify afterwards: `spec-check drift` exits 0 and `spec-check status` lists the spec as archived.

## What this workflow does not do

- Never closes a claim on its own judgement; a `manual` claim closes only on the user's words (Step 2).
- Never edits a gate, the constitution or the baseline to make a condition pass.
- Never sets the reviewed or code-reviewed mark itself; `/spec review` does.
- Never hand-edits the master `ISA.md`; every change to it goes through `spec-check`.
- Never merges, opens a pull request or deletes a branch unless the target repository's `CLAUDE.md` gives that to
  agents.

## Report

The condition table with each result, the claims closed by the user's words (quoted), every Decisions row written,
the writes made, the archive move if any, and the commit hash if a commit was made.
