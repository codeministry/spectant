---
task: "A recipe box on the command line"
slug: recipebox
project: recipebox
phase: building
progress: 4/11
started: 2026-01-05T09:00:00Z
updated: 2026-01-22T16:00:00Z
principal_stated_goal: "Recipes live as Markdown files, and one command finds, imports and exports them."
---

# Recipe box

<!-- The project master. Every claim ID is minted here first (`spec-check mint`) and only then derived into a spec
     under specs/NNN-slug/. Closes and decisions reach this file through `spec-check verify` and `spec-check decide`;
     it is never hand-edited. -->

## Problem

Recipes sit in browser bookmarks, photos and a notes app. Finding the one that uses what is left in the fridge means
opening all three.

## Vision

One folder of Markdown recipes and one command, `recipebox`, that imports a recipe from a file, finds recipes by
ingredient, builds a shopping list and exports the whole box every night.

## Out of Scope

- A web or mobile interface.
- Syncing between machines.

## Principles

- A recipe is a plain Markdown file a person can read and edit without the tool.
- The tool never changes a recipe it reads, except through `recipebox import`.

## Constraints

- Runs offline; no network call.
- TypeScript on bun.

## Goal

Recipes live as Markdown files, and one command finds, imports and exports them.

## Not yet specified

- fog: Whether a recipe may name a unit the tool does not know.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | import: one Markdown file | one recipe written | `bun test -t "import"` | derived: one-folder | high |
| ISC-2 | bun-test | import: frontmatter kept | byte-identical frontmatter | `bun test -t "import"` | derived: plain-files | high |
| ISC-3 | bun-test | import: existing name | 0 files changed | `bun test -t "import"` | derived: plain-files | high |
| ISC-4 | bun-test | search: one ingredient | every match listed | `bun test -t "search"` | derived: find-by-ingredient | high |
| ISC-5 | bun-test | search: two ingredients | only recipes with both | `bun test -t "search"` | derived: find-by-ingredient | medium |
| ISC-6 | bun-test | export: archive contents | every recipe once | `bun test -t "export"` | derived: nightly-export | high |
| ISC-7 | bun-test | export: recipes untouched | byte-identical recipes | `bun test -t "export"` | derived: plain-files | high |
| ISC-8 | bun-test | shopping list: merged lines | one line per ingredient | `bun test -t "shopping"` | derived: shopping | medium |
| ISC-9 | bun-test | shopping list: units | quantities summed per unit | `bun test -t "shopping"` | derived: shopping | medium |
| ISC-10 | bun-test | config: default folder | default folder without a file | `bun test -t "config"` | derived: one-folder | medium |
| ISC-11 | bun-test | config: unknown key | exit 1, key named | `bun test -t "config"` | derived: one-folder | low |

## Features

### F0 · Cross-cutting

Why: rules every command shares.

### F1 · Import
Why: a recipe from anywhere becomes one Markdown file in the box.

- [ ] ISC-1: `recipebox import <file>` writes the recipe as one Markdown file into the recipe folder.
- [ ] ISC-2: The imported file keeps the source's frontmatter byte for byte. (after: ISC-1)
- [ ] ISC-3: Anti: an import over an existing recipe name changes a file.

### F2 · Search
Why: the recipe that uses what is left in the fridge is one command away.

- [ ] ISC-4: `recipebox find <ingredient>` lists every recipe that names the ingredient.
- [ ] ISC-5: Two ingredients list only the recipes that name both. (after: ISC-4)

### F3 · Export
Why: the whole box is safe in one archive every night.

- [ ] ISC-6: `recipebox export` writes one archive that holds every recipe exactly once.
- [ ] ISC-7: Anti: an export changes a recipe file.

### F4 · Shopping list
Why: the ingredients of a week of recipes become one list.

- [x] ISC-8: `recipebox list <recipe>…` prints one line per ingredient across the named recipes.
- [x] ISC-9: Quantities of the same ingredient and unit are summed on one line.

### F5 · Configuration
Why: the tool finds the recipe folder without a flag.

- [x] ISC-10: Without a config file the recipe folder is `recipes/` in the working directory.
- [x] ISC-11: An unknown key in the config file exits 1 and names the key.

## Decisions

- 2026-01-05 (init): master created from the stated goal; claims follow with the first spec.
- 2026-01-07: Configuration ships first, as its own spec, so every later command reads the same folder.
- 2026-01-20: The export runs from the system scheduler, not from a long-running process.

## Verification

- ISC-8: bun-test — `bun test -t "shopping"` 4 pass (T2; 2026-01-19)
- ISC-9: bun-test — `bun test -t "shopping"` 4 pass, two units summed apart (T3; 2026-01-19)
- ISC-10: bun-test — `bun test -t "config"` 3 pass (T1; 2026-01-09)
- ISC-11: bun-test — `bun test -t "config"` 3 pass, exit 1 names the key (T2; 2026-01-09)

## Remaining Work

- Import, search and export are open.
