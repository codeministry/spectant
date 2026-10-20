# new — allocate and write a spec of one type

`/spec new <type> [notes]` · `/spec new NNN`

Writes a numbered spec folder `specs/NNN-slug/` whose `spec.md` holds only claim IDs the master `ISA.md` already knows,
scaled to the type of work. The type comes first and decides everything downstream; the six types and their templates
are in `${CLAUDE_PLUGIN_ROOT}/skills/spec/templates/`, and `templates/README.md` holds the question budget and the
required sections per type. With a number instead of a type, it mints the claims of an existing spec that has none,
into that spec's own folder (§ An existing spec without claims, below).

## Done looks like this

- `specs/NNN-slug/` exists with `spec.md`, `context.md` and `events.jsonl`, allocated by `spec-check allocate`; for
  `/spec new NNN`, the same folder as before, and no other folder was created.
- Every claim in `spec.md` was minted into the master first with `spec-check mint`, and each has its Test Strategy row.
- `spec.md` holds the type's required sections filled in the repository's prose language, with no placeholder left.
- `context.md` holds the confirmed goal, the user's own sentence verbatim and `## Round 1 — before the spec`; for
  `/spec new NNN`, a new round appended after the earlier ones, which stay as they were.
- `spec-check drift NNN` exits 0, and the reply says so.
- No `plan.md` or `tasks.md` was written, and nothing was committed.

## The run rule

`spec-check` below is the plugin's CLI, run as `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"` (see `SKILL.md`); exit 0
ok, 1 bad arguments, 3 drift or gate open, 4 lock lost. Before anything else, open the run. Until `allocate` has given
a number the subject is the working slug:

```bash
spec-check run start <working-slug> --session <actor> --command "/spec new <type> <args>" --json
```

Keep the run ID and close it on every way out, also when the turn ends on an open question; the next turn opens a new
run, with `NNN` as the subject once the folder exists:

```bash
spec-check run end <run-id> --outcome ok      # written, shown the prompt, or stopped by the user
spec-check run end <run-id> --outcome error   # anything that broke the flow
```

A non-zero exit from `spec-check` is never worked around: end the run with `error`, report the exit code and its
message. Every reply starts with the output header `SKILL.md` defines: `📐 Spec · new: …` until the folder exists,
`📐 Spec NNN · new: …` from then on.

## An existing spec without claims — `/spec new NNN`

When the first argument is a three-digit number or an existing `NNN-slug`, the spec exists and only its claims are
missing, as for a story allocated through the app. The run's subject is `NNN` from the start, and its command is
`/spec new NNN`. Resolve `specs/NNN-*/` and read `spec-check status NNN --json`:

- **No such folder:** say so in one line, write nothing, end the run `ok`.
- **The spec has claims** (the total in `progress` is above 0): say in one line that it has them and name the `next`
  command `status` gives; write nothing, end the run `ok`.
- **No claims** (`progress` `0/0`, `next` `/spec new NNN`, reason `no claims yet`): the workflow runs from step 1 with
  these differences, and `allocate` is never called.
  - **Type:** the spec's `spec_type:`; no type question (step 2).
  - **Prompt:** none is shown (step 3). The stated goal and every field come from the spec's `## Goal` and its other
    sections, and from `context.md`; a field neither answers is a gap for step 5.
  - **Goal and gap questions:** step 4 and step 5 as usual, against the type's budget.
  - **Mint:** step 7 runs `mint NNN` into exactly this folder, master first. The block is the spec's `isa_feature:`;
    for a bug or a spike it exists, and for the other types `--feature-name` and `--why` are passed only when the
    master lacks that block.
  - **Prose, log, check:** steps 8 to 10. Step 8 fills what is still empty and keeps the prose already there unless
    an answer changes it; the confirmed goal replaces `## Goal` when it differs. Step 9 appends the next round
    (`## Round <n> — claims for the existing spec, <ISO-8601>`, with the stated and the confirmed goal) after the
    earlier ones and never rewrites them. `spec-check drift NNN` exits 0.

