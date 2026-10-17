---
task: "Sell ferry tickets and board passengers with Ferry"
slug: 20260303-ferry
project: ferry
phase: climbing
progress: 3/11
started: 2026-03-03T08:00:00Z
updated: 2026-03-09T16:00:00Z
---

# Ferry

## Problem

Ferry tickets are sold at the pier only, and the crew learns on the morning of a crossing who is on board.

## Goal

A passenger buys a ticket online, boards with a pass on the phone, and the crew sees the passenger list before the
crossing.

## Features

### F0 · Cross-cutting
Why: what would break trust in any release — a ticket sold twice or a passenger's details in the repository.

- [ ] ISC-1: Anti: one seat of one crossing is sold twice.
- [ ] ISC-2: Anti: a tracked file contains a passenger's name or address.

### F1 · Ticket sales
Why: a passenger can buy a ticket without going to the pier.
Milestone: Ferry 1.0

- [x] ISC-3: A ticket for a crossing with free seats is sold online and paid in one step.
- [ ] ISC-4: A sold-out crossing offers the next crossing with free seats. (after: ISC-3)

### F2 · Timetable
Why: the crossings a passenger can book are the ones the ferry actually runs.
Milestone: Ferry 1.0

- [x] ISC-5: The timetable lists every crossing of the next thirty days.
- [x] ISC-6: A cancelled crossing disappears from sale within a minute.

### F3 · Boarding passes
Why: a passenger boards with the phone instead of a paper ticket.
Milestone: Ferry 2.0

- [ ] ISC-7: A sold ticket carries a boarding pass the pier scanner accepts.
- [ ] ISC-8: A pass is refused once it has boarded. (after: ISC-7)

### F4 · Crew rota
Why: the crew sees the passenger list of a crossing before it leaves.
Milestone: Ferry 2.0

- [ ] ISC-9: The crew view lists the passengers of the next crossing.
- [ ] ISC-10: The list updates when a pass boards. (after: ISC-9)
- [ ] ISC-11: The list of a past crossing is kept for thirty days.

## Milestones

- Ferry 1.0 · 2026-04-15 · Tickets are sold online.
- Ferry 2.0 · 2026-06-30 · Passengers board with a pass on the phone.

## Decisions

- 2026-03-03: five feature blocks; the cross-cutting block names no milestone.
- 2026-03-09: the timetable is ranked ahead of ticket sales, since sales need the crossings first.
