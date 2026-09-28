---
task: "Turn meeting notes into a weekly digest with Quill"
slug: 20260304-quill
project: quill
phase: scoping
progress: 0/3
started: 2026-03-04T08:00:00Z
updated: 2026-03-04T09:00:00Z
---

# Quill

## Problem

Meeting notes pile up in one folder and nobody reads them again after the week they were written.

## Goal

Every Monday, the notes of the week before become one digest that fits on one screen.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | notes read from the configured folder | all files | `bun test tests/read.test.ts` | literal | |
| ISC-2 | bun-test | digest length | at most 60 lines | `bun test tests/digest.test.ts -t length` | derived: one-screen | |
| ISC-3 | bun-test | outbound requests during a digest run | 0 | `bun test tests/offline.test.ts` | derived: local-only | high |

## Features

### F0 · Cross-cutting
Why: notes stay on the machine they were written on.

- [ ] ISC-3: Anti: building a digest makes an outbound network request.

### F1 · Weekly digest
Why: last week's notes are read at least once, in one sitting.

- [ ] ISC-1: Every note file in the configured folder from the week before is read.
- [ ] ISC-2: The digest fits in 60 lines. (after: ISC-1)

## Decisions

- 2026-03-04: no spec yet; the master is scoped first.
