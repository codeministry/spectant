---
repo: textkit
design_track: none
---

# Constitution — textkit

## Non-negotiables

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun only | `CLAUDE.md` | binding | review |

## Gates

| Tier | Command |
|------|---------|
| static | `bun x tsc --noEmit` |
| quick | `bun test src/` |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| lib | `src/` | `CLAUDE.md` | `bun test src/` |
