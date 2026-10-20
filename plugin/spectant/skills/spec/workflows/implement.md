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
name, else ask), then `spec-check run start specs/NNN-slug --session <actor> --command "/spec implement NNN"` and keep the run ID. Every
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
3. **On the user's explicit yes** → `spec-check gate reviewed specs/NNN-slug --yes --actor <actor>`, the actor that
   opened the run (its `--session`). It writes `specs/NNN-slug/.gates/reviewed.json` and appends exactly one
   `review → build` line to the spec's `events.jsonl`. This run does not lock its own mark; a run of another session
   running on the spec does: exit 3 naming that run, nothing written; say so, end the run, stop. Run
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
- **The actor.** Every line carries an actor in the grammar `FORMAT.md` defines. The parent's own lines (`patch`,
  `apply`) carry `a:<kind>:<id>` (for example `a:claude:spec-NNN`; lower case, letters, digits, `-` and `_`), each
  builder's `<parent actor>/T<k>`, or `<parent actor>/C<k>` for a claim unit of a spec without `tasks.md` (Step 3).
  The lock and launch lines the plugin's hooks write carry the session's own actor,
  `a:claude:<first 8 characters of the session id>`. Strings such as `spec-NNN-ISC-7` are not actors; the reader flags
  them as legacy.
- **The CLI path for builders.** Resolve `${CLAUDE_PLUGIN_ROOT}/bin/spec-check` to its absolute path once and put
  `bun "<that path>"` into every brief, so a builder needs no plugin variable of its own.
- **Width.** The user's only optional input: default wide for `feature`, `refactor` and `project`; serial for `bug`,
  `spike` and `infra`.

## Step 3: plan the round

```bash
spec-check frontier specs/NNN-slug --json > <scratch>/round-N.frontier.json
```

`frontier` returns the takeable claims and tasks and, for the rest, what holds them: an open edge, an open seam, a lock
another session holds. Without `tasks.md` the claim is the unit of work: `frontier` names those units `C1`, `C2`, …
in the order of the open claims, and a `C<k>` stands wherever this workflow names a task id `T<k>` (the round plan,
the brief, the actor and every activity line). From the takeable tasks the parent builds the round plan and saves it
as `<scratch>/round-N.plan.json`:

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

1. **Locks live in the repository root's `.spectant/activity.jsonl`, and the plugin's hooks write them** from the
   marker line of each brief (Step 5): `claim` when the `Agent` call starts, `release` when the claim's last builder of
   this session stops. Every checkout and worktree of the repository shares that one file; nobody writes it by hand.
2. **The parent takes no lock itself.** It runs neither the `claim` nor the `release` command for a claim it
   dispatches. The hooks write under the session's own actor, so a lock the parent held under its actor would make the
   hook see the claim held by another session and write nothing for the task: no `claim`, `dispatch`, `build` or
   `release`. The race check is `frontier` right before the round (Step 3): a claim another session holds is not
   takeable. A dispatched task without its `claim` and `dispatch` lines in the activity check lost that race or its
   marker line: stop and reconcile, never override.
3. **The parent is the only writer of `spec.md`, `tasks.md` and the master.** Builders change code and return one of the
   two shapes below.
4. **Release comes with the last builder's stop**, on a result, a question or a failure alike; a redispatch claims
   again. The claim is unlocked from that stop on, so the write order (Step 8) follows the patches without delay. A lock
   held by a dead session is cleared only on the user's word, never by this workflow on its own.

## Step 5: the dispatch brief

*(output format — every builder gets this shape, nothing less)*

```
spectant: spec=<NNN> task=T<k>|C<k> claim=ISC-N
PACK:      <the one JSON line of `spec-check pack specs/NNN-slug T<k> --json`, verbatim>
SPEC:      <absolute path>/specs/NNN-slug/spec.md   (fallback only: read it to answer a question the pack cannot)
TASK:      T<k>|C<k> · <lane> — <task text> · <path column>
LANE:      <lane> — load: <files from specs/constitution.md § Lanes> — lane probe: <command>
SEAM:      <the contract from plan.md this task builds against, or "none">
STEPS:     after EVERY run of your probe, before anything else:
             bun "<cli>" activity probe --result <red if exit≠0, else green> --task T<k>|C<k> --claim ISC-N
                 --session <parent actor>/T<k>|C<k>
           before you return kind=question:
             bun "<cli>" activity question --text "<the question, one line>" --task T<k>|C<k> --claim ISC-N
                 --session <parent actor>/T<k>|C<k>
ISOLATION: you run in your own git worktree; never commit, never switch branches, never touch files outside your
           path column unless the probe forces it, and then list them in files touched.
RETURN:    result | question — the shapes under "What a builder returns". A question only when a wrong choice
           changes the claim set, the seam, or makes the probe unmeetable; everything else is a mark.
DONE:      the probe in the pack ran red before your change and green after, in your worktree.
```

The parent runs `spec-check pack specs/NNN-slug T<k> --json` once per dispatched task, right before the dispatch, and
puts its one output line on `PACK:` verbatim: the goal byte for byte, the task with its paths, the claim text, its Test
Strategy row (the probe), the lane with its context files and lane probe, and the relevant decisions, under the pack's
fixed size cap. The builder works from the pack and opens `spec.md` only for a question the pack cannot answer; a pack
whose `truncated` is above 0 dropped that many of the oldest decisions, never the goal, task, claim, probe or lane. A
pack that fails (an error object instead of the pack) is no brief: fix the cause or hold the task, never dispatch with
the old instruction to read the whole spec. `SEAM:` stays the parent's: it fills it from `plan.md`, as the pack carries
no contract. A claim unit `C<k>` of a spec without `tasks.md` has no task line to pack: its brief keeps the claim lines
instead of `PACK:` (`GOAL:` byte for byte, `CLAIM:` with the claim text verbatim, `PROBE:` with its Test Strategy row).

