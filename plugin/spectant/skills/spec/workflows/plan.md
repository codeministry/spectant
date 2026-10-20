# plan — write plan.md for a spec

`/spec plan NNN`

Writes `specs/NNN-slug/plan.md`: how the claims get built, the decisions the spec deliberately left open, and no
acceptance criterion. For a spec with a user interface, an optional design pass first writes
`specs/NNN-slug/design.md`, which then binds the plan.

## When to run

First, before the type: a spec without claims (the total in `progress` from `spec-check status NNN --json` is 0) is
refused with one line naming `/spec new NNN`, which mints its claims in its own folder, and nothing is written; every
row of the plan's file table needs a claim ID. The run still opens and ends `ok`, as for every refusal by design.

For the types `feature`, `infra` and `project`, after `spec.md` exists. Never for `bug` or `spike`: there the diff and
the question are the how, and a plan would be ceremony. A spec of another type, a spec with `phase: complete`, or a
spec that already has a `plan.md` the user did not ask to rewrite is refused with a one-line reason, and nothing is
written.

## The run rule

`spec-check` below is the plugin's CLI, run through `bun` from the plugin root as `SKILL.md` shows; exit 0 ok, 1 bad
arguments, 3 drift or gate open, 4 lock lost. Before anything else, open the run:

```bash
spec-check run start NNN --session <actor> --command "/spec plan NNN" --json
```

Keep the returned run ID. Close the run on every way out of this workflow, a refusal included:

```bash
spec-check run end <run-id> --outcome ok      # plan.md written and the stage moved, or a refusal by design
spec-check run end <run-id> --outcome error   # anything that broke the flow
```

A non-zero exit from `spec-check` is never worked around: end the run with `error` and report the exit code and its
message. Start every reply with the output header `SKILL.md` defines, naming the spec number and `plan`.

## 1 — Read the spec and what binds it

What the repository answers is read, not asked.

- `spec-check status NNN --json` for the type, the stage and the claims.
- `specs/NNN-slug/spec.md` for the claims, the constraints, the Test Strategy and the fog (`## Not yet specified`).
- The repository itself for what is actually there. A plan naming files that do not exist is the most common way this
  artifact goes wrong.
- `specs/constitution.md`, twice over: `## Non-negotiables` for what binds, and `## Conformance baseline` for what is
  already broken. A plan that steps on a grandfathered rule is the cheap moment to clear it, and
  `## Conformance Impact` is where that is said. The constitution also names the prose language; English when it
  names none.
- `specs/NNN-slug/design.md`, when it exists. Its target decisions per viewport and its cross-viewport section bind the
  plan's approach and affected files the same way the spec's constraints do; a plan that departs from them says so in
  `## Approach`.

## 2 — Optional: the design pass for a UI spec

Offered only when all of these hold: the spec changes a user interface, `design.md` does not exist yet, the
constitution's `design_track` is `app` or `marketing` (never `none`, never absent), and the type is `feature` or
`project`. One `AskUserQuestion`, outside the approach budget below: **design pass first (Recommended)** or **plan
without one**. A declined pass changes nothing else; `design.md` is optional.

**Viewports.** The `viewports:` key of `specs/constitution.md`, else Mobile 390, Tablet 820, Desktop 1440.

