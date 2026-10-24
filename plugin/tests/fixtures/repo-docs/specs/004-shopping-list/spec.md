---
task: "A shopping list from a week of recipes"
slug: 004-shopping-list
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F4
stage: done
constitution: ../constitution.md
phase: complete
progress: 2/2
started: 2026-01-12T09:00:00Z
updated: 2026-01-19T17:00:00Z
---

<!-- SPEC — a derived view of ../../ISA.md (feature F4). Claim IDs belong to the master: minted there first, then
     projected here. Never edit the master from this file. -->

# 004 — Shopping list

## Problem

Planning a week of meals means adding up the same ingredient from five recipes on paper.

## Goal

`recipebox list <recipe>…` prints one line per ingredient across the named recipes, quantities summed per unit.

## Not yet specified

## Claims

- [x] ISC-8: `recipebox list <recipe>…` prints one line per ingredient across the named recipes.
- [x] ISC-9: Quantities of the same ingredient and unit are summed on one line.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-8 | bun-test | shopping list: merged lines | one line per ingredient | `bun test -t "shopping"` | derived: shopping | medium |
| ISC-9 | bun-test | shopping list: units | quantities summed per unit | `bun test -t "shopping"` | derived: shopping | medium |

## Decisions

- 2026-01-14: Different units of one ingredient stay on separate lines; the tool converts no unit.

## Verification

- ISC-8: bun-test — `bun test -t "shopping"` 4 pass (T2; 2026-01-19)
- ISC-9: bun-test — `bun test -t "shopping"` 4 pass, two units summed apart (T3; 2026-01-19)
