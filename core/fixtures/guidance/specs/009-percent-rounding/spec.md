---
task: "Serve a percentage rollout to the share it names"
slug: 009-percent-rounding
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: building
priority: P1
progress: 0/2
started: 2026-03-07T09:00:00Z
updated: 2026-03-07T09:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F1). Claim IDs belong to the master. Never edit the
     master from this file. -->

# 009 — Percent rounding

## Problem

A 33 percent rollout serves 30 percent of users.

## Goal

A percentage rollout serves the share it names, and a user keeps their variant.

## Claims

- [ ] ISC-23: A percentage rollout of 33 percent serves 33 percent of users, within one percent.
- [ ] ISC-24: Anti: a user flips between variants across evaluations.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-23 | bun-test | a percentage rollout of 33 percent serves 33 percent of users, within one percent | pass | `bun test tests/rollout.test.ts -t percent` | literal |  |
| ISC-24 | bun-test | anti: a user flips between variants across evaluations | pass | `bun test tests/rollout.test.ts -t sticky` | literal |  |

## Decisions

- 2026-03-07: opened.

## Verification
