# edges — the spec-edge fixture (spec 025)

A synthetic workspace for spec edges: a three-digit number in the `(after: …)` of a task or a claim, read as the
whole spec with that number, active or archived (ISC-162 to ISC-164). Every product, title and date is invented. It
is not a dashboard fixture: it has no master and no golden snapshot, and `fixtureTrees()` leaves it out;
`core/tests/spec-edges.test.ts` is its test. `specs/constitution.md` names `shared_files: [src/i18n/*.json, bun.lock]`.

| Under `specs/` | Carries |
|----------------|---------|
| `archive/001-timetable-import/` | archived, `phase: complete`, every claim and task closed; its plan shares `src/app/stops/index.ts` with 002 and 007, which counts for no overlap because it is no open spec |
| `002-stop-search/` | building, no spec edge: the active target of the edges in 003 and 004; its plan shares `src/app/stops/index.ts` with 007 (no edge between them: the overlap case) and `src/app/stops/search.ts` with 003 (joined by 003's edges) |
| `003-route-map/` | the partial hold: claim `ISC-6 (after: ISC-5, 002)` and task `T2 (after: T1, 002)` mix a spec edge with a claim and a task edge in one group; `ISC-7 (after: 001)` and `T3 (after: 001)` wait on the archived spec; `T1` carries no edge and stays takeable; `T4` holds `(after: 004)` in a code span, which is no edge |
| `004-fare-table/` | the full hold: the one open claim `ISC-9 (after: 002)` holds both open tasks; shares only `src/i18n/en.json` (a `shared_files:` path) with 002 and 005 |
| `005-night-service/`, `006-holiday-calendar/` | the cycle: claim `ISC-10 (after: 006)` in 005, task `T1 (after: 005)` in 006 |
| `007-ticket-scan/` | the unknown number: task `T2 (after: 042)`, which no spec carries |
