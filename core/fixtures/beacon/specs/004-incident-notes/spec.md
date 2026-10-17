---
task: "Explain an outage in words on the status page"
slug: 004-incident-notes
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F4
constitution: ../constitution.md
phase: building
progress: 0/3
started: 2026-03-06T09:00:00Z
updated: 2026-03-07T15:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F4, Incident notes). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 004 — Incident notes

## Problem

The status page shows that a service was down but not why.

## Goal

Each outage can carry a note that shows on the status page, newest first.

```mermaid
flowchart LR
  scheduler --> agent --> store --> page
```

## Claims

- [ ] ISC-10: An incident note is attached to the outage it describes.
- [ ] ISC-11: Incident notes show on the status page, newest first.
- [ ] ISC-12: Editing a note keeps its first publication time.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-10 | bun-test | an incident note is attached to the outage it describes | pass | `bun test tests/notes.test.ts -t attach` | literal |  |
| ISC-11 | e2e | incident notes show on the status page, newest first | pass | `bun run e2e -- notes -g order` | literal |  |
| ISC-12 | bun-test | editing a note keeps its first publication time | pass | `bun test tests/notes.test.ts -t edit` | literal |  |

## Decisions

- 2026-03-06: opened.

## Verification
