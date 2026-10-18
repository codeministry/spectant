---
spec: 001-flag-targeting
plan: plan.md
updated: 2026-03-05T12:00:00Z
---

# Tasks 001 — Flag targeting

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Tasks

- [ ] T1 · ISC-1 · api — a flag rule targets users by attribute, within one evaluation · `api/src/flag-targeting.ts`
- [ ] T2 · ISC-2 · api — a rule with an unknown attribute is refused when saved · `api/src/flag-targeting.ts`
- [ ] T3 · ISC-3 · api — anti: a disabled rule still matches a user · `api/src/flag-targeting.ts`
