# idea — shape a rough idea into a spec

`/spec idea <one or two sentences>`

Turns one or two sentences into an idea with a chosen shape and a filled prompt template the user has confirmed. On
the user's yes the template goes on to `/spec new`, or, when the user wants to keep it for later, it is written as a
story under `specs/ideas/<slug>.md`.

## Done looks like this

The user has seen three genuinely different shapes of the idea, chosen one, answered at most five single questions
about it, and confirmed a fully filled template of the right type. Then exactly one of three things happened:

- **start** — `/spec new <type> <slug>` runs with the template and the shaping record, and the record lands as Round 0
  of the new spec's `context.md`;
- **keep as story** — `specs/ideas/<slug>.md` holds the template with its frontmatter and the shaping record, and
  `specs/ideas/README.md` names it;
- **stop** — the idea stays in the conversation only.

**Until that yes nothing is written** to the repository's specs: no folder, no number, no master entry, no story file.
The only lines written before it are the run lines below.

## The run rule

`spec-check` below is the plugin's CLI, run through `bun` from the plugin root as `SKILL.md` shows; exit 0 ok, 1 bad
arguments, 3 drift or gate open, 4 lock lost. Before anything else, open the run; the idea's working slug is its
subject:

```bash
spec-check run start <working-slug> --session <actor> --command "/spec idea <the sentences>" --json
```

Keep the returned run ID. Close the run on every way out of this workflow, the hand-off included:

```bash
spec-check run end <run-id> --outcome ok      # start, keep as story, or stop
spec-check run end <run-id> --outcome error   # anything that broke the flow
```

A user's "stop" is `ok`: the workflow ended as designed. A non-zero exit from `spec-check` is never worked around; end
the run with `error` and report the exit code and its message.

Start every reply with the output header `SKILL.md` defines, naming `idea` and the working title; once `/spec new` has
allocated the folder, the number joins the header.

## 1 — Read the ground, do not ask it

What the repository answers is never a question. Before offering anything, read:

- the repository root, its `CLAUDE.md`, the master `ISA.md` (feature blocks, `## Remaining Work`) and
  `specs/constitution.md` (`## Non-negotiables`, the prose language, `design_track`);
- the specs and stories that exist: `spec-check status --json`, then `spec-check status NNN` for any spec that looks
  close, and the files under `specs/ideas/`.

An idea that overlaps an existing spec, a story or a Remaining Work entry is said first, in one sentence naming it,
and one of the three shapes is "take it into spec NNN" (or "reopen NNN", or "extend the story <slug>"). A repository
without `specs/` is told that `/spec init` comes before a spec can be created; the shaping still runs, and the
outcome **keep as story** is not offered.

## 2 — Three shapes

Three shapes that differ in what they deliver, not three sizes of the same thing. Usually:

- **narrow** — the smallest cut that is already useful on its own;
- **the obvious reading** — what the sentences most plainly ask for;
- **different outcome** — another answer to the same underlying problem, or the wider version when that is the
  interesting alternative.

One `AskUserQuestion`, one option per shape, the recommended one first and marked `(Recommended)`. Each option
carries a `preview` in the same shape:

```
Problem   <one sentence: who hurts, how>
Vision    <two sentences from the user's side>
In        <two or three bullets>
Out       <one or two bullets>
Type      feature · ~<small | medium | large>
```

"Other" lets the user mix shapes; take their wording as the chosen shape.

## 3 — The shaping round

On the chosen shape: at most five questions, **one per `AskUserQuestion` call, never batched**. Each question offers
your own answer first, marked `(Recommended)`, with real alternatives beside it; never a bare open question. Ask only
what would change the claims structurally and what the repository cannot tell:

- who has the pain, and when it shows;
- what "done" looks like, observably, and what would prove it;
- what is explicitly not part of it;
- guard rails, and any departure from the constitution;
- what the repository does not know (a customer wish, a device, a data volume, a decision only the user holds).

Zero questions is a valid outcome. The budget is a ceiling, not a target. Note every question as you go, in the form
the shaping record needs (step 7).

## 4 — The type

`bug` · `spike` · `refactor` · `feature` · `infra` · `project`, derived from the shape and the answers. Ask only when
two types fit equally well; that question counts against the five.

