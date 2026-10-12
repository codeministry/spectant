---
task: "Find the largest blob chunk each target registry accepts"
slug: 009-chunked-upload-limits
spec_type: spike
isa_master: ../../ISA.md
isa_feature: F6
constitution: ../constitution.md
phase: building
progress: 1/2
started: 2026-03-08T13:30:00Z
updated: 2026-03-09T09:30:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F6). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 009-chunked-upload-limits"). Never edit the master from this file. -->

# 009 — Chunked upload limits

## Problem

Large layers are uploaded in chunks, and each registry has its own upper limit. A chunk over the limit fails the push
halfway, which is exactly the half-written state F0 forbids.

## Goal

A recorded table names each target registry's chunk limit, and Harbor never picks a chunk larger than it.

## Claims

- [x] ISC-130: A recorded table names the largest chunk each target registry in the test matrix accepts in a chunked blob upload.
- [ ] ISC-131: Anti: Harbor picks a chunk size for a registry that is larger than the limit the spike recorded for it. (after: ISC-130)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-130 | bash | registries listed in the chunk probe output | 4 rows | `bun run cli -- probe chunks --matrix tests/registries.toml` | literal |  |
| ISC-131 | bun-test | chunk size chosen per registry against the recorded limit | 0 over the limit | `bun test tests/chunks.test.ts -t "limit"` | derived: atomic-push | high |

## Decisions

- 2026-03-08: opened; a push that picks one chunk size for every registry fails on the strictest one.

## Verification

- ISC-130: `bun run cli -- probe chunks --matrix tests/registries.toml` passed, 2026-03-09
