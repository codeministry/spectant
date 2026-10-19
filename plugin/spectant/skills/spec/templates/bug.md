<!-- Type template: bug. Two parts. `## Prompt` is the fill-in prompt `/spec new bug` and `/spec idea` show in one
     fenced block: example values, a comment under every field. `## spec.md` is the skeleton of the spec the answers
     land in, with the sections `spec-check allocate` plans for this type; its placeholders are listed in README.md.
     Artifacts: spec.md only; the diff is the how, so no plan.md and no tasks.md. Question budget: at most two, and
     only when the reproduction is unclear; the goal question on top. -->

## Prompt

````markdown
/spec new bug
<!-- Without notes this prompt is shown as is, example values included. With notes, every field the notes answer is
     filled from them and every other example value becomes `…`. Keep the comments; send it back filled to start
     the spec. -->

## Type
bug

## Repo
quill
Slug suggestion: digest-drops-sunday
<!-- The current repository's name. The slug is short, kebab-case and English; the branch follows the repository's
     own rule. -->

## Goal (one sentence)
The digest holds every note of the week, Sunday's included.
<!-- Your own sentence, copied verbatim: it becomes the spec's stated goal. The intended state, not "fix the bug". -->

## Reproduction
1. Put one note dated each day from Monday to Sunday into the notes folder
2. Run the digest on the following Monday
- Expected: seven notes in the digest
- Actual: six; Sunday's note is missing
- Environment: every platform, since the switch to UTC dates
<!-- Steps someone without context can follow. Environment and "since when" help narrow it down. Becomes
     `## Problem`. -->

## Which promise broke
F1 · Weekly digest
<!-- The master's feature block the regression claim attaches to. A bug opens no feature block of its own; when
     unclear, F0 · Cross-cutting. -->

## Must never happen again
- A note dated inside the week never misses the digest → proof: a test over a fixture week with a note on each day
<!-- The regression as a state, plus its proof: which test would catch it? It becomes at least one `Anti:` claim,
     minted in the master first. "I don't know" is an allowed answer. -->

## Suspected cause (optional)
The week's end is compared with `<` against midnight instead of the end of Sunday.
<!-- May be wrong. Leave it out when there is no idea. -->

## Open points
Whether notes written after midnight on Sunday count for that week.
<!-- What is still unclear. A bug spec has no fog section: each point becomes a ⟨?: … — why unsure⟩ mark in the
     draft, asked within the question budget when it changes the fix, never an invented claim. -->
````

## spec.md

````markdown
---
task: "{{task}}"
slug: {{spec}}
spec_type: bug
isa_master: ../../ISA.md
isa_feature: {{feature}}
stage: plan
phase: scoping
progress: 0/0
started: {{now}}
updated: {{now}}
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature {{feature}}). Claim IDs belong to the master: minted there first,
     then projected here. Never edit the master from this file. -->

# {{number}} — {{task}}

## Problem

{{problem}}

## Goal

{{goal}}

## Claims

<!-- At least one `Anti:` regression claim from "Must never happen again", minted with `spec-check mint` into the
     feature block whose promise broke (or F0) first, and only then projected here. -->

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|

## Decisions

## Verification
````
