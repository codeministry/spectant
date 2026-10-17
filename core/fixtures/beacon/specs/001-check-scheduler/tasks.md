---
spec: 001-check-scheduler
plan: plan.md
updated: 2026-03-04T16:00:00Z
---

# Tasks 001 — Check scheduler

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Tasks

- [x] T1 · ISC-1 · api — a check runs at the interval its definition names, within one second · `api/src/check-scheduler.ts`
- [x] T2 · ISC-2 · api — a check that times out is recorded as down, never as up · `api/src/check-scheduler.ts`
- [x] T3 · ISC-3 · api — two checks on one host never run at the same instant · `api/src/check-scheduler.ts`