The first line is the marker, exactly this shape and always first, before `PACK:`: the plugin's hooks read it from
the Agent tool's prompt to write the task's `claim`, `dispatch`, `build` and `release` lines, and a brief without it
is no task to them. `<NNN>` is the spec's three-digit number, `ISC-N` the claim of this brief, and its task either
`T<k>` from `tasks.md` or, for a spec without `tasks.md`, the claim unit `C<k>` that `frontier` named (Step 3): write
the one that applies wherever the template says `T<k>|C<k>`. The parent writes none of these four lines itself.

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

Each dispatched task is built on one of two paths, and the parent writes nothing before it: when the `Agent` call
starts, the hooks write the claim's `claim` (unless this session holds it already) and the task's `dispatch`; when the
builder is launched, its `build`.

- **Agent tool** (default): one `Agent(isolation: "worktree", …)` per dispatched task, run in the background, the brief
  above as its prompt. The loop is the parent's.
- **Workflow** (only when the user asks for it in this run, "run the workflow"): `Workflow({scriptPath:
  "${CLAUDE_PLUGIN_ROOT}/skills/spec/scripts/implement.workflow.js", args: {plan, brief, builder, ts}})`. The script
  pipelines each task through a worktree-isolated builder with schema-enforced returns and gives back
  `{dispatched, results, questions, failed, verdicts}`; it closes nothing and is resumable by its run ID. It has no
  filesystem, so the parent fills `brief` with text: `spec` (absolute path), `goal` verbatim, `cli` (the resolved
  `bun "<path>"`), `actor` (the parent actor), `lanes` (lane → profile text from the constitution), `seams` (task →
  contract from `plan.md`), `packs` (task → the one line of `spec-check pack`, Step 5). A task with a pack gets the
  `PACK:` line of Step 5; one without gets the spec path to read instead. The script opens every builder's prompt with
  the same marker line, the spec number taken from the folder in `brief.spec`, so the hooks write the same lines on
  this path, with or without a pack. Start the Workflow from this
  checkout, for the same HEAD reason as in Step 2.

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
folder is the usual one). The task's two last run events are the parent's, written through the activity tool with the
task's claim, `patch` after the patch was pulled and `apply` after it landed:

```bash
spec-check activity patch --task T<k> --claim ISC-N --session <parent actor> --worktree <path>   # after the pull
spec-check activity apply --task T<k> --claim ISC-N --session <parent actor> --worktree <path>   # after git apply
```

`--check` red means this checkout moved under the task: that is not a merge to resolve by hand; redispatch the task on
the current tree with the same brief and its own `state`. `git apply` resolves paths from the root; run it there or
pass `--directory`.

**The activity check.** After the patches are applied, check the log for every dispatched task. A task whose probe ran
red before its change carries `dispatch` and `build` from the hooks, `probe red` and `probe green` from its builder,
`patch` and `apply` from the parent, in that order; the claim's `claim` comes before them, and its `release`, written
when the claim's last builder stopped, may come before the `patch`:

```bash
log="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.spectant/activity.jsonl"
grep '"task":"T<k>"' "$log" | grep -oE '"event":"[a-z-]+"|"result":"[a-z]+"'
```

Name every gap in the round report and on the round line. A gap closes nothing and blocks nothing. A missing `probe red`
is the usual one: a builder that ignored `STEPS`. A missing `dispatch` or `build` means the hooks did not see the brief:
the plugin's hooks are off in this session, the brief lost its marker line, or another session held the claim.

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
3. spec-check tick NNN T<k>                      # once per task of ISC-N: one tasks.md line each, nothing else
```

The claim's lock is no step here: the hooks released it when its last builder stopped.

`<type>` is the second column of the claim's Test Strategy row. `verify` refuses multi-line evidence and an ID the
master does not hold (exit 3, nothing written: run `spec-check drift`). Structural checks run at every stop and after a
closed claim that had outbound edges, not after every claim: `spec-check drift NNN` exits 0 and `spec-check status NNN`
shows no error diagnostic.

## Step 9: record the round

After the write order, on both paths, the last step of every round:

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
- **Never write a `claim`, `release`, `dispatch` or `build` line itself.** The hooks write them; a lock the parent took
  would silence them for the task.
- **Never weaken a gate to make a claim close.**

## Gotchas

- A builder cannot reach the user with `AskUserQuestion`; one that tries idles until it fails. Questions travel as the
  `question` shape and are asked by the parent, in a round.
- Relaying a question the moment it arrives, while other builders still run, interrupts the user once per builder.
  Collect first; a returned builder holds no lock the others need.
- `isolation: "worktree"` branches from the session's HEAD. Dispatching from the default branch while the spec's work
  lives on its feature branch gives every builder stale code; check `git rev-parse --abbrev-ref HEAD` before the first
  dispatch.
- A claim stays locked only while one of its builders runs: the hooks release it when the last one stops, also after a
  `question`. A question waiting on the user therefore holds no lock; the redispatch claims the claim again.