- `bug` and `spike` stay light: no plan, and a spike asks one question in place of a goal.
- In a fresh repository the master `ISA.md` is the project-level artifact and the first spec is a `feature`;
  `project` is for a sub-project inside an existing repository.

## 5 — The filled template

Read `${CLAUDE_PLUGIN_ROOT}/skills/spec/templates/<type>.md`. Its `## Prompt` block is the template this workflow
fills; its `## spec.md` block is the skeleton `/spec new` writes later and is not shown here. Fill **every** field of
the prompt from the shape and the answers, replacing each example value; a field nothing answers gets `…`, never the
example. Keep every `<!-- … -->` comment and the first line `/spec new <type>`. Fixed rules:

- `## Goal (one sentence)` holds the user's original sentences **verbatim**, byte for byte. They become the spec's
  stated goal; the shaped, sharper sentence belongs in `## Vision` (feature, project) or at the head of `## Problem`
  (the other types), and later in the spec's `## Goal`.
- A spike's `## The decision this spike makes possible` takes the chosen shape's question, as "X or Y for Z?".
- `## Repo` is the name of the current repository, from its root folder or its remote.
- The slug is kebab-case and English.
- The prose language is the target repository's, as its `specs/constitution.md` or `CLAUDE.md` names it; English when
  neither names one.
- What stayed unclear goes into the prompt's `## Open points`, never into an invented field value. It becomes a
  `- fog:` line in a spike, feature or project spec and a `⟨?: … — why unsure⟩` mark in the draft of the other
  types; never a claim.

## 6 — Show, then ask

Show the filled prompt in one fenced `markdown` block, with one line above it naming the chosen shape. Then one
`AskUserQuestion`:

- **Start the spec with `/spec new` (Recommended)**
- **Keep it as a story** — written to `specs/ideas/<slug>.md` for later (only when `specs/` exists)
- **Change a field** — ask which field and how, show the template again, ask again
- **Stop** — end here; nothing is kept

## 7 — The shaping record

Both written outcomes carry the same record, after the template:

```markdown
## Shaping record

- Shapes offered: <narrow> | <obvious, recommended> | <different>; chosen: <which, or the user's own mix>
- Q1 · <the question as asked> — Offered: <A (recommended)> | <B> | <C> — Chosen: <the answer> — Field: <the template field it filled>
- …
```

With no question asked, the record says so in one line: `- No questions — the repository answered the rest.`

## 8a — Start: hand-off to `/spec new`

Continue with `workflows/new.md` as `/spec new <type> <slug>`, passing the filled template and the shaping record.
`new` takes it from its first step with the type already settled: it allocates the folder through
`spec-check allocate <type> <slug>`, writes the record as `## Round 0 — shaping the idea, <ISO-8601>` in the new
`specs/NNN-slug/context.md`, keeps its own goal question (never skipped), and does not ask again what the record
already answered. Close this run with `ok` before `new` opens its own.

## 8b — Keep as story

Write `specs/ideas/<slug>.md`: a frontmatter block, then the filled template, then the shaping record.

```markdown
---
type: <the type>
feature: <F<n>, the master feature block it belongs to; left out when none>
milestone: <a name from the master's ## Milestones; left out when none>
priority: <P1 | P2 | P3 | P4; P3 when the user named none>
status: idea
---
<the filled template>

## Shaping record
…
```

Then add the story to `specs/ideas/README.md`, the index: one row in the table of its feature block, with the columns
Story | Milestone | Priority | Spec, the Spec cell `—`. Create the index with that table when it is missing. Ask for
the feature block only when the master has more than one that fits; that question counts against the five.

A story has no number and no claims, and writing it moves no stage: it stands in the stage `idea` until
`/spec new <slug>` allocates it, and its shaping record then becomes Round 0 of the new spec's `context.md`.

## What this workflow does not do

- **No folder, number, story file or master entry before the yes**, and none at all on "stop".
- **No claims.** `/spec new` mints them, in the master first.
- **No skipped goal question.** The shaping round sharpens the idea; the goal question in `new` confirms the sentence
  the claims will trace to.
- **No commit.** Committing follows the target repository's `CLAUDE.md`; without a rule there, nothing is committed or
  pushed.

## Report

The chosen shape, the type, the number of questions asked, and the outcome: `/spec new` started, the story path, or
stopped.
