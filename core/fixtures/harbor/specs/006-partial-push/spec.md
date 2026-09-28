---
task: "Stop a timed-out push from leaving a half-written manifest behind"
slug: 006-partial-push
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F0
constitution: ../constitution.md
phase: scoping
progress: 0/4
started: 2026-03-08T09:00:00Z
updated: 2026-03-09T10:15:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F0). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 006-partial-push"). Never edit the master from this file. -->

# 006 — Partial push after a timeout

## Problem

When the target registry drops the connection mid-push, the manifest is written before its last blob, and the
retry creates a second tag.

## Goal

A push interrupted at any point leaves the target registry exactly as it was before the push started.

## Claims

- [ ] ISC-1: Anti: a failed push leaves a partial manifest visible in the target registry.
- [ ] ISC-2: Every command exits non-zero when any repository in the run failed.
- [ ] ISC-3: Anti: a registry credential appears in a log line, an error message or the sync history.
- [ ] ISC-125: Anti: a retried push after a timeout creates a second tag pointing at a different digest.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | target registry after an interrupted push | 0 partial manifests | `bun test tests/push.test.ts -t "interrupted"` | derived: atomic-push | high |
| ISC-2 | bash | exit code of a run with one failing repository | non-zero | `bun run cli -- sync --config tests/one-fails.toml; test $? -ne 0` | literal |  |
| ISC-3 | bun-test | credential canaries in every output channel | 0 hits | `bun test tests/redaction.test.ts` | derived: no-leak | high |
| ISC-125 | bun-test | tags after a timed-out push and its retry | 1 tag, 1 digest | `bun test tests/push.test.ts -t "retry"` | derived: atomic-push | high |

## Decisions

- 2026-03-08: reproduced against a registry stub that drops the connection after the second blob.

## Verification
