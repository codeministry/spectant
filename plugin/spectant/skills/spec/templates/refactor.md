<!-- Type template: refactor. Two parts. `## Prompt` is the fill-in prompt `/spec new refactor` and `/spec idea` show
     in one fenced block: example values, a comment under every field. `## spec.md` is the skeleton of the spec the
     answers land in, with the sections `spec-check allocate` plans for this type; its placeholders are listed in
     README.md. Artifacts: spec.md and tasks.md; behaviour is held, not changed. Question budget: at most three, the
     goal question on top. -->

## Prompt

````markdown
/spec new refactor
<!-- Without notes this prompt is shown as is, example values included. With notes, every field the notes answer is
     filled from them and every other example value becomes `…`. Keep the comments; send it back filled to start
     the spec. -->

## Type
refactor

## Repo
quill
Slug suggestion: split-note-reader
<!-- The current repository's name. The slug is short, kebab-case and English; the branch follows the repository's
     own rule. -->

## Goal (one sentence)
Reading notes and rendering the digest live in two modules that do not know each other.
<!-- Your own sentence, copied verbatim: it becomes the spec's stated goal. The target state of the structure. -->

## Problem
One file reads the folder, parses the dates and prints the digest, so every change to the output touches the parser.
<!-- What hurts today: coupling, duplicates, a file grown too large. Becomes `## Problem`. -->

## Affected area
`src/digest.ts`, `src/notes/`
<!-- Paths or modules. Everything outside counts as untouched. -->

## Behaviour that stays the same
- The digest of every fixture week is byte-identical before and after → proof: the existing snapshot tests
- The command's flags and exit codes are unchanged → proof: the CLI tests
<!-- A refactor changes nothing outside. What proves it? Name the existing tests first. These become the claims,
     minted in the master first. -->

## Target structure (observable)
- `src/render/` imports nothing from `src/notes/` → proof: a grep in the static check
- No file under `src/` is longer than 300 lines → proof: a line count in the static check
<!-- Checkable properties of the code, by command where possible. They become claims as well. -->

## Out
- A new output format
<!-- What is tempting and close but belongs in a spec of its own. Becomes `## Out of Scope`. -->

## Open points
Whether the date parsing moves with the reader or gets a module of its own.
<!-- What is still unclear. A refactor spec has no fog section: each point becomes a ⟨?: … — why unsure⟩ mark in the
     draft, asked within the question budget when it changes the structure, never an invented claim. -->

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
spec_type: refactor
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

## Out of Scope

- {{out_of_scope}}

## Goal

{{goal}}

## Claims

<!-- First the held behaviour, then the target structure, each minted with `spec-check mint` into the master's
     feature block first and only then projected here. -->

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|

## Decisions

## Verification
````
