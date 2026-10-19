---
task: "{{task}}"
slug: {{slug}}
project: {{project}}
phase: scoping
progress: 0/0
started: {{now}}
updated: {{now}}
principal_stated_goal: "{{stated_goal}}"
---

# {{title}}

<!-- The project master. Every claim ID is minted here first (`spec-check mint`) and only then derived into a spec
     under specs/NNN-slug/. Closes and decisions reach this file through `spec-check verify` and `spec-check decide`;
     it is never hand-edited. -->

## Problem

{{problem}}

## Vision

{{vision}}

## Out of Scope

- {{out_of_scope}}

## Principles

- {{principle}}

## Constraints

- {{constraint}}

## Goal

{{goal}}

## Not yet specified

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|

## Features

### F0 · Cross-cutting

Why: {{cross_cutting_why}}

## Decisions

- {{today}} (init): master created from the stated goal; claims follow with the first spec.

## Verification

## Remaining Work
