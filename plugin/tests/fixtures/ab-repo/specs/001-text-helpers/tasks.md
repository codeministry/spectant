---
spec: 001-text-helpers
plan: plan.md
updated: 2026-05-11
---

# Tasks 001 — Text helpers

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Tasks

- [ ] T1 · ISC-1 · [P] · lib — `slugify` with its test · `src/slugify.ts`, `src/slugify.test.ts`
- [ ] T2 · ISC-2 · [P] · lib — `truncate` with its test · `src/truncate.ts`, `src/truncate.test.ts`
- [ ] T3 · ISC-3 · [P] · lib — `titleCase` with its test · `src/titlecase.ts`, `src/titlecase.test.ts`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1 | ISC-1 | `bun test src/slugify.test.ts` |
| T2 | ISC-2 | `bun test src/truncate.test.ts` |
| T3 | ISC-3 | `bun test src/titlecase.test.ts` |
