---
task: "Name the flag and its owner in the stale-flag banner"
slug: 010-banner-copy
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F3
constitution: ../constitution.md
phase: building
progress: 1/1
started: 2026-03-04T09:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F3). Claim IDs belong to the master. Never edit the
     master from this file. -->

# 010 — Stale-flag banner copy

## Problem

The stale-flag banner says a flag is stale but not which one.

## Goal

The banner names the flag and its owner.

## Claims

- [x] ISC-25: The stale-flag banner names the flag and its owner.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-25 | e2e | the stale-flag banner names the flag and its owner | pass | `bun run e2e -- banner -g copy` | literal |  |

## Decisions

- 2026-03-04: opened.

## Verification

- ISC-25: `bun run e2e -- banner -g copy` passed, 2026-03-04
