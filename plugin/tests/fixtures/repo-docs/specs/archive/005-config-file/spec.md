---
task: "Read the recipe folder from a config file"
slug: 005-config-file
spec_type: feature
isa_master: ../../../ISA.md
isa_feature: F5
stage: done
constitution: ../../constitution.md
phase: complete
progress: 2/2
started: 2026-01-06T09:00:00Z
updated: 2026-01-09T16:00:00Z
archived: 2026-01-10
---

<!-- SPEC — a derived view of ../../../ISA.md (feature F5). Claim IDs belong to the master: minted there first, then
     projected here. Never edit the master from this file. -->

# 005 — Config file

## Problem

Every command needs the recipe folder, and a flag on every call is easy to forget.

## Goal

The tool reads the recipe folder from one config file and falls back to `recipes/` in the working directory.

## Claims

- [x] ISC-10: Without a config file the recipe folder is `recipes/` in the working directory.
- [x] ISC-11: An unknown key in the config file exits 1 and names the key.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-10 | bun-test | config: default folder | default folder without a file | `bun test -t "config"` | derived: one-folder | medium |
| ISC-11 | bun-test | config: unknown key | exit 1, key named | `bun test -t "config"` | derived: one-folder | low |

## Decisions

- 2026-01-07: The config file is JSON; no comments, no second format.

## Verification

- ISC-10: bun-test — `bun test -t "config"` 3 pass (T1; 2026-01-09)
- ISC-11: bun-test — `bun test -t "config"` 3 pass, exit 1 names the key (T2; 2026-01-09)
