---
task: "Hide planned downtime from alerts and the page"
slug: 011-maintenance-windows
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F3
constitution: ../constitution.md
phase: building
progress: 0/2
started: 2026-03-07T14:00:00Z
updated: 2026-03-07T14:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F3, Alerting). Claim IDs belong to the
     master. Never edit the master from this file. -->

# 011 — Maintenance windows

## Problem

Planned maintenance shows as an outage on the status page.

## Goal

A maintenance window hides its outages and is announced a day ahead, once the status page exists.

## Claims

- [ ] ISC-29: A maintenance window hides its checks' outages from the status page. (after: 002)
- [ ] ISC-30: A maintenance window is announced on the status page a day ahead. (after: 002)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-29 | e2e | a maintenance window hides its checks' outages from the status page | pass | `bun run e2e -- status -g maintenance` | literal |  |
| ISC-30 | e2e | a maintenance window is announced on the status page a day ahead | pass | `bun run e2e -- status -g announce` | literal |  |

## Decisions

- 2026-03-07: opened.

## Verification
