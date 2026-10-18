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

## Rules in every lane

- **bun and bunx only, never npm or npx.** One package manager keeps the lockfile and the scripts honest.
- **TypeScript only.** One language across core, server, web and tooling.
- **Agents commit on a feature branch, push it and open a pull request; a human reviews and merges it.** Never push
  to `main`, never merge, never force-push.
- **The master `ISA.md` is untracked and never hand-edited.** It holds private material; specs derive from it and are
  reconciled through the Spec workflow, never by editing it directly.
- **Nothing individual in a tracked file.** This repository is public; no person, customer, machine, private
  repository or absolute home path appears in any tracked file (`bun run check:leak`). `specs/` and `ISA.md` are
  untracked planning material in the developer's own language; nothing from them is quoted into a tracked file.
- **Loopback only; nothing leaves the machine.** The server binds 127.0.0.1 or ::1, and no code path calls an
  external host.
- **Files in registered repositories are read-only for the app, `.git/` included**, except for exactly eight write
  paths, each named with every file it may touch in `WRITE_PATHS` (`server/src/writes.contract.ts`):
  1. the reviewed mark: `specs/NNN-slug/.gates/reviewed.json` plus one line in `events.jsonl` (spec 002);
  2. a task checkbox: one line of `tasks.md` (spec 002);
  3. a stage transition: `stage:` in `spec.md` plus one line in `events.jsonl`, through the board or the API
     (spec 008);
  4. a story's allocation: the new folder `specs/NNN-slug/` with `context.md`, `spec.md` and `events.jsonl`, and the
     story file `specs/ideas/<slug>.md` removed (spec 008);
  5. the feature-level code-review mark: `.gates/code-reviewed.json` with `scope: F<n>` plus one line in
     `events.jsonl` per spec of the feature, written by the CLI `spectant gate code-reviewed F<n>`, never by a route
     (spec 008);
  6. the token measurement: `specs/tokens.jsonl`, one file per repository, rewritten in place by the CLI
     `spectant tokens --yes`, never by a route; without `--yes` it writes nothing (spec 009);
  7. the feature backlog: `specs/backlog.md` rewritten in place plus one line in `specs/backlog.events.jsonl`, through
     the backlog route, under the sha256 check and without a lock check: the file belongs to no spec (spec 036);
  8. the run release: one appended `run-end` line with `outcome: released` and the viewer's `u:` id in
     `.spectant/activity.jsonl`, through the release route, under the sha256 check over the whole file; never a
     rewrite (spec 040).

  `.gates/` and the allocated `specs/NNN-slug/` are the only directories a write may create, and nothing else in the
  tree changes. How each write is performed and guarded (`server/src/writes.ts`, `tests/readonly.test.ts`) lives in
  `server/CLAUDE.md` § The write path.
- **One parser for the spec format, in `core/`.** Every other lane imports it; a second implementation is a defect.
- **Pin every dependency and tool version.** Reproducible builds and baselines depend on it.

## Verification ladder

Run the cheapest tier that proves the change, and climb before a claim or spec closes:

| Tier | Command | Runs when |
|------|---------|-----------|
| static | `bun run check:static` | before every claim closes (lint, stylelint, `tsc --noEmit`, zero warnings) |
| quick | `bun run verify:quick` | at every implementation stop, and before a spec is marked complete |
| full | `bun run verify` | before a feature or milestone completes (browser tier, e2e, visual baselines, four-target build) |

A single spec closes on its claims and the quick tier. The full tier, the code review and the security review
(`/spec-code-review`) are optional per spec and run once, when its feature or milestone completes; CI still runs the
quick tier, the browser tier, e2e and the build on every pull request and every push to `main`.

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
