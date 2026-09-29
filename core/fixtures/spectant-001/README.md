# spectant-001

Spectant's own spec 001 (`001-app-skeleton`), frozen at a named commit. Unlike `harbor/`, `lantern/` and
`empty-master/` this fixture is real, not synthetic: it is a public repository's own spec tree, so it carries the
spec's real dates (2026-09-28) instead of the fixed March-2026 dates of the synthetic trees. It stays stable because
it is frozen, not because its dates are invented.

## What is frozen

| File | Source |
|------|--------|
| `specs/001-app-skeleton/{spec,plan,tasks,context,design}.md` | `specs/001-app-skeleton/` at the commit in `COMMIT` |
| `specs/001-app-skeleton/rounds.jsonl` | the round log of the same run (rounds 1 to 9; gitignored at the repository root, so copied from the working tree) |
| `specs/constitution.md` | `specs/constitution.md` at the same commit |
| `ISA.md` | a reduced master: only `F0 · Cross-cutting` and `F1 · App skeleton and dashboard` with their claims and Test Strategy rows, claim IDs unchanged, `progress` recomputed from those claims |

The repository's real master is untracked because it holds private text; the reduced master keeps none of it (no
stated goal, no Decisions, no Verification). `design.md` links to `.design/` screenshots that are gitignored; the
links are kept, the images are not copied.

## Refresh rule

`COMMIT` names the commit and the date of the freeze. The fixture is refreshed only on `/spec-complete 001`: copy the
files above again at the completing commit, rewrite `COMMIT`, then let the golden test regenerate the snapshot.
Between refreshes spec 001 moves on in `specs/` while this copy stays put, so the golden snapshot never goes red for a
reason unrelated to the parser.
