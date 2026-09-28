---
task: "Stop duplicate links and duplicate tags from entering the list"
slug: 002-duplicate-links
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F1
constitution: ../constitution.md
phase: scoping
progress: 0/2
started: 2026-03-06T10:00:00Z
updated: 2026-03-06T11:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F1). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 002-duplicate-links"). Never edit the master from this file. -->

# 002 — Duplicate links and tags

## Problem

Saving a link that is already on the list adds a second entry, and a tag typed with a trailing space becomes a
second tag that search does not find.

## Goal

Saving a known link or a known tag again changes nothing in the list.

## Claims

- [ ] ISC-11: Anti: saving the same link twice creates a second entry.
- [ ] ISC-12: Anti: a tag with a trailing space is stored as a second, different tag.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-11 | bun-test | saving the same link twice | 1 entry | `bun test tests/save.test.ts -t duplicate` | literal | |
| ISC-12 | e2e | tag with a trailing space | 1 tag | `bun run e2e -- tags -g trim` | literal | |

## Decisions

- 2026-03-06: reproduced on the save action and the tag input; both attach to F1.

## Verification
