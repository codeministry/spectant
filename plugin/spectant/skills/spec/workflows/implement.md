# implement — work a spec's tasks until its claims close

`/spec implement <NNN>` builds a spec in rounds: it takes what the frontier allows, sends each task to its own builder
in its own git worktree, applies what comes back, and closes each claim on its own probe's evidence. It works the whole
spec, round after round, until a stopping condition fires, and reports what closed, what is open, and why.

`spec-check …` below is the plugin CLI, invoked as `SKILL.md` names it: `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"`.
Exit codes: 0 ok, 1 bad arguments, 3 drift or gate open, 4 lock lost. Add `--json` wherever a step reads the output
rather than shows it.

## Done looks like this

Every claim in `specs/NNN-slug/spec.md` is either `[x]` with a one-line provenance stub in `## Verification` that a
second person could re-run, or `[ ]` with a named reason. `progress: M/N` is the mechanical count in both `spec.md` and
the master `ISA.md`; `spec-check drift NNN` exits 0; the constitution's `## Gates` are green, or red for a reason already
in its `## Conformance baseline`. Nothing is committed unless the repository's own `CLAUDE.md` allows it.

## Run lines

Resolve the folder under `./specs/` (`NNN` given → `specs/NNN-*`; nothing given → the number in the branch or worktree
name, else ask), then `spec-check run start specs/NNN-slug --command "/spec implement NNN"` and keep the run ID. Every
path out of this workflow ends with `spec-check run end <run-id> --outcome ok`, or `--outcome error` on a failure or an
abort: the review gate answered "not yet" is `ok`, a stopping condition is `ok`, a write that did not land is `error`.
One pair per invocation, around the whole subcommand and all its rounds; end it before the reply that ends the turn.

## Step 1: the review gate

*(safety gate — before any claim, lock or dispatch)*

```bash
spec-check gate check reviewed specs/NNN-slug
```

Exit 0 → go to Step 2. Exit 3 (no mark, or a stale one: the CLI names the files that changed since the review) →
**stop and ask in the conversation.** No app is needed and none is assumed to run.

1. Show the short review summary exactly as part 1 of `workflows/review.md` builds it: goal in one sentence, the claims
   with the open ones named, the plan's approach, the task count per lane, the first-round preview from
   `spec-check frontier specs/NNN-slug`, and anything that should stop a build (open `⟨?: …⟩` marks, fog lines, a
   required file missing, a claim without a probe, a task without a claim). On a stale mark, name the changed files.
2. Ask once, one `AskUserQuestion`: "Spec NNN has no current review. Review and approve it now?" Options:
   **Approve and implement** (recommended and listed first when nothing blocks) and **Not yet** (listed first and
   recommended when something blocks, with the reason in its description).
3. **On the user's explicit yes** → `spec-check gate reviewed specs/NNN-slug --yes`. It writes
   `specs/NNN-slug/.gates/reviewed.json` and appends exactly one `review → build` line to the spec's `events.jsonl`. Run
   `spec-check gate check reviewed specs/NNN-slug` again; exit 0 → Step 2.
4. **Not yet**, silence, or anything but an explicit yes → write nothing, say that `implement` stays closed until a
   fresh mark exists (`/spec review NNN`, or the review view in Spectant), end the run, stop.

Only the user's answer in this session approves. What this workflow writes itself (checkboxes, frontmatter,
`## Verification`, `## Decisions`) is normalized out of the mark's hash, so a resumed run stays open; a claim, task or
edge added mid-run makes the mark stale on purpose.

## Step 2: before the first round

- **The working tree.** Run from the spec's own worktree or branch (the repository's `CLAUDE.md` names the branch rule;
  default `feature/NNN-slug`). `git rev-parse --show-toplevel` must be that checkout: an `Agent` with
  `isolation: "worktree"` branches from the **current session's HEAD**, so a session opened in another checkout hands
  its builders the wrong code, and a session opened outside any repository gives them no worktree at all.
