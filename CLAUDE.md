# CLAUDE.md

Working notes for every agent in this repository. This file holds only what applies in every lane; anything that
belongs to one lane lives in that lane's own `CLAUDE.md`.

## What Spectant is

Spectant is a local spec companion for developers: one binary, installed with one line on macOS or Linux, that reads
the Markdown specs of several registered repositories and shows them on one dashboard in the browser. The files in
those repositories are the only source of truth; Spectant keeps nothing but a small registry and its settings in
SQLite. Everything runs on the developer's machine. The app ships with its Spec skill, a Claude Code plugin sharing
the same parser: spec work starts from the AI chat with the skill, and the app runs alongside for control and
administration. The skill targets Claude Code first and is meant to work with other agents that understand skills.

## Repository layout

| Path | Holds |
|------|-------|
| `core/` | the one parser for the spec format (frontmatter, claims, stages, gates) and the dashboard model |
| `server/` | the CLI and the loopback HTTP server that embeds the web build into the binary |
| `web/` | the Angular app (the dashboard UI) |
| `plugin/` | the Claude Code plugin with the Spec skill — part of the product, built by its own spec; not present yet |
| `specs/` | the spec-driven work: `constitution.md` and one folder per spec, `specs/NNN-slug/` |
| `scripts/` | build, embed and repository checks |
| `tests/` | cross-lane tests: server, CLI, binary, install, read-only and offline checks |

## Rules in every lane

- **bun and bunx only, never npm or npx.** One package manager keeps the lockfile and the scripts honest.
- **TypeScript only.** One language across core, server, web and tooling.
- **Never commit or push from an agent.** A human reviews every change and makes every commit.
- **The master `ISA.md` is untracked and never hand-edited.** It holds private material; specs derive from it and are
  reconciled through the Spec workflow, never by editing it directly.
- **Everything under `specs/` is English and public-safe.** This repository is public; no person, customer, machine,
  private repository or absolute home path appears in any tracked file.
- **Loopback only; nothing leaves the machine.** The server binds 127.0.0.1 or ::1, and no code path calls an
  external host.
- **Files in registered repositories are read-only for the app, `.git/` included**, with exactly two exceptions the
  user triggers in the app (spec 002): the reviewed mark (`specs/NNN-slug/.gates/reviewed.json` plus one line in
  `events.jsonl`) and a task checkbox (one line of `tasks.md`). Both go through `server/src/writes.ts`: the file is
  read, its sha256 compared with the one the client rendered (409 on a mismatch, the file byte-identical), lock sources
  consulted (423 while a session holds the claim), then the target written in place with an fsync — no temp file, no
  git object, nothing else in the tree. The guard is `tests/readonly.test.ts`: it hashes a registered repository,
  `.git/` included, before and after every read route and every refused write, and only those two files may differ
  after an accepted one.
- **One parser for the spec format, in `core/`.** Every other lane imports it; a second implementation is a defect.
- **Pin every dependency and tool version.** Reproducible builds and baselines depend on it.

## Verification ladder

Run the cheapest tier that proves the change, and climb before a claim or spec closes:

| Tier | Command | Runs when |
|------|---------|-----------|
| static | `bun run check:static` | before every claim closes (lint, stylelint, `tsc --noEmit`, zero warnings) |
| quick | `bun run verify:quick` | at every implementation stop |
| full | `bun run verify` | before a spec is marked complete (browser tier, e2e, visual baselines, four-target build) |

## Lane notes

Each lane has its own working notes with its lane probe. Load the one for the lane you work in:

- `core/CLAUDE.md` — lane probe `bun test core/`
- `server/CLAUDE.md` — lane probe `bun test tests/`
- `web/CLAUDE.md` — lane probe `bun run --cwd web test`
- root files (`package.json`, `README.md`, `LICENSE`, this file, `.github/`) — lane probe `bun run check:static`

Which paths belong to which lane is defined in `specs/constitution.md` § Lanes.

## Spec-driven workflow

- `specs/constitution.md` names the binding rules, their probes, the adaptations and the lanes. Read it before
  starting work on a spec.
- Each feature lives in `specs/NNN-slug/`: `spec.md` (the what, with every claim and its probe), `plan.md` (the how),
  `tasks.md` (atomic steps, one claim each), `design.md` for UI specs.
- A claim closes only on its probe's evidence, not on a description of the change.
