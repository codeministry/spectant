# core/ — the spec format, parsed once

Lane `core`: paths `core/` and `FORMAT.md`. Load `FORMAT.md` and this file before working here.

**Lane probe: `bun test core/`**

## Purpose

`core/` is the only parser and model of the spec format: frontmatter, claim lines with stable IDs and
`(after: …)` edges, the Test Strategy columns `isc | type | check | threshold | tool | anchors_to | severity`,
`.gates/` marks, `rounds.jsonl`, `tldr.md`, stages and the next-command rules.

- The app (`server/`) and the later plugin both import `core/`; neither parses a spec file itself. Reason: two
  parsers drift, and a drifted stage or claim count is a wrong dashboard nobody notices.
- `scripts/check-single-core.ts` (`bun run check:single-core`) fails on a frontmatter, claim or stage parser
  anywhere outside `core/`. Reason: the one-parser rule is enforced, not remembered.

## Module map (planned, `core/src/`)

| Module | Holds |
|--------|-------|
| `frontmatter.ts` | frontmatter keys and values |
| `claims.ts` | claim lines, stable IDs, `(after: …)` edges, Test Strategy rows |
| `status.ts` | claim partition and drift classes |
| `stage.ts` | stage per spec and the next command |
| `gates.ts` | review and code-review marks; worktree hash computed in memory |
| `takeable.ts` | the takeable task set |
| `diagrams.ts` | the diagram verdict |
| `tldr.ts` | TL;DR staleness |
| `markdown.ts` | the markdown renderer: Brief mode and, for the docs tabs, document mode with figures and TOC |
| `markdown-docs.ts` | the document layer on `markdown.ts`: frontmatter, sections, mermaid and image figures, `docsFor(type)` |
| `archive.ts` | the archive listing |
| `dashboard.ts` | assembles the dashboard model: the seam to `server/` and `web/` |

One module per ported source of the old Spec skill. Reason: a port that maps one to one can be diffed against its
origin when parity breaks.

## Read-only invariant

- Nothing in `core/` writes into a repository it reads: no `git write-tree`, no index, no lock files, no temp files
  inside the tree. Reason: a registered repository stays byte-identical, `.git/` included (ISC-15).
- `gates.ts` hashes the worktree in memory and never writes a git object. Reason: `git write-tree` stores objects in
  the registered repository's `.git/`.

## Fixtures

- A synthetic fixture (`harbor/`, `lantern/`, `empty-master/`) stays synthetic, with fixed dates. Reason: fixed
  dates keep snapshots and visual baselines stable.
- A copy of a public repository is allowed when it is frozen at a named commit, carries its licence note and passes
  `bun run check:leak` (no person, customer, machine, private repository or absolute home path). Reason: real trees
  catch what invented ones miss, and a frozen, checked copy of public text leaks nothing.
- A copy of a private repository is never allowed, not even in part. Reason: the repository is public and private
  trees carry private names.
- The two frozen corpora are `spectant-001/` (this repository's own spec 001, refreshed only on
  `/spec-complete 001`) and `leadgen/` (github.com/codeministry/leadgen, Apache-2.0). Reason: a frozen copy moves
  only when someone decides it should, so its golden snapshot fails for parser reasons only.
- Private spec trees are read only through `SPECTANT_PRIVATE_CORPUS`, local to the principal's machine; the private
  corpus test reports skipped, never passed, when the variable is unset (ISC-70). Reason: the private corpus proves
  the parser on real customer specs without those specs ever entering the tree.
- Each fixture has a golden snapshot `core/fixtures/<name>.golden.json`, which doubles as stub-API data for the web
  e2e and visual suites. Reason: the UI tests render exactly what `core/` produces.
- One fixture carries a three-digit/three-digit master fraction. Reason: it is the widest number the layout must hold.
- `core/tests/fixtures.test.ts` is the golden test (ISC-6). A snapshot changes only together with the parser change
  that explains it.
- `core/tests/stage-parity.test.ts` compares stages against local trees listed in `SPECTANT_PARITY_TREES` and fails
  on zero comparisons (ISC-14). Reason: a parity test that compared nothing is not green.

## Conventions

- Pure TypeScript. Reason: the same code runs in the server, the plugin and, for types, the browser.
- `markdown.ts` and the types in `dashboard.ts` use no Bun-only API. Reason: the web app imports them into a
  browser bundle.
- No dependency unless a Decision in the spec names it. Reason: `core/` is shared and every dependency ships twice.
- `FORMAT.md` at the repository root is the written contract. A parser change updates `FORMAT.md` in the same task.
  Reason: the contract and the code must never disagree.