- **Builders see HEAD only.** Uncommitted changes and untracked files (often `specs/` itself) are invisible inside a
  builder's worktree. The brief therefore names the spec by its absolute path in this checkout. A task whose `after:`
  edge points at a patch applied earlier in this run needs that patch in HEAD: commit it first where the repository's
  `CLAUDE.md` allows commits; otherwise run that task without worktree isolation in this checkout, serially, and say so
  in the round report.
- **The actor.** Locks and step lines carry an actor in the grammar `FORMAT.md` defines: the parent is
  `a:<kind>:<id>` (for example `a:claude:spec-NNN`; lower case, letters, digits, `-` and `_`), each builder is
  `<parent actor>/T<k>`. Strings such as `spec-NNN-ISC-7` are not actors; the reader flags them as legacy.
- **The CLI path for builders.** Resolve `${CLAUDE_PLUGIN_ROOT}/bin/spec-check` to its absolute path once and put
  `bun "<that path>"` into every brief, so a builder needs no plugin variable of its own.
- **Width.** The user's only optional input: default wide for `feature`, `refactor` and `project`; serial for `bug`,
  `spike` and `infra`.

## Step 3: plan the round

```bash
spec-check frontier specs/NNN-slug --json > <scratch>/round-N.frontier.json
```

`frontier` returns the takeable claims and tasks and, for the rest, what holds them: an open edge, an open seam, a lock
another session holds. Without `tasks.md` the claim is the unit of work. From the takeable tasks the parent builds the
round plan and saves it as `<scratch>/round-N.plan.json`:

```json
{ "dispatch": [{ "id": "T4", "claim": "ISC-7", "lane": "core", "text": "…", "path": "core/src/x.ts", "after": ["T2"] }],
  "held": [{ "id": "T5", "reason": "same file as T4" }],
  "exhausted": false }
```

- Two takeable tasks whose path column names the same file are not co-dispatchable, whatever their edges say: hold the
  later one.
- Cap `dispatch` at the width. `exhausted: true` when nothing is takeable while claims remain open.

## Step 4: the lock protocol

*(safety gate — these are not style preferences)*

1. **Locks live in the repository root's `.spectant/activity.jsonl`**, written only by `spec-check claim` and
   `spec-check release`, never by hand. Every checkout and worktree of the repository shares that one file.
2. **The parent claims before dispatching:** `spec-check claim ISC-N --session <parent actor>`. A lost race then costs
   one CLI call instead of a builder's whole run. A refused claim while the frontier said takeable means another session
   holds it or the spec's edges are stale against the master: stop and reconcile, never override.
3. **The parent is the only writer of `spec.md`, `tasks.md` and the master.** Builders change code and return one of the
   two shapes below.
4. **Release on close and on failure:** `spec-check release ISC-N --session <parent actor>`. Exit 4 means the lock was
   lost: write nothing more for that claim and report it. A lock held by a dead session is cleared only on the user's
   word, never by this workflow on its own.

## Step 5: the dispatch brief

*(output format — every builder gets this shape, nothing less)*

```
spectant: spec=<NNN> task=T<k> claim=ISC-N
SPEC:      <absolute path>/specs/NNN-slug/spec.md   (read it; you are closing one claim of it)
GOAL:      "<the spec's goal, byte for byte>"
CLAIM:     ISC-N — <claim text verbatim>
PROBE:     <the Test Strategy row for ISC-N, verbatim: type | check | threshold | tool>
TASK:      T<k> · <lane> — <task text> · <path column>
LANE:      <lane> — load: <files from specs/constitution.md § Lanes> — lane probe: <command>
SEAM:      <the contract from plan.md this task builds against, or "none">
STEPS:     after EVERY run of your probe, before anything else:
             bun "<cli>" activity probe --result <red if exit≠0, else green> --task T<k> --claim ISC-N
                 --session <parent actor>/T<k>
           before you return kind=question:
             bun "<cli>" activity question --text "<the question, one line>" --task T<k> --claim ISC-N
                 --session <parent actor>/T<k>
ISOLATION: you run in your own git worktree; never commit, never switch branches, never touch files outside your
           path column unless the probe forces it, and then list them in files touched.
RETURN:    result | question — the shapes under "What a builder returns". A question only when a wrong choice
           changes the claim set, the seam, or makes the probe unmeetable; everything else is a mark.
DONE:      the probe named above ran red before your change and green after, in your worktree.
```

