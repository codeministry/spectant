# Templates

The skeletons `/spec init` fills: `master.md` becomes the project master `ISA.md` at the repository root, and
`constitution.md` becomes `specs/constitution.md`. Beside them stand the six type templates `/spec new <type>` and
`/spec idea` use: `bug.md`, `spike.md`, `refactor.md`, `feature.md`, `infra.md` and `project.md`. All are English
skeletons. Structure stays English in every repository (headings, frontmatter keys, IDs, `Anti:` and `fog:`, Test
Strategy columns), because the parsers read it; the prose that replaces a placeholder or an example value follows the
language the repository names in its own `CLAUDE.md` or constitution.

A placeholder is a name in double curly braces and is replaced as a whole. Every placeholder is filled; none survives into a written file.

## `master.md`

| Placeholder | Filled with |
|-------------|-------------|
| `{{task}}` | one line: what the project does, as a sentence; a `"` is written `\"` |
| `{{stated_goal}}` | the user's own framing sentence, verbatim, never paraphrased; a `"` is written `\"` |
| `{{slug}}` | `YYYYMMDD-<project>`, the day the master is created |
| `{{project}}` | the repository's name, kebab-case |
| `{{title}}` | the project's display name |
| `{{now}}` | the current time, ISO 8601 UTC (`2026-03-04T08:00:00Z`) |
| `{{today}}` | the current date, `YYYY-MM-DD` |
| `{{problem}}` | who hurts today and how, in a short paragraph |
| `{{vision}}` | what the finished thing looks like to its user |
| `{{out_of_scope}}` | the first thing the project deliberately does not do; add one bullet per further item |
| `{{principle}}` | the first substrate-independent truth; add one bullet per further principle |
| `{{constraint}}` | the first immovable mandate (stack, platform, policy); add one bullet per further constraint |
| `{{goal}}` | one sentence an observer could check |
| `{{cross_cutting_why}}` | the `Why:` of `F0`: what would sink the project whichever feature slipped |

The master starts with `progress: 0/0`, no claim, an empty Test Strategy table (header only) and one feature block
`F0 · Cross-cutting`. Claims are minted here first, with `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check" mint …`, and only
then derived into a spec. Further feature blocks are `### F<n> · <name>` with a `Why:` line directly below. The Test
Strategy columns are positional: `isc | type | check | threshold | tool | anchors_to | severity`, in that order.
Fog lines under `## Not yet specified` are `- fog: <open question>`. An optional `## Milestones` section takes
`- <name> · <YYYY-MM-DD> · <description>` bullets.

## `constitution.md`

The constitution is derived from what already governs the repository and points at those sources instead of restating
them. In a greenfield repository the master's Principles and Constraints are the only source, and the file is small.

| Placeholder | Filled with |
|-------------|-------------|
| `{{repo}}` | the repository's name |
| `{{now}}` | the derivation time, ISO 8601 UTC |
| `{{today}}` | the derivation and measurement date, `YYYY-MM-DD` |
| `{{standards_version}}` | the version of the house standards the repository names, or `none` |
| `{{design_track}}` | `app`, `marketing` or `none`, from evidence in the repository, confirmed by the user |
| `{{stack}}` | `[<backend>, <frontend>]` as the build files show it |
| `{{prose_language}}` | the language the repository writes its specs in; English when it names none |
| `{{sources_note}}` | one sentence on the sources read; when the repository names no house standards, say so here |
| `{{claude_md_governs}}` | what the repository's `CLAUDE.md` files govern, in a few words |
| `{{rule}}` | a rule ID plus a handle of a few words, never the rule's text; one row per exception or repo-specific probe |
| `{{rule_source}}` | where the rule lives (`repo \`CLAUDE.md\``, a docs path, a decision record) |
| `{{rule_probe}}` | a command or spec file that exists in this repository, or empty |
| `{{static_command}}` | the cheapest tier: lint and type check |
| `{{quick_command}}` | the tier run at every implementation stop |
| `{{full_command}}` | the tier run before a feature or milestone completes |
| `{{lane}}` | a lane name; keep lanes coarse, three for a typical web app |
| `{{lane_paths}}` | the path prefixes of the lane, as code spans |
| `{{lane_context}}` | the `CLAUDE.md` a worker in the lane loads |
| `{{lane_probe}}` | the quick tier scoped to the lane |

Rules for filling it:

- A gate tier the repository cannot run is written `— (not defined; see Conformance baseline)` and becomes a dated
  baseline row. A command that does not exist is never declared.
