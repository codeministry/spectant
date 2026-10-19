# plugin/ — the Spec plugin for Claude Code

Lane `plugin`: paths `plugin/` and `.claude-plugin/`. Load this file and `FORMAT.md` before working here.

**Lane probe: `bun test plugin/`**

## Purpose

`plugin/` is the lane of the Spec plugin. What ships is `plugin/spectant/` alone: the manifest, one skill `spec`
(invoked as `/spec <subcommand>`) and the bundled CLI `spec-check` that reads, plans and writes spec files. The
marketplace manifest at the repository root (`.claude-plugin/marketplace.json`) names it with source
`./plugin/spectant`. These notes, the CLI source `plugin/src/` and the tests `plugin/tests/` stay outside the shipped
directory. Reason: a marketplace install copies the shipped directory into the plugin cache, where a `CLAUDE.md` is
never loaded and sources and tests are dead weight; `claude plugin validate --strict` passes on both the root and
`plugin/spectant/` only this way.

- One parser for the spec format, in `core/`. The CLI imports `core/` and never re-implements frontmatter, claim,
  stage or gate parsing. Reason: two parsers drift, and `bun run check:single-core` fails on a second one.
- The CLI source is `plugin/src/spec-check.ts`; `bun run build:plugin` bundles it to
  `plugin/spectant/bin/spec-check`, and the bundle is committed. Reason: a marketplace install copies only
  `plugin/spectant/` into the plugin cache, so `../core` is absent there; only a bundled file runs.
- Rebuild the bundle in the same task that changes `plugin/src/` or the `core/` code it imports. Reason: a stale
  bundle ships behaviour the source no longer has.
- Skill prose calls the CLI as `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check" <command>`, never a path outside the
  plugin. Reason: the plugin runs from the cache, where nothing else of this repository exists.

## Generic for any repository

- No source file under `plugin/` or `core/src/` reads a LifeOS directory, its environment variable or any path under
  the user's Claude configuration directory (ISC-42). Reason: the plugin must run in a fresh Claude Code profile
  without LifeOS and without the app.
- The plugin writes no `.html` file anywhere. Reason: specs and their companions are Markdown and JSON lines; a page
  is the app's job.
- A spec's prose language and branch prefix come from the target repository's own `specs/constitution.md` and
  `CLAUDE.md`, never hard-coded. Reason: the plugin serves every repository, not this one.
- The plugin writes spec files but never commits or pushes unless the target repository's `CLAUDE.md` allows it.
  Reason: a commit is outward-facing; the repository owner decides.

## Conventions

- English only in every file under `plugin/` and `.claude-plugin/`. Reason: the repository is public and English in
  code and documentation.
- No person, customer, machine, private repository or absolute home path; `bun run check:leak` stays at 0. Reason:
  the plugin is published as is.
- Commands are written as `/spec <subcommand>`; no `commands/` directory and no `/spec-<name>` names. Reason: one
  skill with routing is the whole command surface.
- The plugin version in `plugin/spectant/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` is
  pinned and matches `package.json`. Reason: an install must name exactly the build it gets.
- `claude plugin validate --strict .` passes at the repository root (ISC-38) and on `plugin/spectant/`. Reason:
  the runtime tolerates what the strict validator rejects, so only the validator catches it.
