---
spec: 001-manifest-sync
plan: plan.md
updated: 2026-03-05T15:00:00Z
---

# Tasks 001 — Manifest sync

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

- [x] T1 · ISC-5 · cli — make ISC-5 pass: digest equality for case 1 · `cli/src/sync.ts`
- [x] T2 · ISC-6 · cli — make ISC-6 pass: digest equality for case 2 (after: T1) · `cli/src/sync.ts`
- [x] T3 · ISC-7 · cli — make ISC-7 pass: digest equality for case 3 · `cli/src/sync.ts`
- [x] T4 · ISC-8 · cli — make ISC-8 pass: digest equality for case 4 · `cli/src/sync.ts`
- [x] T5 · ISC-9 · cli — make ISC-9 pass: digest equality for case 5 · `cli/src/sync.ts`
- [x] T6 · ISC-10 · cli — make ISC-10 pass: digest equality for case 6 · `cli/src/sync.ts`
- [x] T7 · ISC-11 · cli — make ISC-11 pass: digest equality for case 7 (after: T6) · `cli/src/sync.ts`
- [x] T8 · ISC-12 · cli — make ISC-12 pass: digest equality for case 8 · `cli/src/sync.ts`
- [x] T9 · ISC-13 · cli — make ISC-13 pass: digest equality for case 9 · `cli/src/sync.ts`
- [x] T10 · ISC-14 · cli — make ISC-14 pass: digest equality for case 10 · `cli/src/sync.ts`
- [x] T11 · ISC-15 · cli — make ISC-15 pass: digest equality for case 11 · `cli/src/sync.ts`
- [x] T12 · ISC-16 · cli — make ISC-16 pass: digest equality for case 12 (after: T11) · `cli/src/sync.ts`
- [x] T13 · ISC-17 · cli — make ISC-17 pass: dry-run writes for case 1 · `cli/src/dry-run.ts`
- [x] T14 · ISC-18 · cli — make ISC-18 pass: dry-run writes for case 2 · `cli/src/dry-run.ts`
- [x] T15 · ISC-19 · cli — make ISC-19 pass: dry-run writes for case 3 · `cli/src/dry-run.ts`
- [x] T16 · ISC-20 · cli — make ISC-20 pass: dry-run writes for case 4 · `cli/src/dry-run.ts`
- [x] T17 · ISC-21 · cli — make ISC-21 pass: dry-run writes for case 5 (after: T16) · `cli/src/dry-run.ts`
- [x] T18 · ISC-22 · cli — make ISC-22 pass: dry-run writes for case 6 · `cli/src/dry-run.ts`
- [x] T19 · ISC-23 · cli — make ISC-23 pass: dry-run writes for case 7 · `cli/src/dry-run.ts`
- [x] T20 · ISC-24 · cli — make ISC-24 pass: dry-run writes for case 8 · `cli/src/dry-run.ts`
- [x] T21 · ISC-25 · cli — make ISC-25 pass: dry-run writes for case 9 · `cli/src/dry-run.ts`
- [x] T22 · ISC-26 · cli — make ISC-26 pass: dry-run writes for case 10 (after: T21) · `cli/src/dry-run.ts`
- [x] T23 · ISC-27 · cli — make ISC-27 pass: dry-run writes for case 11 · `cli/src/dry-run.ts`
- [x] T24 · ISC-28 · cli — make ISC-28 pass: dry-run writes for case 12 · `cli/src/dry-run.ts`
- [x] T25 · ISC-29 · cli — make ISC-29 pass: bytes uploaded on re-run for case 1 · `cli/src/sync.ts`
- [x] T26 · ISC-30 · cli — make ISC-30 pass: bytes uploaded on re-run for case 2 · `cli/src/sync.ts`
- [x] T27 · ISC-31 · cli — make ISC-31 pass: bytes uploaded on re-run for case 3 (after: T26) · `cli/src/sync.ts`
- [x] T28 · ISC-32 · cli — make ISC-32 pass: bytes uploaded on re-run for case 4 · `cli/src/sync.ts`
- [x] T29 · ISC-33 · cli — make ISC-33 pass: bytes uploaded on re-run for case 5 · `cli/src/sync.ts`
- [x] T30 · ISC-34 · cli — make ISC-34 pass: bytes uploaded on re-run for case 6 · `cli/src/sync.ts`
- [x] T31 · ISC-35 · cli — make ISC-35 pass: bytes uploaded on re-run for case 7 · `cli/src/sync.ts`
- [x] T32 · ISC-36 · cli — make ISC-36 pass: bytes uploaded on re-run for case 8 (after: T31) · `cli/src/sync.ts`
- [x] T33 · ISC-37 · cli — make ISC-37 pass: bytes uploaded on re-run for case 9 · `cli/src/sync.ts`
- [x] T34 · ISC-38 · cli — make ISC-38 pass: bytes uploaded on re-run for case 10 · `cli/src/sync.ts`
- [x] T35 · ISC-39 · cli — make ISC-39 pass: bytes uploaded on re-run for case 11 · `cli/src/sync.ts`
- [x] T36 · ISC-40 · cli — make ISC-40 pass: bytes uploaded on re-run for case 12 · `cli/src/sync.ts`
- [x] T37 · ISC-41 · cli — make ISC-41 pass: log line fields for case 1 (after: T36) · `cli/src/sync.ts`
- [x] T38 · ISC-42 · cli — make ISC-42 pass: log line fields for case 2 · `cli/src/sync.ts`
- [x] T39 · ISC-43 · cli — make ISC-43 pass: log line fields for case 3 · `cli/src/sync.ts`
- [x] T40 · ISC-44 · cli — make ISC-44 pass: log line fields for case 4 · `cli/src/sync.ts`
- [x] T41 · ISC-45 · cli — make ISC-45 pass: log line fields for case 5 · `cli/src/sync.ts`
- [x] T42 · ISC-46 · cli — make ISC-46 pass: log line fields for case 6 (after: T41) · `cli/src/sync.ts`
- [x] T43 · ISC-47 · cli — make ISC-47 pass: log line fields for case 7 · `cli/src/sync.ts`
- [x] T44 · ISC-48 · cli — make ISC-48 pass: log line fields for case 8 · `cli/src/sync.ts`
- [x] T45 · ISC-49 · cli — make ISC-49 pass: log line fields for case 9 · `cli/src/sync.ts`
- [x] T46 · ISC-50 · cli — make ISC-50 pass: log line fields for case 10 · `cli/src/sync.ts`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1 | ISC-5 | `bun test tests/sync.test.ts -t "case 5"` |
| T2 | ISC-6 | `bun test tests/sync.test.ts -t "case 6"` |
| T3 | ISC-7 | `bun test tests/sync.test.ts -t "case 7"` |
| T4 | ISC-8 | `bun test tests/sync.test.ts -t "case 8"` |
| T5 | ISC-9 | `bun test tests/sync.test.ts -t "case 9"` |
| T6 | ISC-10 | `bun test tests/sync.test.ts -t "case 10"` |
| T7 | ISC-11 | `bun test tests/sync.test.ts -t "case 11"` |
| T8 | ISC-12 | `bun test tests/sync.test.ts -t "case 12"` |
| T9 | ISC-13 | `bun test tests/sync.test.ts -t "case 13"` |
| T10 | ISC-14 | `bun test tests/sync.test.ts -t "case 14"` |
| T11 | ISC-15 | `bun test tests/sync.test.ts -t "case 15"` |
| T12 | ISC-16 | `bun test tests/sync.test.ts -t "case 16"` |
| T13 | ISC-17 | `bun run cli -- sync --dry-run --case 1 \| rg -c PUSH` |
| T14 | ISC-18 | `bun run cli -- sync --dry-run --case 2 \| rg -c PUSH` |
| T15 | ISC-19 | `bun run cli -- sync --dry-run --case 3 \| rg -c PUSH` |
| T16 | ISC-20 | `bun run cli -- sync --dry-run --case 4 \| rg -c PUSH` |
| T17 | ISC-21 | `bun run cli -- sync --dry-run --case 5 \| rg -c PUSH` |
| T18 | ISC-22 | `bun run cli -- sync --dry-run --case 6 \| rg -c PUSH` |
| T19 | ISC-23 | `bun run cli -- sync --dry-run --case 7 \| rg -c PUSH` |
| T20 | ISC-24 | `bun run cli -- sync --dry-run --case 8 \| rg -c PUSH` |
| T21 | ISC-25 | `bun run cli -- sync --dry-run --case 9 \| rg -c PUSH` |
| T22 | ISC-26 | `bun run cli -- sync --dry-run --case 10 \| rg -c PUSH` |
| T23 | ISC-27 | `bun run cli -- sync --dry-run --case 11 \| rg -c PUSH` |
| T24 | ISC-28 | `bun run cli -- sync --dry-run --case 12 \| rg -c PUSH` |
| T25 | ISC-29 | `bun test tests/sync.test.ts -t "case 29"` |
| T26 | ISC-30 | `bun test tests/sync.test.ts -t "case 30"` |
| T27 | ISC-31 | `bun test tests/sync.test.ts -t "case 31"` |
| T28 | ISC-32 | `bun test tests/sync.test.ts -t "case 32"` |
| T29 | ISC-33 | `bun test tests/sync.test.ts -t "case 33"` |
| T30 | ISC-34 | `bun test tests/sync.test.ts -t "case 34"` |
| T31 | ISC-35 | `bun test tests/sync.test.ts -t "case 35"` |
| T32 | ISC-36 | `bun test tests/sync.test.ts -t "case 36"` |
| T33 | ISC-37 | `bun test tests/sync.test.ts -t "case 37"` |
| T34 | ISC-38 | `bun test tests/sync.test.ts -t "case 38"` |
| T35 | ISC-39 | `bun test tests/sync.test.ts -t "case 39"` |
| T36 | ISC-40 | `bun test tests/sync.test.ts -t "case 40"` |
| T37 | ISC-41 | `bun test tests/sync.test.ts -t "case 41"` |
| T38 | ISC-42 | `bun test tests/sync.test.ts -t "case 42"` |
| T39 | ISC-43 | `bun test tests/sync.test.ts -t "case 43"` |
| T40 | ISC-44 | `bun test tests/sync.test.ts -t "case 44"` |
| T41 | ISC-45 | `bun test tests/sync.test.ts -t "case 45"` |
| T42 | ISC-46 | `bun test tests/sync.test.ts -t "case 46"` |
| T43 | ISC-47 | `bun test tests/sync.test.ts -t "case 47"` |
| T44 | ISC-48 | `bun test tests/sync.test.ts -t "case 48"` |
| T45 | ISC-49 | `bun test tests/sync.test.ts -t "case 49"` |
| T46 | ISC-50 | `bun test tests/sync.test.ts -t "case 50"` |
