---
task: "An old digest stays findable in the archive"
slug: 002-other
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F2
stage: build
constitution: ../constitution.md
phase: building
progress: 0/2
started: 2026-03-05T09:00:00Z
updated: 2026-03-06T08:00:00Z
---

# 002 — Archive

## Problem

A digest of last month is gone once the next week's digest is written.

## Goal

An old digest stays findable by its week number, and archiving it touches no note.

## Claims

- [ ] ISC-4: An archived digest keeps its week number in its file name.
- [ ] ISC-5: Anti: archiving a digest rewrites a note. (after: ISC-4)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-4 | bun-test | archive: file name | week number in the name | `bun test core/ -t "archive"` | derived: findable | medium |
| ISC-5 | bun-test | archive: notes untouched | byte-identical notes | `bun test plugin/ -t "archive"` | derived: no-loss | high |

## Decisions

- 2026-03-06: T3 of the archive keeps a repeated digest title as two files; ISC-5 forbids a rewrite.

## Verification
