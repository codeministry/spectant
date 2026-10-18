---
spec: 005-probe-agents
type: feature
status: approved
updated: 2026-03-08T14:14:00Z
---

# Plan 005 — Probe agents

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
| `api/src/probe-agents.ts` | new | ISC-13 |
| `api/src/probe-agents.ts` | new | ISC-14 |
| `api/src/probe-agents.ts` | new | ISC-15 |
| `api/src/probe-agents.ts` | new | ISC-16 |
| `api/src/probe-agents.ts` | new | ISC-17 |
| `api/src/probe-agents.ts` | new | ISC-18 |
| `api/src/probe-agents.ts` | new | ISC-19 |