The first line is the marker, exactly this shape and always first, before `SPEC:`: the plugin's hooks read it from
the Agent tool's prompt to write the task's `claim`, `dispatch`, `build` and `release` lines, and a brief without it
is no task to them. `<NNN>` is the spec's three-digit number, `T<k>` and `ISC-N` the task and claim of this brief.

`STEPS` is how Spectant sees what a builder does inside its run: the builder writes `probe` and `question` itself, from
inside its worktree, and the CLI puts the line into the repository root's `.spectant/activity.jsonl`. The parent never
writes these two for it. Without a `## Lanes` block the builder gets the nearest `CLAUDE.md` above its path column.

## What a builder returns

*(output format)*

A builder ends in exactly one of two shapes. Anything else is a failed dispatch and closes nothing.

```
result:   {kind: "result", claim, task, lane, probe command, exit code, one-line stub, files touched, marks: [⟨?: …⟩ …]}
question: {kind: "question", claim, task, lane, question, options: [A, B, C], recommended: A, why, state: files so far}
```

`marks` carries every place the builder chose without asking (`⟨?: assumption — why unsure⟩`); the user reads them at
review. `state` on a question is what the next builder on the same task inherits; the parent leaves those files in place
and names them in the redispatch.

**What earns a question, what earns a mark.** A builder asks only when a wrong choice would produce a structurally
different build: a different claim set, a different contract at a seam, a probe that cannot be met as written. A choice
between two implementations that both close the probe is a mark. A builder that asks what the repository can answer has
not read its lane's context, and the redispatch says so instead of relaying the question. A builder that can neither
decide nor phrase options returns a `result` with a red probe and the reason.

## Step 6: run the round

For each dispatched task, in this order: `spec-check claim ISC-N --session <parent actor>`, then
`spec-check activity dispatch --task T<k> --claim ISC-N --session <parent actor>`, then the build on one of two paths:

- **Agent tool** (default): one `Agent(isolation: "worktree", …)` per dispatched task, run in the background, the brief
  above as its prompt. Write `spec-check activity build --task T<k> --claim ISC-N --session <parent actor>` as each
  starts. The loop is the parent's.
- **Workflow** (only when the user asks for it in this run, "run the workflow"): `Workflow({scriptPath:
  "${CLAUDE_PLUGIN_ROOT}/skills/spec/scripts/implement.workflow.js", args: {plan, brief, builder, ts}})`. The script
  pipelines each task through a worktree-isolated builder with schema-enforced returns and gives back
  `{dispatched, results, questions, failed, verdicts}`; it closes nothing and is resumable by its run ID. It has no
  filesystem, so the parent fills `brief` with text: `spec` (absolute path), `goal` verbatim, `cli` (the resolved
  `bun "<path>"`), `actor` (the parent actor), `lanes` (lane → profile text from the constitution), `seams` (task →
  contract from `plan.md`). Start the Workflow from this checkout, for the same HEAD reason as in Step 2. The parent
  writes `build` per task when the workflow starts.

**Isolation: one worktree per task.** What comes back is a patch, not a branch:

```bash
git -C <worktree> log --oneline <base>..HEAD               # a commit here: discard the worktree, redispatch the task
git -C <worktree> add -A && git -C <worktree> diff --cached --binary > <scratch>/T<k>.patch
git apply --check <scratch>/T<k>.patch                     # from this checkout's root; refuses on conflict
git apply <scratch>/T<k>.patch                             # into this checkout, still uncommitted
git worktree remove --force <worktree>                     # after the patch landed; its branch goes with it
```

