# T12 — dashboard model

Recorded 2026-03-06, round 2.

The console reads the colour mode once at start: the stored setting when there is one, else the system scheme.

| field | holds |
|-------|-------|
| `mode` | `light`, `dark` or `system` as stored |
| `resolved` | `light` or `dark` after the system scheme is applied |
| `source` | `setting` or `system` |
