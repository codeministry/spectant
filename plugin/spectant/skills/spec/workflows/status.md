# The bare `/spec`: help, status, drift, sync

`/spec` with no argument answers three questions on one screen: what can I run, where do the specs stand, and did
anything drift. `/spec sync <NNN>` is its write arm: it reconciles one spec with the master `ISA.md`.

`spec-check …` below is the plugin CLI, invoked as `SKILL.md` names it. Exit codes: 0 ok, 1 bad arguments, 3 drift or
gate open, 4 lock lost.

## Run lines

Help, status and drift are read-only and write no run lines, no event and no file. Sync writes: it starts with
`spec-check run start <NNN> --session <actor> --command "/spec sync <NNN>"` and ends with `spec-check run end <run-id> --outcome ok`, or
`--outcome error` on any stop.

## 1 · Help

Print the output header from `SKILL.md`, then this block as it stands. It follows a spec's life.

| When | Command | Does |
|---|---|---|
| Set up (once) | `/spec init` | set a repository up for specs: constitution, master, first spec |
| Start | `/spec idea <sentences>` | shape a rough idea: shapes to choose from, a short question round, a filled template, the spec on your yes |
| | `/spec new <type> [notes]` | a new spec from a template: `bug`, `spike`, `refactor`, `feature`, `infra`, `project` |
| Shape | `/spec plan <NNN>` | write `plan.md`; a UI spec gets its design pass here |
| | `/spec tasks <NNN>` | write `tasks.md`: atomic steps, one claim each |
| | `/spec review [NNN]` | a summary in the chat, the reviewed mark on your yes, the code review as its later step |
| Build | `/spec implement <NNN>` | work the tasks until the claims close on their probes |
| Close | `/spec done <NNN> [archive]` | check every close condition, set `phase: complete`; `archive` moves it to `specs/archive/` |
| Keep track | `/spec` | this help, the status of every spec, the drift audit |
| | `/spec sync <NNN>` | reconcile one spec with the master `ISA.md` |

## 2 · Status

```bash
spec-check status          # every spec: number, title, type, stage, progress, open and takeable claims
```

Show the result as one table, one row per spec, archived specs last or left out. Two findings are not drift but are
worth a line under the table: a Test Strategy row without `anchors_to`, which blocks `phase: complete` once the
master's stated goal is set, and a `- [ ]` line without a claim ID, which no frontier and no progress count can see.

A repository without `specs/` has nothing to show: say so and point at `/spec init`, nothing else.

## 3 · Drift

```bash
spec-check drift           # every spec against the master; exit 0 clean, 3 drift
```

Exit 0: one line, "no drift". Exit 3: name each drifting spec with its class and the fix:

- **state mismatch, spec ahead** (a claim closed in the spec, open in the master): `/spec sync <NNN>`.
- **state mismatch, master ahead**: the spec is a stale view; `/spec sync <NNN>` re-projects it from the master, which
  is always right about state.
- **unknown to the master** (an ID only the spec carries): it was minted in the wrong place; `/spec sync <NNN>` mints
  it in the master under the same ID, never renumbered.
- **progress mismatch** (a declared `progress:` that is not the count): `/spec sync <NNN>` recounts it.

Close with one question (`AskUserQuestion`, recommended option first) only when drift was found: sync the first
drifting spec now, or leave it. Nothing is written without that yes.

## 4 · Sync — `/spec sync <NNN>`

The closed work in a spec lands back in the master: checkmarks, Verification lines, decisions. The master stays the
single source of truth; the spec folder stays where it is. In a repository without a master `ISA.md` the spec is the
master and there is nothing to sync: say so and stop.

`/spec implement` already writes each close through to the master per claim, so after a clean run sync finds nothing
to do. It stays the repair path when a run died mid-close or a spec was edited by hand. Every step is idempotent:
running it twice changes nothing the second time.

**Step 1: audit.** `spec-check drift <NNN>`. Exit 0 → report "nothing to reconcile", end the run with `ok`.

**Step 2: unknown IDs first.** An ID only the spec carries is minted into the master before anything else, keeping its
ID: `spec-check mint <NNN> …` with the claim and its Test Strategy row. The master is always written first.

**Step 3: closes.** For each claim closed on one side and open on the other, write the close through with its
evidence: `spec-check verify <NNN> <ISC-N> <type> "<one-line stub>"`, the stub taken from the side that holds the Verification
line. The command writes the Verification line into the master and the spec before the checkmark and recounts
`progress:` in both. A claim ticked without any Verification line is not ticked through: name it and leave it to
`/spec implement <NNN>`.

**Step 4: decisions.** A Decisions row the spec holds and the master lacks goes over with
`spec-check decide ISA.md "<the row as written>"`.

**Step 5: verify.** `spec-check drift <NNN>` exits 0, and `spec-check frontier <NNN>` shows what became takeable: the
useful answer to "what now".

*(safety gate)* The master `ISA.md` is never hand-edited: every change to it goes through `spec-check mint`, `verify`
or `decide`. When the CLI cannot express a change, stop and report it; do not edit the file to make the drift go away.

**Step 6: report.** Name what moved into the master and what is still open. Nothing is committed unless the target
repository's `CLAUDE.md` allows agents to commit and the user says yes in this session.

## Done

The user knows what they can run, what exists, how far each spec got and what a red line costs; after a sync, master
and spec agree and the drift audit comes back empty.