**Depth by type.** `feature`: current and target state in every viewport. `project`: the same, plus design language
and token direction in the cross-viewport section. (`bug` and `refactor` specs have no plan; a bug's pass would cover
only the affected viewports, a refactor's only the current state as its regression reference.)

**Dispatch.** One design pass per viewport, run in parallel through the Agent tool: a design-specialised subagent type
when the session lists one, else `general-purpose`. Each brief names the spec folder (the agent reads `spec.md`
itself), the repository, the `design_track`, the viewport and its width, the depth, and the repository's own design
standard when the constitution's binding sources name one. Each agent:

- works its own viewport only and **writes nothing**;
- describes the current state from what it can see: the code, and a running instance only when the user names a URL
  and the session has a browser tool. It takes no screenshots and stores no image. A viewport with nothing to look at
  gets the greenfield line verbatim, `No current state — greenfield.`, never an invented history;
- returns exactly `{viewport, width, current, target, crossViewport}`: `current` and `target` as Markdown for the two
  subsections, `crossViewport` one string per concern spanning viewports (a navigation pattern, a breakpoint).

**Merge.** Only the parent writes `specs/NNN-slug/design.md`:

```markdown
---
spec: NNN-slug
type: <copied from spec.md>
design_track: <app | marketing>
viewports: [390, 820, 1440]
updated: <ISO-8601>
---

<!-- DESIGN PASS — holds no acceptance criterion. A target that must be checkable is a claim in spec.md. -->

# Design NNN — <title>

## Mobile (390)
### Current
### Target

## Tablet (820)
…

## Desktop (1440)
…

## Across viewports
```

Headings follow the spec's prose language. Two cross-viewport entries describing the same concern the same way become
one line. A genuine conflict, one viewport's target contradicting another's, is asked of the user, one conflict per
`AskUserQuestion`, never picked silently. A viewport whose agent returned nothing is re-dispatched once or reported as
a gap; a section is never invented for it. No prototype and no `.html` file: the pass plans the surface in Markdown
only.

## 3 — Lock the approach

Before the first line of the plan, answer this against yourself: *what do I need from the user to build this well, and
how would the instruction have to read for me to hit it first time?*

**The approach question: always exactly one.** First option, marked `(Recommended)`: your sharpened restatement of the
instruction plus the intended procedure in two to four steps. Beside it one or two procedures that are genuinely
different: another order, another depth, another verification strategy. Rephrasings of the same path are not
alternatives.

**At most two more, only for what changes the plan structurally:** a departure from a `binding` row of the
constitution, a migration or rollback whose shape is not obvious, or a review point the user wants before the work
continues. One question per `AskUserQuestion` call, the recommended option first.

The confirmed procedure becomes `## Approach`. A confirmed departure becomes a `## Stack Decisions` row. What stays
open becomes `- fog:` in the spec's `## Not yet specified` first and an `## Open Points` entry here second.

## 4 — Write it

Write `specs/NNN-slug/plan.md` in the spec's prose language, to this contract:

```markdown
---
spec: NNN-slug
type: <feature | infra | project>
status: draft            # draft | approved | superseded
updated: <date>
---

# Plan NNN — <title>

**Purpose:** how the claims in `spec.md` get built. The what lives there; this file holds no acceptance criterion.
```

| Section | Required | Holds |
|---|---|---|
| `## Approach` | always | one paragraph: the chosen path in a sentence, then why this one and not the obvious one |
| `## Stack Decisions` | when the plan departs from a `binding` row of the constitution, or adopts anything the standards mark `open gap` or `deliberate-absence` | table: rule ID / chosen / alternatives / why, with the failure mode avoided and the probe that stays green |
| `## Affected Files and Modules` | always | table: path / change / claim ID |
| `## Data Model` | only when types, a schema or a persisted shape change | before → after |
| `## Interfaces` | only when a contract changes | API, event, CLI or component contract before → after, plus who calls it |
| `## Migration and Rollback` | `infra`, and every schema or persistence change | expand–contract named explicitly; the rollback as a concrete command plus what running it costs |
| `## Risks` | always | table: risk / blast radius / early warning / mitigation |
| `## Open Points` | when the spec has fog | mirrors `## Not yet specified`; each entry names the fog line it should resolve |
| `## Conformance Impact` | when the work touches a rule in the constitution's `## Conformance baseline` | one line per touched entry: clear it, extend it, or leave it |

Sections are omitted, never filled empty.

**At least one mermaid diagram**, usually in `## Approach`, picked by what the plan does, not by habit:

| Kind | Mermaid | Draw it when | Belongs in |
|---|---|---|---|
| flow | `flowchart` | the build order has steps, branches or a loop | `## Approach` |
| components | `flowchart` with `subgraph` | modules, services or files that call each other are added or rewired | `## Approach` or `## Interfaces` |
| interaction | `sequenceDiagram` | two or more actors exchange calls in an order that matters | `## Interfaces` or `## Approach` |
| lifecycle | `stateDiagram-v2` | a thing moves through states | `## Approach` |
| data | `erDiagram` | types, a schema or a persisted shape change | `## Data Model` |

One idea per diagram, labels in the spec's language, and a diagram only as mermaid text, never as an image file.

Two things separate a plan that helps from one that restates the spec:

- **The approach paragraph says why this path and not the obvious one.** If the chosen path *is* the obvious one, say
  so in a sentence and move on.
- **Every row in the affected-files table carries the claim ID it serves.** A file that serves no claim is either
  unclaimed work, which belongs back in the spec, or it does not belong in this change. A row implementing a viewport
  decision from `design.md` names the viewport.

**A `## Stack Decisions` row needs all three:** the rule ID; the failure mode the rule exists to prevent, and how this
departure avoids it; and a probe that stays green (the same probe, a named replacement, or an explicit "`unenforced`
from here, and this is the price"). The probe column references a row in the spec's Test Strategy or a tier in the
constitution's `## Gates`; it never defines one. A row missing any of the three is not written; ask instead.

## 5 — Hold the line against claims

The one constraint that keeps this file legal: no acceptance criterion, no probe definition, no threshold. Those live
in `spec.md` § Test Strategy. A sentence that describes how you know something is done is moved out of the plan.

- A genuinely new open question goes into the spec's `## Not yet specified` first and is mirrored in `## Open Points`
  second. `## Open Points` never creates fog of its own.
- A departure that needs a probe that does not exist yet is a claim. Mint it with `spec-check mint NNN …`, which writes
  the master `ISA.md` first and the spec second; never write it into the plan.
- A decision the user made in this round that the spec should carry goes in as a Decisions row through
  `spec-check decide specs/NNN-slug/spec.md "<line>"`.

## 6 — Record the round

Append the round to `specs/NNN-slug/context.md`, after every round already there; an earlier round is never
overwritten. Raise `rounds:` by one and set `updated:` in its frontmatter.

```markdown
## Round <n> — before the plan, <ISO-8601>

### Q1 · <the approach question as asked>
- Offered: <A, recommended> | <B> | <C>
- Chosen: <what came back, or the user's own wording under Other>
- Landed in: plan.md § Approach
```

Every question of this workflow is one `### Q` block: the design-pass offer, a design conflict, the approach question
and the structural questions, each with where its answer landed (`design.md § Across viewports`, `plan.md § Stack
Decisions`, a fog line, a claim ID, or `nowhere — implementation detail`).

## 7 — Move the stage

With `plan.md` written, move the spec to the next stage of its type's workflow, by default `tasks` for `feature` and
`project`, `review` for `infra` (a row of `specs/workflow.md` may order them differently):

```bash
spec-check transition NNN <next stage>
```

It appends exactly one line to `specs/NNN-slug/events.jsonl`. A move the workflow does not allow is refused with a
non-zero exit; report it, never force it. Then close the run with `ok`.

## What this workflow does not do

- **No acceptance criterion** in `plan.md` or `design.md`.
- **No code.** The plan says how; `/spec implement` builds it.
- **No claim written outside the master-first path.** Claims come only through `spec-check mint`.
- **No `.html`, no screenshots, no images.**
- **No commit.** Committing follows the target repository's `CLAUDE.md`; without a rule there, nothing is committed or
  pushed.

Files this workflow writes: `specs/NNN-slug/plan.md`, `specs/NNN-slug/design.md` (only with the design pass),
`specs/NNN-slug/context.md` (the appended round), the spec's `## Not yet specified` (a new fog line), and through
`spec-check` the master, the spec's Decisions, `events.jsonl` and the run lines.

## Report

`plan.md` exists, every affected file traces to a claim, nothing in it defines done, and the stage it moved to. Name
`/spec tasks NNN` (or `/spec review NNN` for `infra`) as the next step, and the Spectant app as the place to read the
plan beside the spec.
