---
task: "Show the tides of the next day for each harbour"
slug: 002-tide-board
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: scoping
progress: 0/3
started: 2026-03-02T09:00:00Z
updated: 2026-03-09T10:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

# 002 — Tide board

## Problem

Show the tides of the next day for each harbour.

## Goal

The tide board shows high and low water of the next day for every harbour.

## Not yet specified

## Claims

- [ ] ISC-4: Each harbour shows its next high water.
- [ ] ISC-5: Each harbour shows its next low water.
- [ ] ISC-6: The board marks a harbour without data.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-4 | bun-test | each harbour shows its next high water | passes | `bun test tests/tide-board.test.ts` | literal | |
| ISC-5 | bun-test | each harbour shows its next low water | passes | `bun test tests/tide-board.test.ts` | literal | |
| ISC-6 | bun-test | the board marks a harbour without data | passes | `bun test tests/tide-board.test.ts` | literal | |

## Decisions

- 2026-03-02: created.

## Verification
