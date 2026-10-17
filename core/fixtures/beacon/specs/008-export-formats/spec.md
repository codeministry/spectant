---
task: "Find the largest history each format exports quickly"
slug: 008-export-formats
spec_type: spike
isa_master: ../../ISA.md
isa_feature: F6
constitution: ../constitution.md
phase: building
progress: 1/2
started: 2026-03-07T09:30:00Z
updated: 2026-03-08T09:30:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F6, History export). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 008 — Export size limits

## Problem

A full history export can take minutes in some formats, and nobody knows where the limit lies.

## Goal

A recorded table names each format's limit, and no export exceeds it.

## Claims

- [x] ISC-24: A recorded table names the largest history each format exports within ten seconds.
- [ ] ISC-25: Anti: an export exceeds the limit the spike recorded for its format. (after: ISC-24)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-24 | bash | a recorded table names the largest history each format exports within ten seconds | pass | `bun run cli -- probe exports` | literal |  |
| ISC-25 | bun-test | anti: an export exceeds the limit the spike recorded for its format | pass | `bun test tests/export.test.ts -t limit` | literal |  |

## Decisions

- 2026-03-07: opened.

## Verification

- ISC-24: `bun run cli -- probe exports` passed, 2026-03-08
