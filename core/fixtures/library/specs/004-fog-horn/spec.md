---
task: "The fog horn interval shows in minutes instead of seconds"
slug: 004-fog-horn
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: scoping
progress: 0/1
started: 2026-03-02T09:00:00Z
updated: 2026-03-09T10:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

# 004 — Fog horn timing

## Problem

The fog horn interval shows in minutes instead of seconds.

## Goal

The fog horn interval reads in seconds.

## Not yet specified

## Claims

- [ ] ISC-10: Anti: an interval of 30 seconds reads as 30 minutes.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-10 | bun-test | anti: an interval of 30 seconds reads as 30 minutes | passes | `bun test tests/fog-horn.test.ts` | literal | |

## Decisions

- 2026-03-02: created.

## Verification
