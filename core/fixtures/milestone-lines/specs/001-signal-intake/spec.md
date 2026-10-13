---
task: "Accept monitoring signals at one endpoint"
slug: 001-signal-intake
spec_type: feature
isa_master: ../../ISA.md
isa_feature: F1
milestone: Beacon 0.5
constitution: ../constitution.md
phase: complete
progress: 3/3
started: 2026-03-03T09:00:00Z
updated: 2026-03-05T15:00:00Z
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature F1). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync 001-signal-intake"). Never edit the master from this file. -->

# 001 — Signal intake

## Claims

- [x] ISC-3: The intake accepts a signal over HTTP and answers within 200 ms.
- [x] ISC-4: A signal without a source is refused with a reason.
- [x] ISC-5: The same signal sent twice within a minute is stored once. (after: ISC-3)

## Decisions

- 2026-03-03: one endpoint for every tool; F1 names Beacon 0.5, and so does this spec.
