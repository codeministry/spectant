---
task: "Find the snapshot size every SDK evaluates quickly"
slug: 006-sdk-benchmarks
spec_type: spike
isa_master: ../../ISA.md
isa_feature: F5
constitution: ../constitution.md
phase: building
progress: 2/2
started: 2026-03-03T09:00:00Z
updated: 2026-03-06T10:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F5). Claim IDs belong to the master. Never edit the
     master from this file. -->

# 006 — SDK benchmarks

## Problem

Nobody knows how large a snapshot an SDK can evaluate quickly.

## Goal

A recorded table names each SDK's evaluation time and a decision names the limit.

## Claims

- [x] ISC-15: A recorded table names the evaluation time of each SDK at ten thousand flags.
- [x] ISC-16: A decision names the snapshot size limit.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-15 | bash | a recorded table names the evaluation time of each sdk at ten thousand flags | pass | `bun run cli -- bench sdk` | literal |  |
| ISC-16 | bash | a decision names the snapshot size limit | pass | `bun run cli -- bench sdk --decision` | literal |  |

## Decisions

- 2026-03-03: opened.

## Verification

- ISC-15: `bun run cli -- bench sdk` passed, 2026-03-06
- ISC-16: `bun run cli -- bench sdk --decision` passed, 2026-03-06
