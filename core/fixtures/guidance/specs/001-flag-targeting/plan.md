---
spec: 001-flag-targeting
type: feature
status: approved
updated: 2026-03-05T12:00:00Z
---

# Plan 001 — Flag targeting

**Purpose:** how the claims in `spec.md` get built. The what lives there; this file holds no acceptance criterion.

## Approach

One module per concern, behind the API; the SDKs read a snapshot and never the store.

```mermaid
flowchart LR
  console --> api --> store --> sdk
```

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
| `api/src/flag-targeting.ts` | new | ISC-1 |
| `api/src/flag-targeting.ts` | new | ISC-2 |
| `api/src/flag-targeting.ts` | new | ISC-3 |
