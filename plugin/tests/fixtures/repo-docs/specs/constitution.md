---
repo: recipebox
derived: 2026-01-05T09:00:00Z
standards_version: 1
design_track: none
stack: typescript-bun
---

# Constitution — recipebox

> Derived 2026-01-05 from the sources below. The rules live in those sources; this file says which of them bind spec
> work, where to read them, and what proves them.

## What a spec may contain

Structure is English in every repository, because the parsers read it: slugs, branch names, section headings,
frontmatter keys and their enum values, claim and task IDs, prefixes such as `Anti:` and `fog:`, and the Test Strategy
column headers. Prose follows this repository: titles, claims, decisions and context are written in English.

A spec states what its claims need and nothing more. A rule from the sources below is referenced, never restated:
a copied rule is wrong as soon as its source changes.

## Binding sources

The root `CLAUDE.md` and the master are the only sources.

| Source | Kind | Governs |
|--------|------|---------|
| `CLAUDE.md` (root and nested) | repo | language, runtime and commit rules |
| `ISA.md` § Principles, § Constraints | repo | the project's own principles and its immovable constraints |

## Non-negotiables

Every rule in the binding sources applies, except what stands under `## Adaptations` and `## Conformance baseline`.

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| TypeScript only, run with bun | `CLAUDE.md` | binding | `bun run typecheck` |
| No network call | `ISA.md` § Constraints | binding | `bun test -t "offline"` |

## Adaptations

| Rule | Default | This repo does | Recorded in | Why |
|------|---------|----------------|-------------|-----|

## Conformance baseline

> Measured 2026-01-05 with `bun test`, unmodified. What is true today, not what binds: a dated debt with a
> named clearing condition.

| Rule | Status | Measured | Note |
|------|--------|----------|------|

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | `bun run typecheck` | before every claim closes |
| quick | `bun test` | at every implementation stop, and before a spec is marked complete |
| full | `bun test` | before a feature or milestone completes |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| cli | `src/` | `CLAUDE.md` | `bun test` |

## How specs are held to it

Every new spec is read against `## What a spec may contain` and `## Non-negotiables` before its claims are minted. A
plan that departs from a `binding` row names the rule and the reason in `## Stack Decisions`, and the deviation lands
in the master's `## Decisions` before code does. A row in `## Conformance baseline` is cleared by the spec whose probe
measures it, and that spec says so.
