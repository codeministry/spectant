---
task: "Find out which target registries answer the OCI referrers endpoint"
slug: 008-referrers-support
spec_type: spike
isa_master: ../../ISA.md
isa_feature: F6
constitution: ../constitution.md
phase: building
progress: 2/2
started: 2026-03-08T13:00:00Z
updated: 2026-03-09T09:00:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F6). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 008-referrers-support"). Never edit the master from this file. -->

# 008 — Referrers API support

## Problem

Signatures and attestations hang off a manifest through the referrers endpoint, and not every registry answers it.
Nobody has checked the four registries teams mirror into.

## Goal

A recorded table says which target registry answers the referrers endpoint, and a decision names the fallback for
the ones that do not.

## Claims

- [x] ISC-128: A recorded table names, for each of the four target registries in the test matrix, whether it answers the OCI referrers endpoint.
- [x] ISC-129: A decision row names the fallback Harbor uses on a registry without the referrers endpoint.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-128 | bash | registries listed in the referrers probe output | 4 rows | `bun run cli -- probe referrers --matrix tests/registries.toml` | literal |  |
| ISC-129 | manual | decision row for the referrers fallback | present | review of `spec.md` § Decisions | derived: registry-is-truth |  |

## Decisions

- 2026-03-08: opened; signatures and attestations are mirrored through the referrers endpoint where a registry has one.
- 2026-03-09: three of the four registries in the matrix answer the endpoint; the fourth gets the tag-schema fallback.

## Verification

- ISC-128: `bun run cli -- probe referrers --matrix tests/registries.toml` passed, 2026-03-09
- ISC-129: review of `spec.md` § Decisions passed, 2026-03-09
