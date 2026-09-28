---
spec: 003-config-loader
type: refactor
status: draft
updated: 2026-03-06
---

# Plan 003 — Config loader rewrite

**Purpose:** how the claims in `spec.md` get built. The what lives there; this file holds no acceptance criterion.

## Approach

Snapshot the effective config for every case first, then move each package onto the shared loader one at a time. Rewriting all three at once would leave no working reference to compare against.

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
| `cli/src/config.ts` | becomes the shared loader | ISC-81 |
| `api/src/config.ts` | removed; imports the shared loader | ISC-83 |

## Risks

| Risk | Blast radius | Early warning | Mitigation |
|------|--------------|---------------|------------|
| a package reads a key the snapshot never covered | one package | parity test gap | grep for every key before the move |
