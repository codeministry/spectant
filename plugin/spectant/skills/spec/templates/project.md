<!-- Type template: project. Two parts. `## Prompt` is the fill-in prompt `/spec new project` and `/spec idea` show
     in one fenced block: example values, a comment under every field. `## spec.md` is the skeleton of the spec the
     answers land in, with the sections `spec-check allocate` plans for this type; its placeholders are listed in
     README.md. Artifacts: all four (spec.md, plan.md, tasks.md, and the sub-project's own constitution). No question
     budget in advance: a full interview replaces the gap questions. Only for a sub-project inside a repository that
     already has its master ISA.md; in a fresh repository the master is the project and the first spec is a feature. -->

## Prompt

````markdown
/spec new project
<!-- Without notes this prompt is shown as is, example values included. With notes, every field the notes answer is
     filled from them and every other example value becomes `…`. Keep the comments; send it back filled to start
     the spec. -->

## Type
project

## Repo
quill
Slug suggestion: digest-mobile-app
<!-- The current repository's name. The slug is short, kebab-case and English; the branch follows the repository's
     own rule. -->

## Goal (one sentence)
The weekly digest is on my phone on Monday morning, readable without a network.
<!-- Your own sentence, copied verbatim: it becomes the spec's stated goal. -->

## Problem and for whom
Team members who are on the road on Mondays never open the digest on a laptop, so they start the week uninformed.
<!-- Which users or segments, which pain, why now. Becomes `## Problem`. -->

## Vision
A small app shows the latest digest, keeps the last four offline and marks what is new since the last visit.
<!-- What the sub-project looks like when it is done. Becomes `## Vision`. -->

## In and out
- In: reading the digest, offline copies, a "new" marker
- Out: writing notes on the phone, push notifications
<!-- A rough boundary; the interview settles the details. "Out" becomes `## Out of Scope`. -->

## First signs of success
Within two weeks, most of the team opens the digest on Monday before ten.
<!-- How do we notice early that it works? -->

## Guard rails
- The app reads only what the digest already publishes
- Same language and stack as the rest of the repository
<!-- Budget, time, stack, customer, legal requirements. Become `## Principles` and `## Constraints`. -->

## Already decided
One app for both phone platforms, no native code of our own.
<!-- Saves interview rounds: what is settled, and why. -->

## Open points
Whether the app needs a login at all.
<!-- What is still unclear. Becomes `- fog:` lines under `## Not yet specified`, never an invented claim. -->

## Mode
Full interview before the draft.
<!-- Fixed for a project: the interview replaces the gap questions, and the goal question is asked either way. -->
````

## spec.md

````markdown
---
task: "{{task}}"
slug: {{spec}}
spec_type: project
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

## Vision

{{vision}}

## Out of Scope

- {{out_of_scope}}

## Principles

- {{principle}}

## Constraints

- {{constraint}}

## Goal

{{goal}}

## Not yet specified

- fog: {{fog}}

## Claims

<!-- The claims the interview settles, minted with `spec-check mint` into the master's feature block first and only
     then projected here. Every further section the interview genuinely fills is added in the format's order. -->

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|

## Decisions

## Verification
````
