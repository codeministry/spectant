---
spec: 001-check-scheduler
type: feature
status: approved
updated: 2026-03-04T16:00:00Z
---

# Plan 001 — Check scheduler

**Purpose:** how the claims in `spec.md` get built. The what lives there; this file holds no acceptance criterion.

## Approach

One module per concern, behind the API; the status page reads the store and never the agents.

```mermaid
flowchart LR
  scheduler --> agent --> store --> page
```

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
| `api/src/check-scheduler.ts` | new | ISC-1 |
| `api/src/check-scheduler.ts` | new | ISC-2 |
| `api/src/check-scheduler.ts` | new | ISC-3 |
