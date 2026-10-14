---
repo: beacon
derived: 2026-03-02T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
stack: [bun, typescript]
---

# Constitution — beacon

> Derived on 2026-03-02 from the sources listed below. The rules live in those sources; this file says which of them
> bind spec work, where to read them, and what proves them.

## Binding sources

| Source | Kind | Governs |
|--------|------|---------|
| `ISA.md` § Goal | repo | every signal reaches one person |

## Non-negotiables

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo `ISA.md` | binding | `bun run check:static` |
