---
task: "Label every time on the status page with a time zone"
slug: 009-timezone-labels
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F2
constitution: ../constitution.md
phase: building
progress: 1/1
started: 2026-03-07T11:00:00Z
updated: 2026-03-08T11:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F2, Status page). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 009 — Time-zone labels

## Problem

Times on the status page carry no zone, so a reader abroad misreads every outage window.

## Goal

Every time on the status page carries the viewer's time-zone label.

## Claims

- [x] ISC-26: Times on the status page carry the viewer's time-zone label.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-26 | e2e | times on the status page carry the viewer's time-zone label | pass | `bun run e2e -- status -g timezone` | literal |  |

## Decisions

- 2026-03-07: opened.

## Verification

- ISC-26: `bun run e2e -- status -g timezone` passed, 2026-03-08
