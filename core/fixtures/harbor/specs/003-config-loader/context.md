---
spec: 003-config-loader
created: 2026-03-06T09:00:00Z
updated: 2026-03-09T17:30:00Z
rounds: 1
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 003 — Config loader rewrite

## Goal — confirmed 2026-03-06T09:00:00Z
The CLI, the API and the console read their configuration through one loader, and the effective config for every
case in the snapshot corpus is unchanged.

## Round 1 — no gaps the repo could not close, 2026-03-06T09:00:00Z
