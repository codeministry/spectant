---
spec: 001-manifest-sync
type: feature
status: approved
updated: 2026-03-02
---

# Plan 001 — Manifest sync

**Purpose:** how the claims in `spec.md` get built. The what lives there; this file holds no acceptance criterion.

## Approach

Copy blobs first and the manifest last, keyed on digest, so an interrupted run leaves nothing half-written. The obvious tag-keyed copy would re-upload whenever an upstream tag moved.

```mermaid
flowchart LR
    A[read config] --> B[resolve digests]
    B --> C[copy missing blobs]
    C --> D[push manifest]
    D --> E[append history]
```

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
| `cli/src/sync.ts` | new: the sync command | ISC-5 |
| `cli/src/registry.ts` | new: registry client with retry | ISC-14 |

## Risks

| Risk | Blast radius | Early warning | Mitigation |
|------|--------------|---------------|------------|
| rate limits on the source | one run | 429 in the log | back off and resume |
