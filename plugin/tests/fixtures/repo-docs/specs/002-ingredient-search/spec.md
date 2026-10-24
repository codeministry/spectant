---
task: "Find recipes by ingredient"
slug: 002-ingredient-search
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F2
stage: tasks
constitution: ../constitution.md
phase: scoping
progress: 0/2
started: 2026-01-15T09:00:00Z
updated: 2026-01-21T15:00:00Z
---

<!-- SPEC — a derived view of ../../ISA.md (feature F2). Claim IDs belong to the master: minted there first, then
     projected here. Never edit the master from this file. -->

# 002 — Ingredient search

## Problem

Finding a recipe that uses what is left in the fridge means opening every recipe file.

## Goal

`recipebox find <ingredient>…` lists every recipe that names all the given ingredients, one line per recipe.

## Not yet specified

- fog: Whether a plural ("tomatoes") should match a singular ingredient line ("tomato").

## Claims

- [ ] ISC-4: `recipebox find <ingredient>` lists every recipe that names the ingredient.
- [ ] ISC-5: Two ingredients list only the recipes that name both. (after: ISC-4)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-4 | bun-test | search: one ingredient | every match listed | `bun test -t "search"` | derived: find-by-ingredient | high |
| ISC-5 | bun-test | search: two ingredients | only recipes with both | `bun test -t "search"` | derived: find-by-ingredient | medium |

## Decisions

- 2026-01-18: The result list follows the layout of the prototype under `.design/prototype/`.

## Verification
