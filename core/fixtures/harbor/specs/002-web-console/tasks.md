---
spec: 002-web-console
plan: plan.md
updated: 2026-03-08T16:45:00Z
---

# Tasks 002 — Web console

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

- [x] T1 · ISC-51 · [seam] · api — history endpoint contract: run, repository, digest, failure · `api/src/history.contract.ts`
- [x] T2 · ISC-51 · web — registry-list: renders (ISC-51) (after: T1) · `web/src/app/registry-list/`
- [x] T3 · ISC-52 · web — repository-view: renders (ISC-52) (after: T1) · `web/src/app/repository-view/`
- [x] T4 · ISC-53 · web — tag-table: renders (ISC-53) (after: T1) · `web/src/app/tag-table/`
- [x] T5 · ISC-54 · web — digest-detail-panel: renders (ISC-54) (after: T1) · `web/src/app/digest-detail-panel/`
- [x] T6 · ISC-55 · web — sync-history: renders (ISC-55) (after: T1) · `web/src/app/sync-history/`
- [x] T7 · ISC-56 · web — settings-page: renders (ISC-56) (after: T1) · `web/src/app/settings-page/`
- [x] T8 · ISC-57 · web — search-box: renders (ISC-57) (after: T1) · `web/src/app/search-box/`
- [x] T9 · ISC-58 · web — empty-state: renders (ISC-58) (after: T1) · `web/src/app/empty-state/`
- [x] T10 · ISC-59 · web — error-banner: renders (ISC-59) (after: T1) · `web/src/app/error-banner/`
- [x] T11 · ISC-60 · web — theme-switch: renders (ISC-60) (after: T1) · `web/src/app/theme-switch/`
- [x] T12 · ISC-60.1 · web — theme-switch: follows the system scheme (ISC-60.1) (after: T1, T11) · `web/src/app/theme-switch/`
- [x] T13 · ISC-60.2 · web — theme-switch: mode survives reload (ISC-60.2) (after: T1, T11) · `web/src/app/theme-switch/`
- [x] T14 · ISC-61 · web — tag-table: no overflow at 390 px (ISC-61) (after: T1) · `web/src/app/tag-table/`
- [x] T15 · ISC-62 · web — digest-detail-panel: no overflow at 390 px (ISC-62) (after: T1) · `web/src/app/digest-detail-panel/`
- [x] T16 · ISC-63 · web — sync-history: no overflow at 390 px (ISC-63) (after: T1) · `web/src/app/sync-history/`
- [x] T17 · ISC-64 · web — settings-page: no overflow at 390 px (ISC-64) (after: T1) · `web/src/app/settings-page/`
- [x] T18 · ISC-65 · web — search-box: no overflow at 390 px (ISC-65) (after: T1) · `web/src/app/search-box/`
- [x] T19 · ISC-66 · web — empty-state: no overflow at 390 px (ISC-66) (after: T1, T18) · `web/src/app/empty-state/`
- [x] T20 · ISC-67 · web — error-banner: no overflow at 390 px (ISC-67) (after: T1) · `web/src/app/error-banner/`
- [x] T21 · ISC-68 · web — theme-switch: no overflow at 390 px (ISC-68) (after: T1) · `web/src/app/theme-switch/`
- [x] T22 · ISC-69 · web — registry-list: keyboard reach and focus ring (ISC-69) (after: T1) · `web/src/app/registry-list/`
- [x] T23 · ISC-70 · web — repository-view: keyboard reach and focus ring (ISC-70) (after: T1) · `web/src/app/repository-view/`
- [x] T24 · ISC-71 · web — tag-table: keyboard reach and focus ring (ISC-71) (after: T1) · `web/src/app/tag-table/`
- [x] T25 · ISC-72 · web — digest-detail-panel: keyboard reach and focus ring (ISC-72) (after: T1) · `web/src/app/digest-detail-panel/`
- [x] T26 · ISC-73 · web — sync-history: keyboard reach and focus ring (ISC-73) (after: T1) · `web/src/app/sync-history/`
- [ ] T27 · ISC-74 · web — settings-page: keyboard reach and focus ring (ISC-74) (after: T1) · `web/src/app/settings-page/`
- [ ] T28 · ISC-75 · web — search-box: keyboard reach and focus ring (ISC-75) (after: T1) · `web/src/app/search-box/`
- [ ] T29 · ISC-76 · web — empty-state: keyboard reach and focus ring (ISC-76) (after: T1) · `web/src/app/empty-state/`
- [x] T30 · ISC-77 · [P] · operator — set up the screen-reader profile on the test device · `tests/manual/screen-reader-setup.md`
- [ ] T31 · ISC-77 · operator — screen-reader pass over the sync history (ISC-77) (after: T1, T30) · `tests/manual/screen-reader.md`
- [ ] T32 · ISC-78 · web — theme-switch: keyboard reach and focus ring (ISC-78) (after: T1, T31) · `web/src/app/theme-switch/`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1, T2 | ISC-51 | `bun run e2e -- registry-list -g render` |
| T3 | ISC-52 | `bun run e2e -- repository-view -g render` |
| T4 | ISC-53 | `bun run e2e -- tag-table -g render` |
| T5 | ISC-54 | `bun run e2e -- digest-detail-panel -g render` |
| T6 | ISC-55 | `bun run e2e -- sync-history -g render` |
| T7 | ISC-56 | `bun run e2e -- settings-page -g render` |
| T8 | ISC-57 | `bun run e2e -- search-box -g render` |
| T9 | ISC-58 | `bun run e2e -- empty-state -g render` |
| T10 | ISC-59 | `bun run e2e -- error-banner -g render` |
| T11 | ISC-60 | `bun run e2e -- theme-switch -g render` |
| T12 | ISC-60.1 | `bun run e2e -- theme-switch -g system` |
| T13 | ISC-60.2 | `bun run e2e -- theme-switch -g persist` |
| T14 | ISC-61 | `bun run e2e -- tag-table -g narrow` |
| T15 | ISC-62 | `bun run e2e -- digest-detail-panel -g narrow` |
| T16 | ISC-63 | `bun run e2e -- sync-history -g narrow` |
| T17 | ISC-64 | `bun run e2e -- settings-page -g narrow` |
| T18 | ISC-65 | `bun run e2e -- search-box -g narrow` |
| T19 | ISC-66 | `bun run e2e -- empty-state -g narrow` |
| T20 | ISC-67 | `bun run e2e -- error-banner -g narrow` |
| T21 | ISC-68 | `bun run e2e -- theme-switch -g narrow` |
| T22 | ISC-69 | `bun run test:browser -- registry-list` |
| T23 | ISC-70 | `bun run test:browser -- repository-view` |
| T24 | ISC-71 | `bun run test:browser -- tag-table` |
| T25 | ISC-72 | `bun run test:browser -- digest-detail-panel` |
| T26 | ISC-73 | `bun run test:browser -- sync-history` |
| T27 | ISC-74 | `bun run test:browser -- settings-page` |
| T28 | ISC-75 | `bun run test:browser -- search-box` |
| T29 | ISC-76 | `bun run test:browser -- empty-state` |
| T30, T31 | ISC-77 | transcript in `.evidence/` |
| T32 | ISC-78 | `bun run test:browser -- theme-switch` |
