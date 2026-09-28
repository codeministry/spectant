---
repo: quill
derived: 2026-03-04T08:30:00Z
standards_version: none
design_track: none
stack: [bun, typescript]
---

# Constitution — quill

> Derived on 2026-03-04 from the sources listed below. The rules live in those sources; this file says which of them
> bind spec work, where to read them, and what proves them.

## Binding sources

| Source | Kind | Governs |
|--------|------|---------|
| `ISA.md` § Features F0 | repo | notes never leave the machine |

## Non-negotiables

Every rule in the binding sources applies.

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo `ISA.md` | binding | review |

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | — (not defined; no source yet) | before every claim closes |
| quick | `bun test` | at every implementation stop |
| full | — (not defined; no source yet) | before a spec is marked complete |

## How specs are held to it

Every new spec is read against `## Non-negotiables` before its claims are minted.
