---
spec: 005-sdk-rollout
plan: plan.md
updated: 2026-03-07T10:00:00Z
---

# Tasks 005 — SDK rollout

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Tasks

- [x] T1 · ISC-12 · api — evaluate flags from one snapshot in the server sdk · `api/src/sdk-rollout.ts`
- [ ] T2 · ISC-13 · sdk — reload the browser snapshot on a change event · `sdk/src/sdk-rollout.ts`
- [ ] T3 · ISC-13 · operator — add the staging sdk key to the ci secrets · `ops/sdk-rollout.md`
- [ ] T4 · ISC-14 · sdk — roll the sdk out to the staging tenant · `sdk/src/sdk-rollout.ts`
