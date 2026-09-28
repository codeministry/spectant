---
repo: harbor
derived: 2026-03-02T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
dev_services: 4200=Web dev, 8080=API
stack: [bun, typescript, angular]
---

# Constitution — harbor

> Derived on 2026-03-02 from the sources listed below. The rules live in those sources; this file says which of them
> bind spec work, where to read them, and what proves them.

## Binding sources

| Source | Kind | Governs |
|--------|------|---------|
| `CLAUDE.md` (root and nested) | repo | lanes, the loopback rule, redaction |
| `ISA.md` § Principles, § Constraints | repo | atomic push, registry as the truth, no credential in any output |

## Non-negotiables

Every rule in the binding sources applies, except what stands under `## Adaptations`.

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo `CLAUDE.md` | binding | `bun run check:static` |
| XC-10 nothing individual in a committed file | repo `CLAUDE.md` | binding | `bun run check:leak` |

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | `bun run check:static` | before every claim closes |
| quick | `bun run verify:quick` | at every implementation stop |
| full | `bun run verify` | before a spec is marked complete |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| cli | `cli/` | `cli/CLAUDE.md` | `bun test cli/` |
| api | `api/`, `tests/` | `api/CLAUDE.md` | `bun test api/` |
| web | `web/` | `web/CLAUDE.md` | `bun run --cwd web test` |

## How specs are held to it

Every new spec is read against `## Non-negotiables` before its claims are minted. A plan that departs from a binding
row names the rule in `## Stack Decisions` with the reason.
