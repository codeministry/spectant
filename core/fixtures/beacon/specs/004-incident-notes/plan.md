---
spec: 004-incident-notes
type: feature
status: approved
updated: 2026-03-07T15:00:00Z
---

# Plan 004 — Incident notes

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
| `api/src/incident-notes.ts` | new | ISC-10 |
| `api/src/incident-notes.ts` | new | ISC-11 |
| `api/src/incident-notes.ts` | new | ISC-12 |
