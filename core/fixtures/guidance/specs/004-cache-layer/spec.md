---
task: "Read flags through a cache without serving stale values"
slug: 004-cache-layer
spec_type: refactor
isa_master: ../../ISA.md
isa_feature: F4
constitution: ../constitution.md
phase: building
progress: 2/2
started: 2026-03-02T10:00:00Z
updated: 2026-03-05T16:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F4). Claim IDs belong to the master. Never edit the
     master from this file. -->

# 004 — Cache layer

## Problem

Every flag read goes to the store.

## Goal

Flag reads hit a cache that never outlives a change by more than a second.

## Claims

- [x] ISC-10: Flag reads hit the cache before the store.
- [x] ISC-11: Anti: a cached flag outlives its change by more than one second.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-10 | bun-test | flag reads hit the cache before the store | pass | `bun test tests/cache.test.ts -t order` | literal |  |
| ISC-11 | bun-test | anti: a cached flag outlives its change by more than one second | pass | `bun test tests/cache.test.ts -t ttl` | literal |  |

## Decisions

- 2026-03-02: opened.

## Verification

- ISC-10: `bun test tests/cache.test.ts -t order` passed, 2026-03-05
- ISC-11: `bun test tests/cache.test.ts -t ttl` passed, 2026-03-05
