---
repo: lantern
derived: 2026-03-03T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
stack: [bun, typescript, angular]
---

# Constitution — lantern

> Derived on 2026-03-03 from the sources listed below. The rules live in those sources; this file says which of them
> bind spec work, where to read them, and what proves them.

## Binding sources

| Source | Kind | Governs |
|--------|------|---------|
| `CLAUDE.md` | repo | the offline rule, the one lane |
| `ISA.md` § Principles, § Constraints | repo | the reader owns the list, single-page app |

## Non-negotiables

Every rule in the binding sources applies.

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo `CLAUDE.md` | binding | `bun run check:static` |

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | `bun run check:static` | before every claim closes |
| quick | `bun run verify:quick` | at every implementation stop |
| full | `bun run verify` | before a spec is marked complete |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| web | `src/`, `tests/` | `CLAUDE.md` | `bun test` |

## How specs are held to it

Every new spec is read against `## Non-negotiables` before its claims are minted.
