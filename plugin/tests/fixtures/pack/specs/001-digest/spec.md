---
task: "A week of notes becomes one digest"
slug: 001-digest
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F1
stage: build
constitution: ../constitution.md
phase: building
progress: 0/3
started: 2026-03-02T09:00:00Z
updated: 2026-03-04T08:00:00Z
---

# 001 — Digest

## Problem

The notes of a week sit in seven files, and nobody reads them all.

## Goal

A week of notes becomes one digest page
that fits on one screen and keeps every note title, `a | b` included.

## Claims

- [ ] ISC-1: The digest of one week fits on one screen, `<= 40` lines.
- [ ] ISC-2: Every note title of the week appears in the digest. (after: ISC-1)
- [ ] ISC-3: Anti: the digest drops a note whose title repeats an earlier one. (after: ISC-2)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | digest: line budget | `<= 40` lines | `bun test core/ -t "digest"` | derived: one-screen | high |
| ISC-2 | bun-test | digest: every title | all titles present | `bun test core/ -t "digest"` | derived: no-loss | high |
| ISC-3 | bun-test | digest: repeated title | both notes listed | `bun test plugin/ -t "repeat"` | derived: no-loss | high |

## Decisions

- 2026-03-03: The digest is Markdown, not HTML.
- 2026-03-04: ISC-3 counts a repeated title as two notes; T3 keeps both lines.
- 2026-03-04: ISC-3.1 splits off a title that repeats across two weeks.
- 2026-03-04: ISC-30 is a later claim; ISC-1 and ISC-2 stay as written.
- 2026-03-05: The digest renders as one page,
  its title order kept line by line as
  T3 writes it.
- 2026-03-05: T30 and T3x are other tasks.

## Verification
