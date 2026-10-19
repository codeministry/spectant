---
repo: {{repo}}
derived: {{now}}
standards_version: {{standards_version}}
design_track: {{design_track}}
stack: {{stack}}
---

# Constitution — {{repo}}

> Derived {{today}} from the sources below. The rules live in those sources; this file says which of them bind spec
> work, where to read them, and what proves them.

## What a spec may contain

Structure is English in every repository, because the parsers read it: slugs, branch names, section headings,
frontmatter keys and their enum values, claim and task IDs, prefixes such as `Anti:` and `fog:`, and the Test Strategy
column headers. Prose follows this repository: titles, claims, decisions and context are written in {{prose_language}}.

A spec states what its claims need and nothing more. A rule from the sources below is referenced, never restated:
a copied rule is wrong as soon as its source changes.

## Binding sources

{{sources_note}}

| Source | Kind | Governs |
|--------|------|---------|
| `CLAUDE.md` (root and nested) | repo | {{claude_md_governs}} |
| `ISA.md` § Principles, § Constraints | repo | the project's own principles and its immovable constraints |

## Non-negotiables

Every rule in the binding sources applies, except what stands under `## Adaptations` and `## Conformance baseline`.

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| {{rule}} | {{rule_source}} | binding | {{rule_probe}} |

## Adaptations

| Rule | Default | This repo does | Recorded in | Why |
|------|---------|----------------|-------------|-----|

## Conformance baseline

> Measured {{today}} with {{quick_command}}, unmodified. What is true today, not what binds: a dated debt with a
> named clearing condition.

| Rule | Status | Measured | Note |
|------|--------|----------|------|

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | {{static_command}} | before every claim closes |
| quick | {{quick_command}} | at every implementation stop, and before a spec is marked complete |
| full | {{full_command}} | before a feature or milestone completes |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| {{lane}} | {{lane_paths}} | {{lane_context}} | {{lane_probe}} |

## How specs are held to it

Every new spec is read against `## What a spec may contain` and `## Non-negotiables` before its claims are minted. A
plan that departs from a `binding` row names the rule and the reason in `## Stack Decisions`, and the deviation lands
in the master's `## Decisions` before code does. A row in `## Conformance baseline` is cleared by the spec whose probe
measures it, and that spec says so.