## 1 — Read the ground

What the repository answers is never a question. Read:

- the repository root and its `CLAUDE.md` (prose language, branch prefix, commit rule);
- `specs/constitution.md`: `## What a spec may contain`, `## Non-negotiables`, `design_track`;
- the master `ISA.md`: its feature blocks (`### F<n> · <name>`), `## Not yet specified`, `## Remaining Work`;
- the specs and stories that exist: `spec-check status --json`, and `specs/ideas/` when it exists.

Then:

- **No `specs/constitution.md`:** the repository is not set up. Say so, point at `/spec init`, end the run `ok`.
- **No master `ISA.md`:** the repository keeps its claims in the specs. Say so once; `mint` then writes into the spec
  only, and the master half of every step below does not apply.
- **An overlap** with an existing spec, story or Remaining Work entry is said first, in one sentence naming it, before
  anything is allocated.

## 2 — The type

`bug` · `spike` · `refactor` · `feature` · `infra` · `project`. Take it from the first argument; for `/spec new NNN`,
from the spec's `spec_type:`. Missing or not one of the six: one `AskUserQuestion` with the six types, the one the
notes suggest first and marked `(Recommended)`.

| Type | Writes now | Offered next |
|------|------------|--------------|
| `bug` | `spec.md` | `/spec review NNN`, then `/spec implement NNN` |
| `spike` | `spec.md` | `/spec review NNN`, then `/spec implement NNN` |
| `refactor` | `spec.md` | `/spec tasks NNN` |
| `feature` | `spec.md` | `/spec plan NNN`, then `/spec tasks NNN` |
| `infra` | `spec.md` | `/spec plan NNN` |
| `project` | `spec.md` | `/spec plan NNN`, then `/spec tasks NNN` |

**Coming from `/spec idea`:** the arguments carry a filled prompt and a `## Shaping record`. The type is settled, no
question the record answered is asked again, and the record lands as Round 0 in `context.md` (step 7). The goal
question in step 4 still comes.

## 3 — The prompt

Read `templates/<type>.md`. Its `## Prompt` block is the fill-in prompt, its `## spec.md` block the skeleton of the
spec.

- **No notes:** show the `## Prompt` block as is, example values included, in one fenced `markdown` block, say that
  sending it back filled starts the spec, and end the run `ok`. Nothing is written.
- **Notes, or the prompt sent back:** fill every field the notes answer; every other example value becomes `…`, so an
  example never passes for the user's input. A field left `…` is a gap: a question in step 5 when it changes the
  claims, else a `⟨?: … — why unsure⟩` mark in the draft.
- **The stated goal** is the prompt's `## Goal (one sentence)` field, or, when the notes left it empty, the user's own
  first sentence. It is kept **verbatim**, byte for byte, and never paraphrased: it is what every `anchors_to` traces
  back to.
- **The slug** is the prompt's slug suggestion, else derived from the goal: short, kebab-case, English.
- **The mode** is the prompt's `## Mode` field. `proceed` accepts your reasoned defaults for the gap questions and the
  marks; the goal question, and for `infra` the rollback question, are asked under `proceed` as well.

Halt here only for what blocks allocation: the type and the slug. Everything else is step 4 and 5.

## 4 — The goal question

Exactly one, for every type, outside the budget, and `proceed` does not skip it. One `AskUserQuestion`: your sharpened
reading of the stated goal as a single sentence an observer could check, marked `(Recommended)`, with two or three
genuinely different readings beside it (narrower scope, wider scope, a different outcome). The confirmed sentence
becomes `## Goal`; the stated goal stays the user's own words and goes to `context.md`.

For a **spike** this question is replaced by the one the spike exists for: which decision should it make possible
(asked as "X or Y for Z?"). It is the spike's whole budget.

## 5 — The gap questions

Answer this against yourself first: *what do I need that the repository cannot tell me?* A gap a search of the
repository closes is not a question. Ask only what would produce a structurally different set of claims, a different
seam or an unmeetable probe; everything else is a `⟨?: assumption — why unsure⟩` mark in the draft.

