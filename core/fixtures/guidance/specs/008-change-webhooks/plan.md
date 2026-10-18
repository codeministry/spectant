---
spec: 008-change-webhooks
type: feature
status: approved
updated: 2026-03-04T14:00:00Z
---

# Plan 008 — Change webhooks

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
| `api/src/change-webhooks.ts` | new | ISC-20 |
| `api/src/change-webhooks.ts` | new | ISC-21 |
| `api/src/change-webhooks.ts` | new | ISC-22 |
