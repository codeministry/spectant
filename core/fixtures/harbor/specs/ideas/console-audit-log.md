---
type: feature
feature: F2
milestone: Harbor 2.0
priority: P3
status: idea
---
/spec

## Type
feature

## Repo
harbor
Slug: console-audit-log

## Goal (one sentence)
Every change made in the web console is written to an audit log a teammate can read back.

## Problem
A setting changed in the console leaves no trace; when a mirror stops, nobody can say who changed what, or when.

## In
- One audit line per console write: time, actor, setting, old and new value
- An audit page in the console, newest first

## Out
- No export, no retention policy of its own

## Done means (observable)
- A console write appends exactly one audit line → bun-test
- The audit page lists the newest line first → e2e

## Guard rails
- No credential value ever reaches an audit line (F0)
