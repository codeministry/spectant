# Constitution — Quill

## Rules

- One parser for the note format, in `core/`.

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| core | `core/` | `core/CLAUDE.md`, `FORMAT.md` | `bun test core/` |
| plugin | `plugin/` | `plugin/CLAUDE.md` | `bun test plugin/` |
