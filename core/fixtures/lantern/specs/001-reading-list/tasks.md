---
spec: 001-reading-list
plan: plan.md
updated: 2026-03-06T15:00:00Z
---

# Tasks 001 — Reading list

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

- [x] T1 · ISC-3 · [P] · web — save action from the address bar · `src/app/save/`
- [x] T2 · ISC-4 · web — IndexedDB store, list reads it on start (after: T1) · `src/app/store.ts`
- [x] T3 · ISC-5 · web — fetch the page title at save time (after: T1) · `src/app/save/title.ts`
- [x] T4 · ISC-6 · [P] · web — tags stored with the link · `src/app/tags.ts`
- [ ] T5 · ISC-7 · [P] · web — title search · `src/app/search/`
- [ ] T6 · ISC-8 · web — tag search (after: T5) · `src/app/search/tag.ts`
- [ ] T7 · ISC-9 · [P] · web — store the article text and render it offline · `src/app/reader/`
- [ ] T8 · ISC-10 · web — reading view at 390 px (after: T7) · `src/app/reader/reader.css`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1 | ISC-3 | `bun run e2e -- save -g "one step"` |
| T2 | ISC-4 | `bun run e2e -- save -g reload` |
| T3 | ISC-5 | `bun test tests/title.test.ts` |
| T4 | ISC-6 | `bun test tests/tags.test.ts` |
| T5 | ISC-7 | `bun run e2e -- search -g title` |
| T6 | ISC-8 | `bun run e2e -- search -g tag` |
| T7 | ISC-9 | `bun run e2e -- offline -g read` |
| T8 | ISC-10 | `bun run test:browser -- reading` |
