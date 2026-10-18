---
task: "Evaluate flags locally in the server and browser SDKs"
slug: 005-sdk-rollout
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F5
constitution: ../constitution.md
phase: building
priority: P2
progress: 1/3
started: 2026-03-02T09:00:00Z
updated: 2026-03-07T10:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F5). Claim IDs belong to the master. Never edit the
     master from this file. -->

# 005 — SDK rollout

## Problem

Every flag evaluation is a call to the API.

## Goal

The SDKs evaluate flags locally from one snapshot and reload it on change.

```mermaid
flowchart LR
  console --> api --> store --> sdk
```

## Claims

- [x] ISC-12: The server SDK evaluates flags locally from one snapshot.
- [ ] ISC-13: The browser SDK reloads its snapshot on a change event.
- [ ] ISC-14: A rollout to the staging tenant is confirmed by hand on the staging console.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-12 | bun-test | the server sdk evaluates flags locally from one snapshot | pass | `bun test tests/sdk.test.ts -t snapshot` | literal |  |
| ISC-13 | bun-test | the browser sdk reloads its snapshot on a change event | pass | `bun test tests/sdk.test.ts -t reload` | literal |  |
| ISC-14 | manual | a rollout to the staging tenant is confirmed by hand on the staging console | pass | `manual check on the staging console` | literal |  |

## Decisions

- 2026-03-02: opened.

## Verification

- ISC-12: `bun test tests/sdk.test.ts -t snapshot` passed, 2026-03-07
