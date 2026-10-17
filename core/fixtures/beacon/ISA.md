---
task: "Watch services and publish their state with Beacon"
slug: 20260301-beacon
project: beacon
phase: climbing
progress: 13/29
started: 2026-03-01T08:00:00Z
updated: 2026-03-08T12:00:00Z
---

# Beacon

## Problem

A small team runs a handful of web services. When one goes down, users notice first and ask in chat, and nobody can
say afterwards how long it was down or why.

## Vision

Every service is checked from where its users are, an outage reaches the on-call person once, and a public page tells
everyone else what is going on.

## Out of Scope

- Application performance tracing.

## Principles

- An outage is recorded once and never hidden.

## Constraints

- Bun and TypeScript; the status page works without script.

## Goal

Checks run on schedule from several regions, alerts fire once per outage, and the status page shows the truth.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | a check runs at the interval its definition names, within one second | pass | `bun test tests/scheduler.test.ts -t interval` | literal |  |
| ISC-2 | bun-test | a check that times out is recorded as down, never as up | pass | `bun test tests/scheduler.test.ts -t timeout` | literal |  |
| ISC-3 | bun-test | two checks on one host never run at the same instant | pass | `bun test tests/scheduler.test.ts -t spread` | literal |  |
| ISC-4 | e2e | the status page lists every public check with its current state | pass | `bun run e2e -- status -g list` | literal |  |
| ISC-5 | browser | the status page renders without script at 390 px | pass | `bun run test:browser -- status` | literal |  |
| ISC-6 | bun-test | anti: a private check appears on the public status page | pass | `bun test tests/status.test.ts -t private` | literal |  |
| ISC-7 | bun-test | an alert rule names a check, a threshold and a channel | pass | `bun test tests/rules.test.ts -t shape` | literal |  |
| ISC-8 | bun-test | a rule fires once per outage, not once per failed run | pass | `bun test tests/rules.test.ts -t once` | literal |  |
| ISC-9 | bun-test | a rule that names an unknown channel is refused when saved | pass | `bun test tests/rules.test.ts -t channel` | literal |  |
| ISC-10 | bun-test | an incident note is attached to the outage it describes | pass | `bun test tests/notes.test.ts -t attach` | literal |  |
| ISC-11 | e2e | incident notes show on the status page, newest first | pass | `bun run e2e -- notes -g order` | literal |  |
| ISC-12 | bun-test | editing a note keeps its first publication time | pass | `bun test tests/notes.test.ts -t edit` | literal |  |
| ISC-13 | bun-test | a probe agent registers with a one-time token | pass | `bun test tests/agents.test.ts -t register` | literal |  |
| ISC-14 | bun-test | a registered agent reports its results over one connection | pass | `bun test tests/agents.test.ts -t report` | literal |  |
| ISC-15 | bun-test | an agent that stops reporting is shown as silent within two intervals | pass | `bun test tests/agents.test.ts -t silent` | literal |  |
| ISC-16 | bun-test | a check can be pinned to one region's agents | pass | `bun test tests/agents.test.ts -t region` | literal |  |
| ISC-17 | bun-test | results from a revoked agent are dropped | pass | `bun test tests/agents.test.ts -t revoked` | literal |  |
| ISC-18 | bun-test | an agent's results are signed and rejected when the signature fails | pass | `bun test tests/agents.test.ts -t signed` | literal |  |
| ISC-19 | bun-test | agents update themselves from the console | pass | `bun test tests/agents.test.ts -t update` | literal |  |
| ISC-20 | bun-test | a failed run is retried with exponential backoff up to three times | pass | `bun test tests/retry.test.ts -t backoff` | literal |  |
| ISC-21 | bun-test | anti: a retry is counted as a separate outage | pass | `bun test tests/retry.test.ts -t outage` | literal |  |
| ISC-22 | bash | a recorded table names the export formats teams ask for, with one example file each | pass | `bun run cli -- survey exports` | literal |  |
| ISC-23 | bash | a decision names the default export format | pass | `bun run cli -- survey exports --decision` | literal |  |
| ISC-24 | bash | a recorded table names the largest history each format exports within ten seconds | pass | `bun run cli -- probe exports` | literal |  |
| ISC-25 | bun-test | anti: an export exceeds the limit the spike recorded for its format | pass | `bun test tests/export.test.ts -t limit` | literal |  |
| ISC-26 | e2e | times on the status page carry the viewer's time-zone label | pass | `bun run e2e -- status -g timezone` | literal |  |
| ISC-27 | bash | the mail relay api key is replaced without a restart | pass | `bun run cli -- keys rotate --dry-run` | literal |  |
| ISC-28 | bash | the old mail relay api key is revoked after the swap | pass | `bun run cli -- keys check` | literal |  |
| ISC-29 | e2e | a maintenance window hides its checks' outages from the status page | pass | `bun run e2e -- status -g maintenance` | literal |  |
| ISC-30 | e2e | a maintenance window is announced on the status page a day ahead | pass | `bun run e2e -- status -g announce` | literal |  |

