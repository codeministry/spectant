---
task: "Export a segment's rules as CSV"
slug: 012-segment-export
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: building
progress: 0/2
started: 2026-03-07T11:00:00Z
updated: 2026-03-07T11:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F1). Claim IDs belong to the master. Never edit the
     master from this file. -->

# 012 — Segment export

## Problem

Support cannot hand a segment's rules to a customer.

## Goal

A segment exports as a CSV of its rules, without user identifiers, once segments exist.

## Claims

- [ ] ISC-28: A segment exports as a CSV of its rules. (after: 007)
- [ ] ISC-29: Anti: an export lists a user identifier. (after: 007)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-28 | bun-test | a segment exports as a csv of its rules | pass | `bun test tests/segments.test.ts -t export` | literal |  |
| ISC-29 | bun-test | anti: an export lists a user identifier | pass | `bun test tests/segments.test.ts -t privacy` | literal |  |

## Decisions

- 2026-03-07: opened.

## Verification
