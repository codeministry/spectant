---
task: "Read the config through one loader in the CLI, the API and the console"
slug: 003-config-loader
spec_type: refactor
isa_master: ../../ISA.md
isa_feature: F3
constitution: ../constitution.md
phase: scoping
progress: 0/13
started: 2026-03-06T09:00:00Z
updated: 2026-03-09T17:30:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F3). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 003-config-loader"). Never edit the master from this file. -->

# 003 — Config loader rewrite

## Problem

Three packages parse `harbor.toml` on their own, and they disagree about environment overrides and duplicated keys.

## Out of Scope

- A new config format; spec 005 decides whether one comes.

## Goal

The CLI, the API and the console read their configuration through one loader, and the effective config for every
case in the snapshot corpus is unchanged.

## Claims

- [ ] ISC-81: The loader reads the project file through one code path.
- [ ] ISC-82: Anti: the project file produces a different effective config than before the rewrite. (after: ISC-81)
- [ ] ISC-83: The loader reads the user file through one code path.
- [ ] ISC-84: Anti: the user file produces a different effective config than before the rewrite. (after: ISC-83)
- [ ] ISC-85: The loader reads environment overrides through one code path.
- [ ] ISC-86: Anti: environment overrides produces a different effective config than before the rewrite. (after: ISC-85)
- [ ] ISC-87: The loader reads command-line flags through one code path.
- [ ] ISC-88: Anti: command-line flags produces a different effective config than before the rewrite. (after: ISC-87)
- [ ] ISC-89: The loader reads a missing file through one code path.
- [ ] ISC-90: Anti: a missing file produces a different effective config than before the rewrite. (after: ISC-89)
- [ ] ISC-91: The loader reads an unknown key through one code path.
- [ ] ISC-92: Anti: an unknown key produces a different effective config than before the rewrite. (after: ISC-91)
- [ ] ISC-93: The loader reads a duplicated key through one code path.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-81 | bash | loader call sites for the project file | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-82 | bun-test | effective config snapshot, case 1 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 1"` | derived: one-config-path |  |
| ISC-83 | bash | loader call sites for the user file | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-84 | bun-test | effective config snapshot, case 3 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 3"` | derived: one-config-path |  |
| ISC-85 | bash | loader call sites for environment overrides | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-86 | bun-test | effective config snapshot, case 5 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 5"` | derived: one-config-path |  |
| ISC-87 | bash | loader call sites for command-line flags | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-88 | bun-test | effective config snapshot, case 7 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 7"` | derived: one-config-path |  |
| ISC-89 | bash | loader call sites for a missing file | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-90 | bun-test | effective config snapshot, case 9 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 9"` | derived: one-config-path |  |
| ISC-91 | bash | loader call sites for an unknown key | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-92 | bun-test | effective config snapshot, case 11 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 11"` | derived: one-config-path |  |
| ISC-93 | bash | loader call sites for a duplicated key | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |

## Decisions

- 2026-03-06: behaviour is held; every Anti: claim compares against a snapshot taken before the rewrite.

## Verification