- The baseline is measured once with the repository's own commands, unmodified; nothing in the repository changes to
  improve it. A rule no gate can speak to is `not measured`, never passing.
- `## Adaptations`, `## Conformance baseline` and `## Lanes` are dropped when they stay empty.
- House standards are optional: add a `house` row to `## Binding sources` only when the repository names such a
  standards tree, and only then use the verdicts `adapted`, `deferred` (with a named trigger that ends it), `waived`
  (with a decision record) and `grandfathered` (baseline only) beside `binding`.
- Optional frontmatter keys: `viewports: [390, 820, 1440]` for an `app` or `marketing` track,
  `dev_services: <port>=<label>, …`, `shared_files: [<path or glob>, …]`.

## The six type templates

Each type template has two parts, each in its own fenced block:

- `## Prompt` is the fill-in prompt. Its first line is `/spec new <type>`, so the filled prompt, sent back, starts the
  spec. Every field carries an example value and a `<!-- … -->` comment saying what belongs there. Without notes the
  prompt is shown as is; with notes, every field the notes answer is filled from them and every other example value
  becomes `…`, so an example never passes for the user's input. `## Goal (one sentence)` takes the user's own
  sentence verbatim; `## Repo` takes the current repository's name and a slug suggestion; `## Open points` takes what
  is still unclear. The prompt holds no placeholder.
- `## spec.md` is the skeleton of the spec the answers land in. Its frontmatter keys and its sections are exactly the
  ones `spec-check allocate` plans for the type, in the same order; the comments under `## Claims` say which prompt
  field the claims come from. Claims are never written into the skeleton: they are minted into the master first with
  `spec-check mint` and only then projected into the spec.

| Template | Artifacts | Question budget | Required sections in `spec.md` |
|----------|-----------|-----------------|--------------------------------|
| `bug.md` | `spec.md` | at most two, only when the reproduction is unclear | Goal, Claims (at least one `Anti:` regression claim), Test Strategy |
| `spike.md` | `spec.md` | exactly one, in place of the goal question: which decision should the spike make possible | Problem, Goal, Not yet specified, Claims (exactly one) |
| `refactor.md` | `spec.md`, `tasks.md` | at most three | Problem, Out of Scope, Goal, Claims, Test Strategy |
| `feature.md` | `spec.md`, `plan.md`, `tasks.md` | at most three | Problem, Vision, Out of Scope, Constraints, Goal, Claims, Test Strategy |
| `infra.md` | `spec.md`, `plan.md` | at most three, plus the rollback question, which `proceed` never skips | Problem, Constraints (with the `Rollback:` line), Goal, Claims (at least one deterministic probe), Test Strategy |
| `project.md` | all four | none in advance: a full interview | Problem, Vision, Out of Scope, Principles, Constraints, Goal, Claims, Test Strategy |

The goal question is asked for every type, outside the budget. Bug and spike open no feature block of their own: their
claim attaches to the master's block whose promise broke or whose question it answers, or to `F0 · Cross-cutting`.
Open points become `- fog:` lines in the types with `## Not yet specified` (spike, feature, project) and
`⟨?: … — why unsure⟩` marks in the draft of the others.

The skeleton's placeholders:

| Placeholder | Filled with |
|-------------|-------------|
| `{{task}}` | one line: what the spec is for; it is also the title; a `"` is written `\"` |
| `{{number}}` | the spec number `allocate` gave, three digits (`001`) |
| `{{spec}}` | the folder name `NNN-slug`, identical to the directory |
| `{{feature}}` | the master's feature block that owns the claims (`F3`); the `isa_feature:` line and the `(feature …)` note are left out when there is none |
| `{{now}}` | the creation time, ISO 8601 UTC |
| `{{problem}}` | the prompt's problem field; for a bug, the reproduction: steps, expected, actual, environment |
| `{{vision}}` | the prompt's vision field |
| `{{out_of_scope}}` | the first item of the prompt's "Out"; add one bullet per further item |
| `{{principle}}` | the first guard rail that holds whatever the stack (project only); one bullet each |
| `{{constraint}}` | the first guard rail; add one bullet per further one |
| `{{rollback}}` | the prompt's rollback answer: how back, how long, what is lost (infra only) |
| `{{goal}}` | the confirmed goal: one sentence an observer could check |
| `{{fog}}` | the first open point; one `- fog:` line each, and the section stays empty without any |
