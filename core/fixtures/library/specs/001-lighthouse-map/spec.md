---
task: "Show every lighthouse of the coast on one map"
slug: 001-lighthouse-map
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: implement
progress: 2/3
started: 2026-03-02T09:00:00Z
updated: 2026-03-09T10:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

# 001 — Lighthouse map

## Problem

Show every lighthouse of the coast on one map.

## Goal

Every lighthouse in the list stands on the map at its position.

## Not yet specified

## Claims

- [x] ISC-1: Each lighthouse of the list is drawn at its position.
- [x] ISC-2: A lighthouse shows its light pattern on hover.
- [ ] ISC-3: The map opens at the last viewed area.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | each lighthouse of the list is drawn at its position | passes | `bun test tests/lighthouse-map.test.ts` | literal | |
| ISC-2 | bun-test | a lighthouse shows its light pattern on hover | passes | `bun test tests/lighthouse-map.test.ts` | literal | |
| ISC-3 | bun-test | the map opens at the last viewed area | passes | `bun test tests/lighthouse-map.test.ts` | literal | |

## Decisions

- 2026-03-02: created.

## Verification
