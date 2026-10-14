---
repo: quay
derived: 2026-03-02T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
stack: [bun, typescript, angular]
shared_files: [src/i18n/*.json, bun.lock]
---

# Constitution — quay

> Derived on 2026-03-02. A synthetic tree for spec edges (spec 025): edges between specs, a cycle, an unknown
> number, a full and a partial hold, and plans that share files.

## Binding sources

| Source | Kind | Governs |
|--------|------|---------|
| `CLAUDE.md` | repo | the one lane |

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | `bun run check:static` | before every claim closes |
| quick | `bun run verify:quick` | at every implementation stop |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| web | `src/`, `tests/` | `CLAUDE.md` | `bun test` |
