---
task: "Run every check on its interval"
slug: 001-check-scheduler
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: complete
progress: 3/3
started: 2026-03-01T09:00:00Z
updated: 2026-03-04T16:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F1, Check scheduling). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 001 — Check scheduler

## Problem

Checks run from a cron table that drifts and sometimes fires two checks on one host at once.

## Goal

Every check runs on its own interval, spread across the host, and a timeout counts as down.

```mermaid
flowchart LR
  scheduler --> agent --> store --> page
```

## Claims

- [x] ISC-1: A check runs at the interval its definition names, within one second.
- [x] ISC-2: A check that times out is recorded as down, never as up.
- [x] ISC-3: Two checks on one host never run at the same instant.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | a check runs at the interval its definition names, within one second | pass | `bun test tests/scheduler.test.ts -t interval` | literal |  |
| ISC-2 | bun-test | a check that times out is recorded as down, never as up | pass | `bun test tests/scheduler.test.ts -t timeout` | literal |  |
| ISC-3 | bun-test | two checks on one host never run at the same instant | pass | `bun test tests/scheduler.test.ts -t spread` | literal |  |

## Decisions

- 2026-03-01: opened.

## Verification

- ISC-1: `bun test tests/scheduler.test.ts -t interval` passed, 2026-03-04
- ISC-2: `bun test tests/scheduler.test.ts -t timeout` passed, 2026-03-04
- ISC-3: `bun test tests/scheduler.test.ts -t spread` passed, 2026-03-04
