---
task: "Replace the mail relay API key without a restart"
slug: 010-renew-api-key
spec_type: chore
isa_master: ../../ISA.md
isa_feature: F7
constitution: ../constitution.md
phase: building
progress: 2/2
started: 2026-03-07T13:00:00Z
updated: 2026-03-07T15:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F7, Maintenance). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 010 — Renew the mail relay key

## Problem

The mail relay API key expires at the end of the month.

## Goal

The key is replaced and the old one revoked, with no restart.

## Claims

- [x] ISC-27: The mail relay API key is replaced without a restart.
- [x] ISC-28: The old mail relay API key is revoked after the swap.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-27 | bash | the mail relay api key is replaced without a restart | pass | `bun run cli -- keys rotate --dry-run` | literal |  |
| ISC-28 | bash | the old mail relay api key is revoked after the swap | pass | `bun run cli -- keys check` | literal |  |

## Decisions

- 2026-03-07: opened.

## Verification

- ISC-27: `bun run cli -- keys rotate --dry-run` passed, 2026-03-07
- ISC-28: `bun run cli -- keys check` passed, 2026-03-07
