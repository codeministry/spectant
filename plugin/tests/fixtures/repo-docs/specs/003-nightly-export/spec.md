---
task: "Export the whole recipe box every night"
slug: 003-nightly-export
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F3
stage: plan
constitution: ../constitution.md
phase: scoping
progress: 0/2
started: 2026-01-20T09:00:00Z
updated: 2026-01-22T16:00:00Z
---

<!-- SPEC — a derived view of ../../ISA.md (feature F3). Claim IDs belong to the master: minted there first, then
     projected here. Never edit the master from this file. -->

# 003 — Nightly export

## Problem

A disk failure loses every recipe; nobody copies the folder by hand.

## Goal

`recipebox export` writes one archive holding every recipe exactly once, run by the system scheduler every night,
without changing a recipe.

## Not yet specified

- fog: Whether the export keeps the last seven archives or only the newest one.

## Claims

- [ ] ISC-6: `recipebox export` writes one archive that holds every recipe exactly once.
- [ ] ISC-7: Anti: an export changes a recipe file.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-6 | bun-test | export: archive contents | every recipe once | `bun test -t "export"` | derived: nightly-export | high |
| ISC-7 | bun-test | export: recipes untouched | byte-identical recipes | `bun test -t "export"` | derived: plain-files | high |

## Decisions

- 2026-01-20: The export runs from the system scheduler, not from a long-running process.

## Verification