Staging inside the builder's worktree is only how new files get into the patch; nothing is committed there. Check the
patch's `--stat` against `files touched` and leave out what the builder only set up for itself (a linked dependency
folder is the usual one). Write `spec-check activity patch …` after the patch was pulled and `spec-check activity apply
…` after it landed, both with `--task T<k> --claim ISC-N --session <parent actor> --worktree <path>`. `--check` red
means this checkout moved under the task: that is not a merge to resolve by hand; redispatch the task on the current
tree with the same brief and its own `state`. `git apply` resolves paths from the root; run it there or pass
`--directory`.

**The activity check.** After the patches are applied, check the log for every dispatched task. A task whose probe ran
red before its change carries `dispatch`, `build`, `probe red`, `probe green`, `patch`, `apply` in that order:

```bash
log="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.spectant/activity.jsonl"
grep '"task":"T<k>"' "$log" | grep -oE '"event":"[a-z-]+"|"result":"[a-z]+"'
```

Name every gap (a missing `probe red` is the usual one) in the round report and on the round line. A gap closes nothing
and blocks nothing; it is a builder that ignored `STEPS`.

**A second look** is off by default; a claim closes on its probe. Only when the user asks for one in this run, a fresh,
read-only reviewer agent (one that did not build the patch, ideally another model) reads each patch of a `feature`,
`refactor`, `infra` or `project` claim before the write order, with the spec and the goal verbatim, refute-first, and
returns `{verdict: pass|concerns|fail, findings: [{severity, isc_ref, issue, evidence}]}`. `pass` → the write order
continues; `concerns` → each finding is adopted (redispatch), rebutted (a Decisions row) or deferred (a `- fog:` line),
and the claim closes only with no `critical` open; `fail` → the claim stays open, the task is redispatched with the
findings. The reviewer never edits the patch and never writes the order.

## Step 7: the question round

*(a builder has no window to the user; only the parent can ask)*

Questions are collected, not relayed one by one. A builder's `question` is not a stopping condition: the round goes on
and ends when every dispatched builder has returned. The parent then asks each collected question with one
`AskUserQuestion` per question, the builder's `recommended` option first and marked as recommended, never a bare open
ask. "Proceed" as the whole answer accepts every recommendation except one the builder marked as a seam change; that one
is asked again on its own.

Every answer lands in `specs/NNN-slug/context.md` under `## Round N — during build`, with `From:` naming task, claim
and lane. An answer that changes the build lands in `plan.md`; one that changes a claim goes master first (Step 9). The
builder is then redispatched with the same brief, the answer verbatim and its own `state`. A question the user cannot
answer now becomes a `- fog:` line in the spec, and the claim goes back to the frontier unlocked.

## Step 8: what closes a claim, and the write order

The probe the claim names in `spec.md` § Test Strategy, run at the boundary the row names, meeting the row's threshold,
producing a **one-line** provenance stub: a test name, a command with its exit code, a commit hash, a probe ref.

- **Runnable types** (`bun-test`, `bun-property`, `bash`, `curl`, `SELECT`, …): the probe was observed failing before
  the build and passing after (red before green). A probe that was never red closes nothing.
- **`type: manual` never closes on the model's own assessment.** The evidence is the user's words in this session,
  quoted verbatim: `spec-check verify NNN ISC-N manual "confirmed by the user: \"<their words>\""`.
- **A claim with no Test Strategy row cannot close.** The row goes into the master first, then into the spec.

*(the invariant: evidence exists before the checkmark does)* Per closed claim, one at a time, never batched at the end:

```
1. run the probe in this checkout, capture the one-line stub              (nothing written)
2. spec-check verify NNN ISC-N <type> "<stub>"   # Verification line in spec.md, then the master; ticks the claim
                                                 # after its evidence; recounts progress in both
3. tasks.md ← every task of ISC-N → [x]; updated:
4. spec-check release ISC-N --session <parent actor>
```

`<type>` is the second column of the claim's Test Strategy row. `verify` refuses multi-line evidence and an ID the
master does not hold (exit 3, nothing written: run `spec-check drift`). Structural checks run at every stop and after a
closed claim that had outbound edges, not after every claim: `spec-check drift NNN` exits 0 and `spec-check status NNN`
shows no error diagnostic.

## Step 9: record the round

After the write order and the lock release, on both paths, the last step of every round:

