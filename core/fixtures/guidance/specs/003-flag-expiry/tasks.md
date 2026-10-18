---
spec: 003-flag-expiry
plan: plan.md
updated: 2026-03-04T08:00:00Z
---

# Tasks 003 — Flag expiry

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Tasks

- [ ] T1 · ISC-7 · api — a flag carries an optional expiry date · `api/src/flag-expiry.ts`
- [ ] T2 · ISC-8 · api — an expired flag is listed on the clean-up page · `api/src/flag-expiry.ts`
- [ ] T3 · ISC-9 · api — an expired flag keeps serving its last value · `api/src/flag-expiry.ts`
