---
spec: 005-probe-agents
plan: plan.md
updated: 2026-03-08T14:14:00Z
---

# Tasks 005 — Probe agents

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from `spec.md`. This file defines
nothing, it decomposes.

## Tasks

- [x] T1 · ISC-13 · api — a probe agent registers with a one-time token · `api/src/probe-agents.ts`
- [x] T2 · ISC-14 · api — a registered agent reports its results over one connection · `api/src/probe-agents.ts`
- [ ] T3 · ISC-15 · api — an agent that stops reporting is shown as silent within two intervals · `api/src/probe-agents.ts`
- [ ] T4 · ISC-16 · api — a check can be pinned to one region's agents · `api/src/probe-agents.ts`
- [ ] T5 · ISC-18 · api — sign agent results · `api/src/probe-agents.ts`
- [ ] T6 · ISC-18 · api — reject results with a failed signature · `api/src/probe-agents.ts`
- [ ] T7 · ISC-17 · api — drop results of a revoked agent (after: T5) · `api/src/probe-agents.ts`
- ~~T8 · ISC-19 · api — agent self-update channel · `api/src/probe-agents.ts`~~ — dropped with ISC-19, see Decisions 2026-03-07
