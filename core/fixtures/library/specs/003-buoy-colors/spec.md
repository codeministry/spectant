---
task: "Move the buoy colours into one table"
slug: 003-buoy-colors
spec_type: refactor
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: complete
progress: 3/3
started: 2026-03-02T09:00:00Z
updated: 2026-03-09T10:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

# 003 — Buoy colors

## Problem

Move the buoy colours into one table.

## Goal

Every buoy colour comes from one table; the map looks the same.

## Not yet specified

## Claims

- [x] ISC-7: Each buoy keeps its colour.
- [x] ISC-8: One table holds every colour.
- [x] ISC-9: Anti: a colour is defined twice.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-7 | bun-test | each buoy keeps its colour | passes | `bun test tests/buoy-colors.test.ts` | literal | |
| ISC-8 | bun-test | one table holds every colour | passes | `bun test tests/buoy-colors.test.ts` | literal | |
| ISC-9 | bun-test | anti: a colour is defined twice | passes | `bun test tests/buoy-colors.test.ts` | literal | |

## Decisions

- 2026-03-02: created.

## Verification
