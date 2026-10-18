---
task: "Store each flag with its rules in one document"
slug: 011-flag-store
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F4
constitution: ../constitution.md
phase: complete
progress: 2/2
started: 2026-03-01T09:00:00Z
updated: 2026-03-02T16:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F4). Claim IDs belong to the master. Never edit the
     master from this file. -->

# 011 — Flag store

## Problem

Flags and their rules live in separate tables that drift.

## Goal

A flag and its rules are one document, written atomically.

```mermaid
flowchart LR
  console --> api --> store --> sdk
```

## Claims

- [x] ISC-26: Flags are stored with their rules in one document.
- [x] ISC-27: A store write is atomic per flag.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-26 | bun-test | flags are stored with their rules in one document | pass | `bun test tests/store.test.ts -t document` | literal |  |
| ISC-27 | bun-test | a store write is atomic per flag | pass | `bun test tests/store.test.ts -t atomic` | literal |  |

## Decisions

- 2026-03-01: opened.

## Verification

- ISC-26: `bun test tests/store.test.ts -t document` passed, 2026-03-02
- ISC-27: `bun test tests/store.test.ts -t atomic` passed, 2026-03-02
