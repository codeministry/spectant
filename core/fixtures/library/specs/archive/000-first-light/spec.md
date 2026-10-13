---
task: "Draw the first lighthouse"
slug: 000-first-light
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: complete
progress: 1/1
started: 2026-03-02T09:00:00Z
updated: 2026-03-09T10:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
archived: 2026-03-01
---

# 000 — First light

## Problem

Draw the first lighthouse.

## Goal

One lighthouse on an empty map.

## Not yet specified

## Claims

- [x] ISC-0: The first lighthouse is drawn.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-0 | bun-test | the first lighthouse is drawn | passes | `bun test tests/first-light.test.ts` | literal | |

## Decisions

- 2026-03-02: created.

## Verification
