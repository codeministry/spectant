---
spec: 003-flag-expiry
type: feature
status: approved
updated: 2026-03-04T08:00:00Z
---

# Plan 003 — Flag expiry

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
| `api/src/flag-expiry.ts` | new | ISC-7 |
| `api/src/flag-expiry.ts` | new | ISC-8 |
| `api/src/flag-expiry.ts` | new | ISC-9 |
