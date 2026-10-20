---
project: quill
progress: 0/5
---

# Quill

## Goal

The notes of a week become one page a reader takes in at a glance.

## Features

### F1 · Digest
Why: the notes of a week become one page.

- [ ] ISC-1: The digest of one week fits on one screen, `<= 40` lines.
- [ ] ISC-2: Every note title of the week appears in the digest. (after: ISC-1)
- [ ] ISC-3: Anti: the digest drops a note whose title repeats an earlier one. (after: ISC-2)

### F2 · Archive
Why: an old digest stays findable.

- [ ] ISC-4: An archived digest keeps its week number in its file name.
- [ ] ISC-5: Anti: archiving a digest rewrites a note. (after: ISC-4)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | digest: line budget | `<= 40` lines | `bun test core/ -t "digest"` | derived: one-screen | high |
| ISC-2 | bun-test | digest: every title | all titles present | `bun test core/ -t "digest"` | derived: no-loss | high |
| ISC-3 | bun-test | digest: repeated title | both notes listed | `bun test plugin/ -t "repeat"` | derived: no-loss | high |
| ISC-4 | bun-test | archive: file name | week number in the name | `bun test core/ -t "archive"` | derived: findable | medium |
| ISC-5 | bun-test | archive: notes untouched | byte-identical notes | `bun test plugin/ -t "archive"` | derived: no-loss | high |

## Decisions

- 2026-03-01: The digest and the archive ship as two specs.
- 2026-03-02: ISC-3 and T3 settle repeated titles in the master ledger.

## Verification
