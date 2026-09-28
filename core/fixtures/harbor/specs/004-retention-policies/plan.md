---
spec: 004-retention-policies
type: feature
status: approved
updated: 2026-03-04
---

# Plan 004 — Retention policies

**Purpose:** how the claims in `spec.md` get built. The what lives there; this file holds no acceptance criterion.

## Approach

Evaluate policies into a preview first and delete only from a confirmed preview. Deleting inline while evaluating would make the preview a guess.

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
| `api/src/retention.ts` | new: policy evaluation and preview | ISC-95 |
| `web/src/app/retention/` | new: the preview view | ISC-115 |

## Risks

| Risk | Blast radius | Early warning | Mitigation |
|------|--------------|---------------|------------|
| a tag moves between preview and run | one manifest | digest mismatch at delete | re-check references at delete time |
