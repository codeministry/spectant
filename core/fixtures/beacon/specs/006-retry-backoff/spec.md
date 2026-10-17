---
task: "Retry failed runs without counting extra outages"
slug: 006-retry-backoff
spec_type: refactor
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: building
progress: 2/2
started: 2026-03-06T11:00:00Z
updated: 2026-03-08T10:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F1, Check scheduling). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 006 — Retry backoff

## Problem

A failed run is retried at once and each retry is recorded as its own outage.

## Goal

Retries back off exponentially and belong to the outage that caused them.

## Claims

- [x] ISC-20: A failed run is retried with exponential backoff up to three times.
- [x] ISC-21: Anti: a retry is counted as a separate outage.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-20 | bun-test | a failed run is retried with exponential backoff up to three times | pass | `bun test tests/retry.test.ts -t backoff` | literal |  |
| ISC-21 | bun-test | anti: a retry is counted as a separate outage | pass | `bun test tests/retry.test.ts -t outage` | literal |  |

## Decisions

- 2026-03-06: opened.

## Verification

- ISC-20: `bun test tests/retry.test.ts -t backoff` passed, 2026-03-08
- ISC-21: `bun test tests/retry.test.ts -t outage` passed, 2026-03-08
