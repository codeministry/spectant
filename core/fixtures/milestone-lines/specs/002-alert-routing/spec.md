---
task: "Route each signal to the person on call"
slug: 002-alert-routing
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F2 F0
milestone: Beacon 0.5
constitution: ../constitution.md
phase: building
progress: 0/4
started: 2026-03-06T09:00:00Z
updated: 2026-03-08T15:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (features F2 and F0). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 002-alert-routing"). Never edit the master from this file. -->

# 002 — Alert routing

## Claims

- [ ] ISC-6: A signal is routed to the person on call for its service.
- [ ] ISC-7: A service without a rota routes to the fallback contact. (after: ISC-6)
- [ ] ISC-8: The routing decision is recorded with the signal.
- [ ] ISC-1: Anti: a signal accepted by the intake is dropped before it is routed.

## Decisions

- 2026-03-08: started under Beacon 0.5, while its main feature F2 names Beacon 1.0.
