# repo-docs — the fixture of spec 074 (ISC-618, ISC-624, ISC-625)

A synthetic repository template for `/spec doc` and `/spec tldr`: a small "recipe box" command-line tool with a master
`ISA.md`, a constitution, three open specs (`001` to `003`, two with a `plan.md`, one with a prototype under
`.design/prototype/` and a file under `artifacts/`), one complete spec (`004`) and one archived spec
(`specs/archive/005-config-file/`). `specs/tech.md` exists and carries one hand-written sentence in its overview;
`specs/tldr.md` does not exist. All dates are fixed in January 2026.

This folder is not itself a repository. Tests and headless runs copy it, `git init -q` the copy and commit it there:

- the unit tests of `spec-check doc target` (ISC-618) run against a copy with and without `specs/tech.md`, with and
  without `--keep`;
- the headless runs of `/spec doc` (ISC-624) and `/spec tldr` (ISC-625) pipe the command into
  `claude -p --plugin-dir <plugin>` inside a copy, then check the written file with `spec-check doc check` or
  `spec-check tldr check`.

The page under `specs/002-ingredient-search/.design/prototype/` is fixture data that stands for a designer's
prototype; the plugin writes no page.
