---
task: "Replace the push token without stopping a scheduled sync"
slug: 007-rotate-mirror-token
spec_type: chore
isa_master: ../../ISA.md
isa_feature: F5
constitution: ../constitution.md
phase: building
progress: 2/2
started: 2026-03-09T08:30:00Z
updated: 2026-03-09T11:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F5). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 007-rotate-mirror-token"). Never edit the master from this file. -->

# 007 — Rotate the mirror token

## Problem

Replacing the push token means stopping the schedule, editing the credential store by hand and starting it again.

## Goal

The push token is replaced with one command, and the next scheduled run uses the new token without a restart.

## Claims

- [x] ISC-126: `harbor token rotate` replaces the push token in the credential store, and the next scheduled run uses it without a restart.
- [x] ISC-127: Anti: a sync started after the rotation authenticates with the old token.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-126 | bun-test | token used by the run after a rotation | the new token | `bun test tests/token.test.ts -t "rotate"` | literal |  |
| ISC-127 | bun-test | registry stub log after a rotation | 0 requests with the old token | `bun test tests/token.test.ts -t "old token"` | derived: no-leak | high |

## Decisions

- 2026-03-09: a chore, not a task in another spec; the token store already existed, only the swap was missing.

## Verification

- ISC-126: `bun test tests/token.test.ts -t "rotate"` passed, 2026-03-09
- ISC-127: `bun test tests/token.test.ts -t "old token"` passed, 2026-03-09
