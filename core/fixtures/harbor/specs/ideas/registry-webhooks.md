---
type: feature
feature: F7
milestone: Harbor 1.0
priority: P2
status: idea
---
/spec

## Type
feature

## Repo
harbor
Slug: registry-webhooks

## Goal (one sentence)
A push to an upstream repository triggers a sync of that repository within a minute, without waiting for the schedule.

## Problem
A moved upstream tag reaches the mirror only on the next scheduled run, so a build in between pulls the old digest.

## In
- A webhook endpoint on the API that accepts a registry's push event
- One sync of the named repository per event, deduplicated while one is running

## Out
- No webhook for retention runs
- No registry outside the test matrix

## Done means (observable)
- One push event starts exactly one sync of that repository → bun-test
- An event for a repository not in the config starts nothing and is logged → bun-test

## Guard rails
- The endpoint binds to loopback unless `--listen` names another address (F0)
