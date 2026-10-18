---
task: "Ship feature flags to every service with Pylon"
slug: 20260301-pylon
project: pylon
phase: climbing
progress: 8/29
started: 2026-03-01T08:00:00Z
updated: 2026-03-08T12:00:00Z
---

# Pylon

## Problem

A small team ships features behind ad-hoc environment variables. Turning one on for a few users needs a deploy, and
nobody can say who switched what.

## Vision

Every service reads its flags from one place, a flag reaches exactly the users it targets, and every change is traced.

## Out of Scope

- Experiment statistics.

## Principles

- A flag change never needs a deploy.

## Constraints

- Bun and TypeScript; SDKs evaluate locally.

## Goal

Flags are targeted, audited, cached and evaluated locally by every SDK.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | a flag rule targets users by attribute, within one evaluation | pass | `bun test tests/targeting.test.ts -t attribute` | literal |  |
| ISC-2 | bun-test | a rule with an unknown attribute is refused when saved | pass | `bun test tests/targeting.test.ts -t unknown` | literal |  |
| ISC-3 | bun-test | anti: a disabled rule still matches a user | pass | `bun test tests/targeting.test.ts -t disabled` | literal |  |
| ISC-4 | bun-test | every flag change is recorded with its actor and time | pass | `bun test tests/audit.test.ts -t record` | literal |  |
| ISC-5 | e2e | the audit trail lists changes newest first | pass | `bun run e2e -- audit -g order` | literal |  |
| ISC-6 | bun-test | anti: a change is recorded without its actor | pass | `bun test tests/audit.test.ts -t actor` | literal |  |
| ISC-7 | bun-test | a flag carries an optional expiry date | pass | `bun test tests/expiry.test.ts -t date` | literal |  |
| ISC-8 | e2e | an expired flag is listed on the clean-up page | pass | `bun run e2e -- expiry -g list` | literal |  |
| ISC-9 | bun-test | an expired flag keeps serving its last value | pass | `bun test tests/expiry.test.ts -t serve` | literal |  |
| ISC-10 | bun-test | flag reads hit the cache before the store | pass | `bun test tests/cache.test.ts -t order` | literal |  |
| ISC-11 | bun-test | anti: a cached flag outlives its change by more than one second | pass | `bun test tests/cache.test.ts -t ttl` | literal |  |
| ISC-12 | bun-test | the server sdk evaluates flags locally from one snapshot | pass | `bun test tests/sdk.test.ts -t snapshot` | literal |  |
| ISC-13 | bun-test | the browser sdk reloads its snapshot on a change event | pass | `bun test tests/sdk.test.ts -t reload` | literal |  |
| ISC-14 | manual | a rollout to the staging tenant is confirmed by hand on the staging console | pass | `manual check on the staging console` | literal |  |
| ISC-15 | bash | a recorded table names the evaluation time of each sdk at ten thousand flags | pass | `bun run cli -- bench sdk` | literal |  |
| ISC-16 | bash | a decision names the snapshot size limit | pass | `bun run cli -- bench sdk --decision` | literal |  |
| ISC-17 | e2e | a segment is built from attribute rules in the console | pass | `bun run e2e -- segments -g build` | literal |  |
| ISC-18 | bun-test | a segment can be reused by several flags | pass | `bun test tests/segments.test.ts -t reuse` | literal |  |
| ISC-19 | bun-test | anti: deleting a segment in use is allowed | pass | `bun test tests/segments.test.ts -t delete` | literal |  |
| ISC-20 | bun-test | a flag change sends a signed webhook | pass | `bun test tests/webhooks.test.ts -t signed` | literal |  |
| ISC-21 | bun-test | a failed webhook is retried three times | pass | `bun test tests/webhooks.test.ts -t retry` | literal |  |
| ISC-22 | bun-test | anti: a webhook carries a secret value | pass | `bun test tests/webhooks.test.ts -t secret` | literal |  |
| ISC-23 | bun-test | a percentage rollout of 33 percent serves 33 percent of users, within one percent | pass | `bun test tests/rollout.test.ts -t percent` | literal |  |
| ISC-24 | bun-test | anti: a user flips between variants across evaluations | pass | `bun test tests/rollout.test.ts -t sticky` | literal |  |
| ISC-25 | e2e | the stale-flag banner names the flag and its owner | pass | `bun run e2e -- banner -g copy` | literal |  |
| ISC-26 | bun-test | flags are stored with their rules in one document | pass | `bun test tests/store.test.ts -t document` | literal |  |
| ISC-27 | bun-test | a store write is atomic per flag | pass | `bun test tests/store.test.ts -t atomic` | literal |  |
| ISC-28 | bun-test | a segment exports as a csv of its rules | pass | `bun test tests/segments.test.ts -t export` | literal |  |
| ISC-29 | bun-test | anti: an export lists a user identifier | pass | `bun test tests/segments.test.ts -t privacy` | literal |  |

## Features

### F1 · Targeting
Why: a flag reaches exactly the users it is meant for.

- [ ] ISC-1: A flag rule targets users by attribute, within one evaluation.
- [ ] ISC-2: A rule with an unknown attribute is refused when saved.
- [ ] ISC-3: Anti: a disabled rule still matches a user.
- [ ] ISC-17: A segment is built from attribute rules in the console.
- [ ] ISC-18: A segment can be reused by several flags.
- [ ] ISC-19: Anti: deleting a segment in use is allowed.
- [ ] ISC-23: A percentage rollout of 33 percent serves 33 percent of users, within one percent.
- [ ] ISC-24: Anti: a user flips between variants across evaluations.
- [ ] ISC-28: A segment exports as a CSV of its rules. (after: 007)
- [ ] ISC-29: Anti: an export lists a user identifier. (after: 007)

### F2 · Audit
Why: every change to a flag can be traced to a person and a time.

- [ ] ISC-4: Every flag change is recorded with its actor and time.
- [ ] ISC-5: The audit trail lists changes newest first.
- [ ] ISC-6: Anti: a change is recorded without its actor.
- [ ] ISC-20: A flag change sends a signed webhook.
- [ ] ISC-21: A failed webhook is retried three times.
- [ ] ISC-22: Anti: a webhook carries a secret value.

### F3 · Flag lifecycle
Why: old flags are found and removed instead of piling up.

- [ ] ISC-7: A flag carries an optional expiry date.
- [ ] ISC-8: An expired flag is listed on the clean-up page.
- [ ] ISC-9: An expired flag keeps serving its last value.
- [x] ISC-25: The stale-flag banner names the flag and its owner.

### F4 · Storage
Why: flag reads stay fast and writes stay consistent.

- [x] ISC-10: Flag reads hit the cache before the store.
- [x] ISC-11: Anti: a cached flag outlives its change by more than one second.
- [x] ISC-26: Flags are stored with their rules in one document.
- [x] ISC-27: A store write is atomic per flag.

### F5 · SDKs
Why: every service evaluates flags locally, without a call per request.

- [x] ISC-12: The server SDK evaluates flags locally from one snapshot.
- [ ] ISC-13: The browser SDK reloads its snapshot on a change event.
- [ ] ISC-14: A rollout to the staging tenant is confirmed by hand on the staging console.
- [x] ISC-15: A recorded table names the evaluation time of each SDK at ten thousand flags.
- [x] ISC-16: A decision names the snapshot size limit.

## Decisions

- 2026-03-01: one master for the whole product; each spec projects one feature.
