---
generated: 2026-03-07T18:00:00Z
---

# TL;DR — harbor

<!-- section: overview -->
Sync is done and archived (001). The console (002) is in its last round with five claims open, retention (004) has
every claim closed and waits for its code review, and three specs opened this week are still being scoped.

<!-- section: try -->
Run `harbor sync --dry-run` against the sample config, then open the console on port 4200 and walk the sync history.

<!-- section: per-spec -->
- **002** Web console: 25 of 30 closed; one question open about the empty state.
- **003** Config loader rewrite: claims written, tasks not yet.
- **004** Retention policies: all 30 closed; the plan still lacks its diagram.
- **005** Config format choice: two fog lines to resolve before the decision.

<!-- section: risks -->
The config loader rewrite touches every package at once; its parity snapshots are the only guard.

<!-- section: next -->
Answer the empty-state question in 002, then run the code review for 004.
