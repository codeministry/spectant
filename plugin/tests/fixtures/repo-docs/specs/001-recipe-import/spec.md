---
task: "Import a recipe from a Markdown file"
slug: 001-recipe-import
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F1
stage: tasks
constitution: ../constitution.md
phase: scoping
progress: 0/3
started: 2026-01-12T09:00:00Z
updated: 2026-01-16T11:30:00Z
---

<!-- SPEC — a derived view of ../../ISA.md (feature F1). Claim IDs belong to the master: minted there first, then
     projected here. Never edit the master from this file. -->

# 001 — Recipe import

## Problem

A recipe found elsewhere has to be copied into the recipe folder by hand, and the copy often loses its frontmatter.

## Goal

`recipebox import <file>` puts a recipe into the recipe folder as one Markdown file, its frontmatter intact, and never
overwrites a recipe that is already there.

## Not yet specified

## Claims

- [ ] ISC-1: `recipebox import <file>` writes the recipe as one Markdown file into the recipe folder.
- [ ] ISC-2: The imported file keeps the source's frontmatter byte for byte. (after: ISC-1)
- [ ] ISC-3: Anti: an import over an existing recipe name changes a file.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | import: one Markdown file | one recipe written | `bun test -t "import"` | derived: one-folder | high |
| ISC-2 | bun-test | import: frontmatter kept | byte-identical frontmatter | `bun test -t "import"` | derived: plain-files | high |
| ISC-3 | bun-test | import: existing name | 0 files changed | `bun test -t "import"` | derived: plain-files | high |

## Decisions

- 2026-01-14: The recipe's file name is its slugged title; the source file name is ignored.

## Verification