```bash
spec-check rounds record specs/NNN-slug --plan <scratch>/round-N.plan.json [--result <return.json>] \
    [--outcome T<k>=result|question|failed|pass|concerns|fail|skipped]… [--builder T<k>=<agent>]… \
    [--mode agent|workflow] [--stop "<reason>"]
```

It appends one line to `specs/NNN-slug/rounds.jsonl`, which Spectant shows. Three rules: after the write order, never
before (recorded earlier, a claim that closed this round is logged as open); the plan passed is the one the round was
dispatched from, not a fresh one; the stopping condition goes on the last line via `--stop`, verbatim. The log derives,
it never decides: no gate reads it. Then plan the next round (Step 3).

## How failure is recorded

| What happened | Where it goes |
|---|---|
| Probe red, the **code** is wrong | fix and run again; that is work, not a record |
| Probe red, the **claim** is wrong (threshold unreachable, wrong boundary, two claims in one) | master first: the changed claims through `spec-check mint`, never renumbered, a dropped one tombstoned; `spec-check decide ISA.md "refined: …"`, then the same row into the spec |
| A dead end | `spec-check decide <spec> "DEAD END: tried X, failed because Y (don't retry)"` |
| Understanding changed | a Decisions row with all four parts: conjectured, refuted by, learned, criterion now; an incomplete one is a plain decision |
| A question that cannot yet be a claim | a `- fog:` line in `## Not yet specified`, empty before the spec closes |
| A task turned out unnecessary | strike it in `tasks.md` with the reason; tasks are not claims |
| A conformance gate went red and this spec's work caused it | fix it; never add it to `## Conformance baseline` |

## Stopping conditions

Report the reason; never guess past it. Each one goes on the last round line via `--stop`.

- **Every claim closed** → `spec-check transition NNN <next stage>` (`code-review` where `specs/workflow.md` reviews
  this spec's code, else the close stage; exit 3 means the transition was refused and nothing was written: report it).
  Report the spec as ready for the optional `/spec review NNN code`, then `/spec done NNN`. This workflow never sets
  `phase: complete`.
- **Frontier empty with claims remaining** (`exhausted: true`) → report the blocking set and which actors hold locks.
  Do not invent work.
- **A decision only the user can make** (a `manual` probe, an infra rollback question, a claim that needs rewording) →
  ask, one `AskUserQuestion`.
- **The same claim's probe fails twice the same way** → stop. That is the signal the claim is wrong, not the code.
- **Budget exhausted** → the partial state is already durable, because every close wrote through. Report it truthfully.
- **The constitution's gate tier is red at the last stop and the cause is not in the baseline** → stop and report.

## What this workflow does not do

*(safety gate)*

- **No commits or pushes** unless the repository's `CLAUDE.md` allows them; then only on the spec's feature branch,
  never on the default branch, never force-pushed. Otherwise never `git add` in this checkout, `commit`, `push` or
  `checkout -b`; report the branch name the repository's rule gives.
- **Never mint a claim ID by hand.** Work without a claim stops the run: either the claim is minted in the master first,
  or the work is out of scope.
- **Never hand-edit the master.** Claims, Verification and Decisions lines go through the CLI.
- **Never write an acceptance criterion into `plan.md` or `tasks.md`.**
- **Never check a claim whose probe it did not run.**
- **Never release a lock it does not own.**
- **Never weaken a gate to make a claim close.**

## Gotchas

- A builder cannot reach the user with `AskUserQuestion`; one that tries idles until it fails. Questions travel as the
  `question` shape and are asked by the parent, in a round.
- Relaying a question the moment it arrives, while other builders still run, interrupts the user once per builder.
  Collect first; a returned builder holds no lock the others need.
- `isolation: "worktree"` branches from the session's HEAD. Dispatching from the default branch while the spec's work
  lives on its feature branch gives every builder stale code; check `git rev-parse --abbrev-ref HEAD` before the first
  dispatch.
- A lock cannot say whether its builder is out or its question waits on the user. A claim still locked after a
  `question` keeps that state until a round line records the redispatch.
