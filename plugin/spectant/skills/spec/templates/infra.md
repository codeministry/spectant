<!-- Type template: infra. Two parts. `## Prompt` is the fill-in prompt `/spec new infra` and `/spec idea` show in one
     fenced block: example values, a comment under every field. `## spec.md` is the skeleton of the spec the answers
     land in, with the sections `spec-check allocate` plans for this type; its placeholders are listed in README.md.
     Artifacts: spec.md and plan.md. Question budget: at most three, the goal question on top; the rollback question
     is always asked on top of that, and `proceed` never skips it. -->

## Prompt

````markdown
/spec new infra
<!-- Without notes this prompt is shown as is, example values included. With notes, every field the notes answer is
     filled from them and every other example value becomes `…`. Keep the comments; send it back filled to start
     the spec. -->

## Type
infra

## Repo
quill
Slug suggestion: monday-timer
<!-- The current repository's name. The slug is short, kebab-case and English; the branch follows the repository's
     own rule. -->

## Goal (one sentence)
The digest is in the team channel every Monday at eight without anyone running it.
<!-- Your own sentence, copied verbatim: it becomes the spec's stated goal. -->

## Problem
Someone has to remember to run the digest by hand, and in a busy week nobody does.
<!-- What is broken, risky, manual or expensive today? Becomes `## Problem`. -->

## Affected systems
The team's build server: one scheduled job and the secret that posts to the channel.
<!-- Hosts, jobs, services, DNS, secrets, storage, certificates: whatever this spec changes. -->

## Done looks like (checked by a command)
- The job is scheduled for Monday 08:00 → proof: the scheduler's list command shows the next run
- A dry run posts nothing and exits 0 → proof: the job's dry-run command in CI
<!-- At least one proof is a command; never "manual". These become the claims, minted in the master first. -->

## Rollback
Switch the timer off again; the notes folder is never changed, so nothing is lost. Takes a minute.
<!-- Required, and asked even under `proceed`: how do we get back, how long does it take, what is lost? Becomes the
     `Rollback:` line under `## Constraints` and a section of plan.md. -->

## Guard rails
- The secret lives only in the server's secret store
- No downtime window needed
<!-- Downtime windows, costs, deployment rules, affected users. Become `## Constraints`. -->

## Open points
Whether a public holiday on Monday moves the digest to Tuesday.
<!-- What is still unclear. An infra spec has no fog section: each point becomes a ⟨?: … — why unsure⟩ mark in the
     draft, asked within the question budget when it changes the build, never an invented claim. -->

## Mode
Draft first, mark assumptions as ⟨?: … — why unsure⟩, ask only structural questions.
<!-- Alternative: `proceed` accepts the reasoned defaults for the open questions and the marks. The rollback and goal
     questions are asked either way. -->
````

## spec.md

````markdown
---
task: "{{task}}"
slug: {{spec}}
spec_type: infra
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

## Constraints

- {{constraint}}
- Rollback: {{rollback}}

## Goal

{{goal}}

## Claims

<!-- One claim per line of "Done looks like", minted with `spec-check mint` into the master's feature block first and
     only then projected here. At least one claim has a deterministic probe; none is `manual`. -->

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|

## Decisions

## Verification
````
