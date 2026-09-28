---
spec: 001-manifest-sync
created: 2026-03-02T09:00:00Z
updated: 2026-03-05T15:00:00Z
rounds: 1
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 001 — Manifest sync

## Goal — confirmed 2026-03-02T09:00:00Z
`harbor sync` mirrors every listed manifest with an identical digest, and a second run uploads nothing.

## Round 1 — no gaps the repo could not close, 2026-03-02T09:00:00Z
