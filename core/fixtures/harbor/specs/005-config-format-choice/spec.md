---
task: "Decide which config format version 2 uses"
slug: 005-config-format-choice
spec_type: spike
isa_master: ../../ISA.md
isa_feature: F3
constitution: ../constitution.md
phase: scoping
progress: 0/1
started: 2026-03-07T13:00:00Z
updated: 2026-03-07T14:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F3). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 005-config-format-choice"). Never edit the master from this file. -->

# 005 — Config format choice

## Problem

The rewrite in spec 003 keeps today's format. Version 2 needs includes and comments that survive a round trip,
and nobody has compared the candidates yet.

## Goal

A recorded decision names the config format for version 2 and the one trade-off that decided it.

## Not yet specified

- fog: whether includes are resolved relative to the including file or to the working directory — needs one real multi-repository config
- fog: whether a comment-preserving writer is required at all — depends on whether the console ever edits the config

## Claims

- [ ] ISC-94: Antecedent: the config format for version 2 is chosen and recorded as a decision.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-94 | manual | decision row for the config format | present | review of `ISA.md` § Decisions | derived: one-config-path |  |

## Decisions

- 2026-03-07: opened; the decision this spike makes possible is the loader's input format.

## Verification