## Features

### F1 · Check scheduling
Why: checks run on time and an outage is never recorded twice.

- [x] ISC-1: A check runs at the interval its definition names, within one second.
- [x] ISC-2: A check that times out is recorded as down, never as up.
- [x] ISC-3: Two checks on one host never run at the same instant.
- [x] ISC-20: A failed run is retried with exponential backoff up to three times.
- [x] ISC-21: Anti: a retry is counted as a separate outage.

### F2 · Status page
Why: the people who depend on a service see its state without asking.

- [ ] ISC-4: The status page lists every public check with its current state.
- [ ] ISC-5: The status page renders without script at 390 px.
- [ ] ISC-6: Anti: a private check appears on the public status page.
- [x] ISC-26: Times on the status page carry the viewer's time-zone label.

### F3 · Alerting
Why: the on-call person hears about an outage once, on the right channel.

- [ ] ISC-7: An alert rule names a check, a threshold and a channel.
- [ ] ISC-8: A rule fires once per outage, not once per failed run.
- [ ] ISC-9: A rule that names an unknown channel is refused when saved.
- [ ] ISC-29: A maintenance window hides its checks' outages from the status page. (after: 002)
- [ ] ISC-30: A maintenance window is announced on the status page a day ahead. (after: 002)

### F4 · Incident notes
Why: an outage on the status page says what happened, in words.

- [ ] ISC-10: An incident note is attached to the outage it describes.
- [ ] ISC-11: Incident notes show on the status page, newest first.
- [ ] ISC-12: Editing a note keeps its first publication time.

### F5 · Probe agents
Why: checks run from where the users are, not only from one host.

- [x] ISC-13: A probe agent registers with a one-time token.
- [x] ISC-14: A registered agent reports its results over one connection.
- [ ] ISC-15: An agent that stops reporting is shown as silent within two intervals.
- [ ] ISC-16: A check can be pinned to one region's agents.
- [ ] ISC-17: Results from a revoked agent are dropped. (after: ISC-18)
- [ ] ISC-18: An agent's results are signed and rejected when the signature fails.
- [ ] ISC-19: [DROPPED — see Decisions 2026-03-07] Agents update themselves from the console.

### F6 · History export
Why: a team takes its uptime history elsewhere without a support ticket.

- [x] ISC-22: A recorded table names the export formats teams ask for, with one example file each.
- [x] ISC-23: A decision names the default export format.
- [x] ISC-24: A recorded table names the largest history each format exports within ten seconds.
- [ ] ISC-25: Anti: an export exceeds the limit the spike recorded for its format. (after: ISC-24)

### F7 · Maintenance
Why: the service's own credentials and dependencies stay current.

- [x] ISC-27: The mail relay API key is replaced without a restart.
- [x] ISC-28: The old mail relay API key is revoked after the swap.

## Decisions

- 2026-03-01: one master for the whole product; each spec projects one feature.
- 2026-03-07: agents do not update themselves; ISC-19 is dropped.
