---
spec: 006-partial-push
created: 2026-03-08T09:00:00Z
updated: 2026-03-09T10:15:00Z
rounds: 1
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 006 — Partial push after a timeout

## Goal — confirmed 2026-03-08T09:00:00Z
A push interrupted at any point leaves the target registry exactly as it was before the push started.

## Round 1 — no gaps the repo could not close, 2026-03-08T09:00:00Z
