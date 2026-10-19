<!-- Type template: feature. Two parts. `## Prompt` is the fill-in prompt `/spec new feature` and `/spec idea` show
     in one fenced block: example values, a comment under every field. `## spec.md` is the skeleton of the spec the
     answers land in, with the sections `spec-check allocate` plans for this type; its placeholders are listed in
     README.md. Artifacts: spec.md, plan.md, tasks.md. Question budget: at most three, the goal question on top. -->

## Prompt

````markdown
/spec new feature
<!-- Without notes this prompt is shown as is, example values included. With notes, every field the notes answer is
     filled from them and every other example value becomes `…`. Keep the comments; send it back filled to start
     the spec. -->

## Type
feature

## Repo
quill
Slug suggestion: weekly-digest
<!-- The current repository's name. The slug is short, kebab-case and English; the branch follows the repository's
     own rule. -->

## Goal (one sentence)
Every Monday I want last week's notes as one digest that fits on one screen.
<!-- Your own sentence, copied verbatim: it becomes the spec's stated goal and is never paraphrased. A state for the
     user, not an activity. -->

## Problem
Meeting notes pile up in one folder and nobody reads them again, so decisions get lost between weeks.
<!-- Who hurts today, and how. From the product's purpose, not from the technology. Becomes `## Problem`. -->

## Vision
On Monday morning one command prints a digest of the past week: decisions first, then open questions, one line each.
<!-- What it looks like when it is good: two or three sentences from the user's side. Becomes `## Vision`. -->

## In
- A digest of every note dated in the past seven days
- Decisions and open questions picked out by their markers
<!-- What this spec delivers. -->

## Out
- A hosted service
- Sending the digest by mail
<!-- The scope boundary. Becomes `## Out of Scope`. -->

## Done looks like (observable)
- A week with notes yields one digest of at most forty lines → proof: a test over a fixture week
- A note outside the week never appears → proof: the same test with a note dated eight days back
- An empty week prints one line saying so → proof: a test over an empty folder
<!-- Checkable states, each with its proof. These become the claims, minted in the master first, and their Test
     Strategy rows. "I don't know" is an allowed answer. -->

## Guard rails
- Notes are only read, never changed
- Works offline
<!-- Stack rules, deliberate departures from the constitution, performance, offline, privacy. Become
     `## Constraints`. -->

## What the repository does not know
Most notes are written on a phone and synced, so a few arrive a day late.
<!-- A customer wish, a decision in someone's head, a device, a data volume: whatever a search of the code cannot
     find. -->

## Open points
Whether the digest should also list who attended.
<!-- What is still unclear. Becomes `- fog:` lines under `## Not yet specified`, never an invented claim. -->

## Mode
Draft first, mark assumptions as ⟨?: … — why unsure⟩, ask only structural questions.
<!-- Alternative: `proceed` accepts the reasoned defaults for the open questions and the marks. The goal question is
     asked either way. -->
````

## spec.md

````markdown
---
task: "{{task}}"
slug: {{spec}}
spec_type: feature
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

## Constraints

- {{constraint}}

## Goal

{{goal}}

## Not yet specified

- fog: {{fog}}

## Claims

<!-- One claim per line of "Done looks like", minted with `spec-check mint` into the master's feature block first and
     only then projected here. A claim is a state an observer can check, never an activity. -->

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|

## Decisions

## Verification
````
