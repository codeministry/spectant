---
task: "Import the published timetable once a day"
slug: 001-timetable-import
spec_type: feature
constitution: ../constitution.md
phase: complete
progress: 2/2
started: 2026-03-03T09:00:00Z
updated: 2026-03-06T15:00:00Z
archived: 2026-03-05
context_sufficient: true
interview_invoked: false
---

# 001 — timetable-import

## Goal

Import the published timetable once a day.

## Claims

- [x] ISC-1: The timetable file is imported into the local store.
- [x] ISC-2: A second import on the same day changes nothing. (after: ISC-1)

## Decisions

- 2026-03-03: synthetic spec of the edges fixture (spec 025).
