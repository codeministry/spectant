---
task: "Route monitoring signals to the right person with Beacon"
slug: 20260302-beacon
project: beacon
phase: climbing
progress: 3/10
started: 2026-03-02T08:00:00Z
updated: 2026-03-08T16:00:00Z
---

# Beacon

## Problem

Monitoring signals arrive from several tools and reach whoever happens to watch the shared channel.

## Goal

Every signal reaches the one person on call for it, and an unanswered signal escalates on its own.

## Features

### F0 · Cross-cutting
Why: what would break trust in any release — a signal lost on the way or a contact detail in the repository.

- [ ] ISC-1: Anti: a signal accepted by the intake is dropped before it is routed.
- [ ] ISC-2: Anti: a tracked file contains a phone number or a personal address.

### F1 · Signal intake
Why: every monitoring tool can hand its signals to one endpoint.
Milestone: Beacon 0.5

- [x] ISC-3: The intake accepts a signal over HTTP and answers within 200 ms.
- [x] ISC-4: A signal without a source is refused with a reason.
- [x] ISC-5: The same signal sent twice within a minute is stored once. (after: ISC-3)

### F2 · Alert routing
Why: a signal reaches the person on call for its service, not a shared channel.
Milestone: Beacon 1.0

- [ ] ISC-6: A signal is routed to the person on call for its service.
- [ ] ISC-7: A service without a rota routes to the fallback contact. (after: ISC-6)
- [ ] ISC-8: The routing decision is recorded with the signal.

### F3 · Escalation chains
Why: a signal nobody acknowledges moves up the chain on its own.
Milestone: Beacon 2.0

- [ ] ISC-9: An unacknowledged signal escalates to the next level after its timeout.
- [ ] ISC-10: The last level of a chain repeats until someone acknowledges. (after: ISC-9)

## Milestones

- Beacon 0.5 · 2026-03-12 · Signals arrive at one endpoint.
- Beacon 1.0 · 2026-04-30 · Every signal reaches the person on call.

## Decisions

- 2026-03-02: four feature blocks; F3 names a later release the milestones block does not list yet.
- 2026-03-08: routing work started under Beacon 0.5, ahead of the routing feature's own release.
