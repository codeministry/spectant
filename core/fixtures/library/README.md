# library — the catalog fixture (spec 017)

A synthetic workspace for the document catalog `readCatalog` (`core/src/library.ts`, ISC-155 to ISC-155.2). Every
product, title and date is invented. It is not a dashboard fixture: it has no master and no golden snapshot, and
`fixtureTrees()` leaves it out; `core/tests/library.test.ts` is its test.

File times are not taken from this tree. The test copies it to a temp directory and sets every mtime from its own
table, so a checkout never changes a result. The intended cases:

| Under `specs/` | Carries |
|----------------|---------|
| `constitution.md`, `tech.md`, `tldr.md`, `ideas/*.md` | the workspace documents; `tech.md` has a frontmatter `title:` and no H1; `tldr.md` is older than the newest spec, `tech.md` newer |
| `001-lighthouse-map/` | feature, building: all five Markdown files, `artifacts/`, `.evidence/` (nested folders, a file without H1, files that are no document), `.design/` with a nested image, and `.design/prototype/` itself holding an HTML page; `plan.md` older than the spec's last `events.jsonl` line (stale), `tasks.md` and `design.md` newer |
| `002-tide-board/` | feature, scoping, three claims, no `plan.md` and no `tasks.md`; the prototype `.design/prototype/board/` with two HTML pages and its own CSS, script, Markdown and image, the screenshot `.design/prototype-board.png`, and the code folder `.design/prototype/src/` without HTML |
| `003-buoy-colors/` | refactor, complete, three claims closed, no `tasks.md` |
| `004-fog-horn/` | bug, scoping, `spec.md` only |
| `archive/000-first-light/` | an archived spec with its own documents and prototype: none of them is listed |
| `workflow.md`, `tech/arch.png`, `ideas/notes.txt` | files outside the catalog's zones |
