<!-- Type template: spike. Two parts. `## Prompt` is the fill-in prompt `/spec new spike` and `/spec idea` show in one
     fenced block: example values, a comment under every field. `## spec.md` is the skeleton of the spec the answers
     land in, with the sections `spec-check allocate` plans for this type; its placeholders are listed in README.md.
     Artifacts: spec.md only; the question is the how, so no plan.md and no tasks.md, and nothing is built. Question
     budget: exactly one, in place of the goal question: which decision should this spike make possible? -->

## Prompt

````markdown
/spec new spike
<!-- Without notes this prompt is shown as is, example values included. With notes, every field the notes answer is
     filled from them and every other example value becomes `…`. Keep the comments; send it back filled to start
     the spec. -->

## Type
spike

## Repo
quill
Slug suggestion: digest-summary-source
<!-- The current repository's name. The slug is short, kebab-case and English; the branch follows the repository's
     own rule. -->

## The decision this spike makes possible
Do we pick decisions out of the notes by marker lines or by headings?
<!-- The one question this spike answers, concretely, as "X or Y for Z?". Answering it here replaces the question
     otherwise asked first. -->

## Goal (one sentence)
I know which way the digest finds decisions before anyone builds it.
<!-- Your own sentence, copied verbatim: it becomes the spec's stated goal. -->

## Problem
Half the notes mark decisions with a "Decision:" line and half with a heading; we cannot tell which to support.
<!-- Why this cannot be decided today: which knowledge is missing? Becomes `## Problem`. -->

## Candidates
- Marker lines only
- Headings only
- Both, marker lines first
<!-- Two to four real alternatives. One of them may be "change nothing". -->

## How we find out
Count both forms over the last three months of notes; timebox: half a day.
<!-- A prototype, a measurement, a benchmark, reading documentation. Without a timebox a spike turns into a
     feature. -->

## Already known or ruled out
A language model is ruled out: the digest runs offline.
<!-- Saves rounds: what is no longer a choice, and why. -->

## Open points
Whether old notes are worth supporting at all.
<!-- Sub-questions. Each becomes a `- fog:` line under `## Not yet specified`; at the end each one turns into a claim
     or ends in a `## Decisions` row. -->
````

## spec.md

````markdown
---
task: "{{task}}"
slug: {{spec}}
spec_type: spike
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

## Not yet specified

- fog: {{fog}}

## Claims

<!-- Exactly one claim: the decision named in the prompt is made and recorded as a `## Decisions` row, with the
     evidence that settled it. A spike opens no feature block of its own; the claim is minted with `spec-check mint`
     into the block whose question it answers (or F0) first, and only then projected here. -->

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|

## Decisions

## Verification
````
