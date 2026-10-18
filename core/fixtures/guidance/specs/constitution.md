---
repo: pylon
derived: 2026-03-01T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
stack: [bun, typescript]
---

# Constitution — pylon

## Non-negotiables

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo `CLAUDE.md` | binding | `bun run check:static` |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| api | `api/`, `tests/` | `api/CLAUDE.md` | `bun test api/` |
| sdk | `sdk/` | `sdk/CLAUDE.md` | `bun test sdk/` |
