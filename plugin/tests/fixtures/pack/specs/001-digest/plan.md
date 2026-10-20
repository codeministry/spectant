# Plan 001 — Digest

## Approach

A pure model in `core/` builds the digest; the plugin command prints it.

## Decisions

- 2026-03-03: T3 compares titles case-sensitively; ISC-3 names no folding.
- 2026-03-04: The digest model stays pure; T1 reads no file.
- 2026-03-05: A repeated title keeps its own line (ISC-3).
- 2026-03-05: T30 sorts the archive; ISC-30 names no folding.
