---
task: "Keep a reading list that works offline with Lantern"
slug: 20260303-lantern
project: lantern
phase: climbing
progress: 4/12
started: 2026-03-03T08:00:00Z
updated: 2026-03-06T15:00:00Z
---

# Lantern

## Problem

Saved articles live in browser tabs and chat threads. They are gone when the tab closes and unreadable on a train.

## Vision

A reader saves a link once and finds it again later, on any device, with or without a connection.

## Out of Scope

- Sharing lists with other readers.

## Principles

- The reader's list belongs to the reader; nothing is sent anywhere without a sync the reader started.

## Constraints

- Bun and TypeScript; the app is a single-page web app.

## Goal

A reader saves a link in one step, finds it again by title or tag, and reads it offline.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | outbound requests without a started sync | 0 | `bun test tests/offline.test.ts` | derived: reader-owns-list | high |
| ISC-2 | bash | leak classes in tracked files | 0 hits | `bun run check:leak` | literal | |
| ISC-3 | e2e | save a link from the address bar | 1 step | `bun run e2e -- save -g "one step"` | literal | |
| ISC-4 | e2e | saved link listed after reload | listed | `bun run e2e -- save -g reload` | literal | |
| ISC-5 | bun-test | title fetched for a saved link | title set | `bun test tests/title.test.ts` | literal | |
| ISC-6 | bun-test | tags stored with a link | round-trip | `bun test tests/tags.test.ts` | literal | |
| ISC-7 | e2e | search by title narrows the list | only matches | `bun run e2e -- search -g title` | derived: find-again | |
| ISC-8 | e2e | search by tag narrows the list | only matches | `bun run e2e -- search -g tag` | derived: find-again | |
| ISC-9 | e2e | saved article readable offline | text shown | `bun run e2e -- offline -g read` | derived: read-offline | |
| ISC-10 | browser | reading view at 390 px | no horizontal overflow | `bun run test:browser -- reading` | derived: read-offline | |
| ISC-11 | bun-test | saving the same link twice | 1 entry | `bun test tests/save.test.ts -t duplicate` | literal | |
| ISC-12 | e2e | tag with a trailing space | 1 tag | `bun run e2e -- tags -g trim` | literal | |

## Features

### F0 · Cross-cutting
Why: what would break the reader's trust whichever feature slipped — data leaving the device or a private detail in the repository.

- [ ] ISC-1: Anti: the app makes an outbound request that no sync the reader started asked for.
- [ ] ISC-2: Anti: a tracked file contains an absolute home path or personal data.

### F1 · Reading list
Why: a link saved once is found again later and can be read without a connection.

- [x] ISC-3: A link is saved from the address bar in one step.
- [x] ISC-4: A saved link is still listed after a reload. (after: ISC-3)
- [x] ISC-5: A saved link gets the page title fetched at save time. (after: ISC-3)
- [x] ISC-6: Tags are stored with a link and restored with it.
- [ ] ISC-7: Typing in the search box narrows the list to titles that match.
- [ ] ISC-8: Typing a tag narrows the list to links carrying it. (after: ISC-7)
- [ ] ISC-9: A saved article's text is readable with the network switched off.
- [ ] ISC-10: The reading view has no horizontal overflow at 390 px. (after: ISC-9)
- [ ] ISC-11: Anti: saving the same link twice creates a second entry.
- [ ] ISC-12: Anti: a tag with a trailing space is stored as a second, different tag.

## Decisions

- 2026-03-03: two features only; sharing stays out of scope.
- 2026-03-06: the duplicate and tag-trim bugs attach to F1, whose promise they break.

## Verification

- ISC-3: `bun run e2e -- save -g "one step"` passed, 2026-03-05
- ISC-4: `bun run e2e -- save -g reload` passed, 2026-03-05
- ISC-5: `bun test tests/title.test.ts` passed, 2026-03-05
- ISC-6: `bun test tests/tags.test.ts` passed, 2026-03-06
