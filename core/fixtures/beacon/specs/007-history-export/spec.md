---
task: "Find out which export formats teams need"
slug: 007-history-export
spec_type: spike
isa_master: ../../ISA.md
isa_feature: F6
constitution: ../constitution.md
phase: building
progress: 2/2
started: 2026-03-07T09:00:00Z
updated: 2026-03-08T09:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F6, History export). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 007 — History export formats

## Problem

Teams ask for their uptime history in different formats, and nobody has listed which.

## Goal

A recorded table names the formats and a decision names the default.

## Claims

- [x] ISC-22: A recorded table names the export formats teams ask for, with one example file each.
- [x] ISC-23: A decision names the default export format.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-22 | bash | a recorded table names the export formats teams ask for, with one example file each | pass | `bun run cli -- survey exports` | literal |  |
| ISC-23 | bash | a decision names the default export format | pass | `bun run cli -- survey exports --decision` | literal |  |

## Decisions

- 2026-03-07: opened.

## Verification

- ISC-22: `bun run cli -- survey exports` passed, 2026-03-08
- ISC-23: `bun run cli -- survey exports --decision` passed, 2026-03-08