- **One question per `AskUserQuestion`, never batched**, your own answer first and marked `(Recommended)`, real
  alternatives beside it, never a bare open question.
- **The budget** is the type's row in `templates/README.md`, and it covers this step and the mark questions of step 8
  together: a question spent here is gone there. Zero questions is a valid outcome; record it as one.
- **infra:** the rollback question (how back, how long, what is lost) is always asked, on top of the budget and under
  `proceed` too. Its answer is the `Rollback:` line under `## Constraints`.
- **project:** no budget in advance. A full interview over Problem, Vision, Out, Principles, Constraints and Done
  looks like runs before anything is minted, one question at a time, until a wrong answer would no longer change the
  claim set.
- **A departure from the constitution** — anything that goes against a `binding` row — is marked inline as
  `⟨?: deviates from <rule> — why⟩`; its resolution belongs in `plan.md` § Stack Decisions, never silently in prose.

Keep each question as you ask it, in the form step 7 records it.

## 6 — Allocate

Skipped for `/spec new NNN`: the folder exists, and `allocate` would refuse its slug with exit 1.

```bash
spec-check allocate <type> <slug> --goal "<the confirmed goal>" --title "<title>" --feature F<n> --json
```

- `allocate` picks the number (local folders, the archive and branch names), creates `specs/NNN-slug/` with `spec.md`
  (the type's frontmatter and sections, stage `plan`), `context.md` (with `## Goal — confirmed <ts>`) and
  `events.jsonl` (its first line). Only `allocate` picks a number; never create the folder by hand.
- `--title` is the spec's one-line title (it becomes `task:`). `--feature` is the master's feature block that will own
  the claims:
  - **refactor, feature, infra, project:** a new block, `F<n+1>` after the highest `### F<n>` in the master;
  - **bug:** the block whose promise broke; **spike:** the block whose question it answers; either falls back to
    `F0 · Cross-cutting`. Neither opens a block of its own.
- Exit 1 (a folder for the slug exists, a bad type) stops the workflow. Nothing was minted yet, so a different slug
  costs nothing.

## 7 — Mint the claims, master first

The order is not reversible: the master mints the IDs, the spec never does. A spec that names an ID first holds an ID
the master has never seen, and `drift` reports it as unknown to the master.

Turn each line of the prompt's "Done looks like" into one claim: a state an observer can check, never an activity,
with the proof becoming its Test Strategy row. A bug carries at least one `Anti:` regression claim (the broken
behaviour that must not come back); a spike carries exactly one claim, usually `Antecedent: <the decision> is made and
recorded as a decision.`; an infra spec has at least one claim with a deterministic probe.

Write the claims as a JSON array to a temporary file outside the repository (for example from `mktemp`):

```json
[
  {
    "text": "A week with notes yields one digest of at most forty lines.",
    "row": { "type": "bun-test", "check": "digest: fixture week", "threshold": "<= 40 lines",
             "tool": "`bun test digest`", "anchorsTo": "derived: one-screen-digest", "severity": "high" }
  },
  {
    "text": "Anti: a note dated outside the week appears in the digest.",
    "after": ["ISC-12"],
    "row": { "type": "bun-test", "check": "digest: eight days back", "threshold": "0 hits",
             "tool": "`bun test digest`", "anchorsTo": "derived: one-screen-digest" }
  }
]
```

- `text` is the claim; `Anti:` or `Antecedent:` at its start sets the kind. No ID: `mint` hands out the next free one.
- `after` (optional) lists claim IDs that must close first; only IDs that already exist can be named.
- `row` becomes the Test Strategy row, positional `isc | type | check | threshold | tool | anchors_to | severity`:
  `type` is the kind of probe as the repository names it, `threshold` may be an empty string, `tool` is the command
  that exists in this repository, `anchorsTo` is `derived: <handle>` naming the part of the stated goal the claim
  serves, `severity` is optional. A claim no command can prove gets an honest `manual` or `review` row with an empty
  `tool`, never a plausible command nobody runs.

```bash
spec-check mint NNN --feature F<n> --feature-name "<name>" --why "<one line: why this feature exists>" --claims <file> --json
```

`--feature-name` and `--why` open the new block in the master; leave both out for a bug or a spike, whose block exists,
and for `/spec new NNN` when the master already holds the spec's `isa_feature:` block.
`mint` writes the claims into the master's block and its Test Strategy table first, recounts `progress:`, then projects
the same IDs into `spec.md`. Delete the temporary file afterwards. Claims, rows and progress are never written by hand.

## 8 — Draft the prose

Fill the sections of `spec.md` that `allocate` left empty, from the prompt and the answers, in the prose language the
constitution names (English when it names none); the fill rules per placeholder are in `templates/README.md`. Prose is
written directly; the frontmatter, `## Claims`, `## Test Strategy` and `## Verification` stay as the CLI wrote them.

- **Problem**, **Vision**, **Out of Scope**, **Principles** (project only), **Constraints** — as the type's skeleton
  has them; a bug's Problem is the reproduction: steps, expected, actual, environment.
- **Open points** become `- fog:` lines under `## Not yet specified` for a spike, a feature or a project, and
  `⟨?: … — why unsure⟩` marks in the draft of a bug, a refactor or an infra spec, which have no such section. Never an
  invented claim.
- Every guess is marked inline as `⟨?: … — why unsure⟩`. In the default mode, ask about the marks whose wrong
  resolution changes the build structurally, within what is left of the budget, and resolve them; under `proceed`
  take your reasoned default and leave the mark.
- A feature, infra or project spec carries at least one `mermaid` diagram in `spec.md` (the user's path in
  `## Vision`, a lifecycle in `## Constraints`), picked by what the spec does; a refactor gets one when the held
  behaviour has a flow worth seeing; a bug and a spike get none.

## 9 — The context log

`allocate` wrote the goal lock. Under `## Goal — confirmed <ts>` add the stated goal:

```markdown
Stated, verbatim: "<the user's own sentence, unchanged>"
```

Then append the rounds and set `rounds:` and `updated:` in the frontmatter:

```markdown
## Round 0 — shaping the idea, <ISO-8601>        # only when coming from /spec idea: its shaping record

## Round 1 — before the spec, <ISO-8601>

### Q1 · <the question as asked>
- Offered: <A (recommended)> | <B> | <C>
- Chosen: <the answer, or the user's own wording>
- Landed in: ISC-12, ISC-13                      # or a section, or "nowhere — implementation detail"
```

With no question asked, Round 1 says so in one line: `- No questions — the repository answered the rest.` Note the
mode when it was `proceed`.

## 10 — Check

```bash
spec-check drift NNN
```

Exit 0 is the pass condition: every claim in the spec is known to the master, and the master's block holds none the
spec lacks. Report the exit code in the reply. Exit 3 means the order of step 7 broke; fix it with `spec-check` before
anything else is offered. `spec-check status NNN` then shows the stage, the progress and the claim partition.

## 11 — Offer what comes next

Name what the type still owes (step 2's table) and the branch name the repository's own rule gives. For a feature or a
project in a repository whose constitution says `design_track: app` or `marketing`, mention that `/spec plan NNN`
includes the design pass. Do not write `plan.md` or `tasks.md` unasked, and do not commit: committing follows the
repository's `CLAUDE.md`, and without a rule there nothing is committed or pushed.

## What this workflow does not do

- **No number by hand.** Only `spec-check allocate` picks it; a number is an address, not an identity.
- **No claim in the spec before the master.** `spec-check mint` writes both, in that order.
- **No skipped goal question**, not under `proceed`, not when coming from `/spec idea`.
- **No `plan.md`, no `tasks.md`, no `.html`, no commit.**

## Report

The number and folder (for `/spec new NNN`: the existing one, nothing allocated), the type, the feature block, the
minted IDs, the questions asked against the budget, the marks and fog lines left open, `spec-check drift NNN` and its
exit code, and the next command offered.
