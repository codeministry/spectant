---
spec: 004-retention-policies
plan: plan.md
updated: 2026-03-08T12:00:00Z
---

# Tasks 004 — Retention policies

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column via the
constitution's `## Lanes`. `[seam]` = the contract between two lanes; nothing across it runs before it.

## Tasks

- [x] T1 · ISC-95 · api — verdict log for keep-last-N (ISC-95) · `api/src/retention.ts`
- [x] T2 · ISC-96 · api — verdict log for keep-newer-than (ISC-96) · `api/src/retention.ts`
- [x] T3 · ISC-97 · api — verdict log for keep-by-tag-pattern (ISC-97) · `api/src/retention.ts`
- [x] T4 · ISC-98 · api — verdict log for a protected tag (ISC-98) · `api/src/retention.ts`
- [x] T5 · ISC-99 · api — verdict log for an untagged manifest (ISC-99) · `api/src/retention.ts`
- [x] T6 · ISC-100 · api — verdict log for a policy preview (ISC-100) · `api/src/retention.ts`
- [x] T7 · ISC-101 · api — verdict log for a policy conflict (ISC-101) · `api/src/retention.ts`
- [x] T8 · ISC-102 · api — verdict log for a scheduled run (ISC-102) · `api/src/retention.ts`
- [x] T9 · ISC-103 · api — verdict log for a manual run (ISC-103) · `api/src/retention.ts`
- [x] T10 · ISC-104 · api — verdict log for a policy file with comments (ISC-104) · `api/src/retention.ts`
- [x] T11 · ISC-105 · api — referenced manifests deleted for keep-last-N (ISC-105) · `api/src/retention.ts`
- [x] T12 · ISC-106 · api — referenced manifests deleted for keep-newer-than (ISC-106) · `api/src/retention.ts`
- [x] T13 · ISC-107 · api — referenced manifests deleted for keep-by-tag-pattern (ISC-107) · `api/src/retention.ts`
- [x] T14 · ISC-108 · api — referenced manifests deleted for a protected tag (ISC-108) · `api/src/retention.ts`
- [x] T15 · ISC-109 · api — referenced manifests deleted for an untagged manifest (ISC-109) · `api/src/retention.ts`
- [x] T16 · ISC-110 · api — referenced manifests deleted for a policy preview (ISC-110) · `api/src/retention.ts`
- [x] T17 · ISC-111 · api — referenced manifests deleted for a policy conflict (ISC-111) · `api/src/retention.ts`
- [x] T18 · ISC-112 · api — referenced manifests deleted for a scheduled run (ISC-112) · `api/src/retention.ts`
- [x] T19 · ISC-113 · api — referenced manifests deleted for a manual run (ISC-113) · `api/src/retention.ts`
- [x] T20 · ISC-114 · api — referenced manifests deleted for a policy file with comments (ISC-114) · `api/src/retention.ts`
- [x] T21 · ISC-115 · web — preview shown for keep-last-N (ISC-115) (after: T1) · `web/src/app/retention/`
- [x] T22 · ISC-116 · web — preview shown for keep-newer-than (ISC-116) (after: T2) · `web/src/app/retention/`
- [x] T23 · ISC-117 · web — preview shown for keep-by-tag-pattern (ISC-117) (after: T3) · `web/src/app/retention/`
- [x] T24 · ISC-118 · web — preview shown for a protected tag (ISC-118) (after: T4) · `web/src/app/retention/`
- [x] T25 · ISC-119 · web — preview shown for an untagged manifest (ISC-119) (after: T5) · `web/src/app/retention/`
- [x] T26 · ISC-120 · web — preview shown for a policy preview (ISC-120) (after: T6) · `web/src/app/retention/`
- [x] T27 · ISC-121 · web — preview shown for a policy conflict (ISC-121) (after: T7) · `web/src/app/retention/`
- [x] T28 · ISC-122 · web — preview shown for a scheduled run (ISC-122) (after: T8) · `web/src/app/retention/`
- [x] T29 · ISC-123 · web — preview shown for a manual run (ISC-123) (after: T9) · `web/src/app/retention/`
- [x] T30 · ISC-124 · web — preview shown for a policy file with comments (ISC-124) (after: T10) · `web/src/app/retention/`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1 | ISC-95 | `bun test tests/retention.test.ts -t "keep-last-N"` |
| T2 | ISC-96 | `bun test tests/retention.test.ts -t "keep-newer-than"` |
| T3 | ISC-97 | `bun test tests/retention.test.ts -t "keep-by-tag-pattern"` |
| T4 | ISC-98 | `bun test tests/retention.test.ts -t "a protected tag"` |
| T5 | ISC-99 | `bun test tests/retention.test.ts -t "an untagged manifest"` |
| T6 | ISC-100 | `bun test tests/retention.test.ts -t "a policy preview"` |
| T7 | ISC-101 | `bun test tests/retention.test.ts -t "a policy conflict"` |
| T8 | ISC-102 | `bun test tests/retention.test.ts -t "a scheduled run"` |
| T9 | ISC-103 | `bun test tests/retention.test.ts -t "a manual run"` |
| T10 | ISC-104 | `bun test tests/retention.test.ts -t "a policy file with comments"` |
| T11 | ISC-105 | `bun test tests/retention.test.ts -t "keep-last-N"` |
| T12 | ISC-106 | `bun test tests/retention.test.ts -t "keep-newer-than"` |
| T13 | ISC-107 | `bun test tests/retention.test.ts -t "keep-by-tag-pattern"` |
| T14 | ISC-108 | `bun test tests/retention.test.ts -t "a protected tag"` |
| T15 | ISC-109 | `bun test tests/retention.test.ts -t "an untagged manifest"` |
| T16 | ISC-110 | `bun test tests/retention.test.ts -t "a policy preview"` |
| T17 | ISC-111 | `bun test tests/retention.test.ts -t "a policy conflict"` |
| T18 | ISC-112 | `bun test tests/retention.test.ts -t "a scheduled run"` |
| T19 | ISC-113 | `bun test tests/retention.test.ts -t "a manual run"` |
| T20 | ISC-114 | `bun test tests/retention.test.ts -t "a policy file with comments"` |
| T21 | ISC-115 | `bun run e2e -- retention -g "preview 1"` |
| T22 | ISC-116 | `bun run e2e -- retention -g "preview 2"` |
| T23 | ISC-117 | `bun run e2e -- retention -g "preview 3"` |
| T24 | ISC-118 | `bun run e2e -- retention -g "preview 4"` |
| T25 | ISC-119 | `bun run e2e -- retention -g "preview 5"` |
| T26 | ISC-120 | `bun run e2e -- retention -g "preview 6"` |
| T27 | ISC-121 | `bun run e2e -- retention -g "preview 7"` |
| T28 | ISC-122 | `bun run e2e -- retention -g "preview 8"` |
| T29 | ISC-123 | `bun run e2e -- retention -g "preview 9"` |
| T30 | ISC-124 | `bun run e2e -- retention -g "preview 10"` |
