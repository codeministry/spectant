---
spec: 002-audit-trail
plan: plan.md
updated: 2026-03-06T09:00:00Z
---

# Tasks 002 — Audit trail

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Tasks

- [ ] T1 · ISC-4 · api — every flag change is recorded with its actor and time · `api/src/audit-trail.ts`
- [ ] T2 · ISC-5 · api — the audit trail lists changes newest first · `api/src/audit-trail.ts`
- [ ] T3 · ISC-6 · api — anti: a change is recorded without its actor · `api/src/audit-trail.ts`
