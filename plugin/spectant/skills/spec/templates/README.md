# Templates

The skeletons `/spec init` fills: `master.md` becomes the project master `ISA.md` at the repository root, and
`constitution.md` becomes `specs/constitution.md`. Both are English skeletons. Structure stays English in every
repository (headings, frontmatter keys, IDs, `Anti:` and `fog:`, Test Strategy columns), because the parsers read it;
the prose that replaces a placeholder follows the language the repository names in its own `CLAUDE.md` or
constitution.

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
