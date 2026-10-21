# server lane

Working notes for the `server` lane: paths `server/`, `scripts/`, `tests/`, `install.sh`. The root `CLAUDE.md` still
applies; this file adds only what is specific to the lane.

**Lane probe:** `bun test tests/`. It must be green at every stop in this lane.

## Purpose

The Bun server and the CLI inside the compiled `spectant` binary. It stays thin: it resolves workspaces from the
SQLite registry, asks `core/` for the dashboard model, serves settings and serves the embedded Angular build.
Everything visual lives in `web/`, and all spec parsing lives in `core/`. Parsing here would make a second parser
(ISC-5).

## Layout (spec 059)

`server/src/` holds `main.ts`, twelve feature slices and two shared areas, nothing else. Reason: a change to one
feature touches one folder, and the guards below keep it that way.

A slice is a folder directly under `server/src/` whose `index.ts` is its one public surface:

- `workspace/`: one registered repository read into the dashboard model, its worktree view, the read sources of its
  repository files and specs, and the workspace list and dashboard routes (`routes.ts`, `family.ts`).
- `planning/`: the planning tree, the story page, the board's stored query and the favourites as handlers of the
  workspace family, and the favourites' scan before each live build (`favorites-scan.ts`).
- `library/`: the document catalog of a workspace, its loads, the reader, the search and the asset route (spec 017).
- `spec/`: every route under `/api/workspaces/:ws/specs`, its family and its read handlers, composed with the write
  handlers of `writes/`.
- `writes/`: the write mechanism (`run-write.ts`) and the write paths on top of it (§ The write path), and the write
  routes' answers (`routes.ts`).
- `notes/`: the notes routes and `import-notes` / `export-notes`.
- `settings/`: the settings schema and `/api/settings`, `/api/actors` and `/api/lifeos`.
- `prototype/`: `GET`/`HEAD /proto/:ws/:spec/:folder/*` (spec 017).
- `live/`: the live update stream `GET /api/events` and the watch hub behind it (spec 030).
- `workspace-admin/`: the writing workspace routes of the settings page and the workspace image store in the data
  folder.
- `tokens/`: `spectant tokens`, its transcript discovery and its write path (spec 009).
- `cli/`: the `spectant` command line and the composition root. `cli/routes.ts` lists the route families in the order
  they answer, and `cli/serve.ts` joins them with every slice's handlers into one router. Only `main.ts` imports it.

The two areas are not slices:

- `infra/`: the shared I/O. `http/` (the loopback server `server.ts`, the router `router.ts` with `RouteFamily` and
  `createRouter`, JSON answers, ETags, file answers, the loopback guard), `git/` (read-only git, `index.ts` its
  surface), `db/` (the SQLite database and its stores: registry, settings, notes, prefs), `fs/` (reads, the in-place
  writes, stat, listings, the directory watch), `process/` (opening the browser, `lsof`), and `hash.ts`, `paths.ts`,
  `version.ts`, `manifest-load.ts`, `lifeos.ts`, `abort-age.ts`.
- `contracts/`: the browser-safe seams, types and pure helpers without I/O that `web/` and the e2e stub import beside
  the server: `assets`, `spec-routes` (its parts under `spec-routes/`), `writes` (its parts under `writes/`),
  `workspace-list`, `workspace-admin`, `notes`, `note-routes` (each `<name>.contract.ts`), and `guards.ts`.

The import rules:

- A slice imports another slice only through its `index.ts` (`../writes/index.ts`); inside a slice, files import each
  other directly. Reason: a slice's files can move or split without touching a consumer.
- `infra/` and `contracts/` import no slice; a slice imports both freely. Reason: the shared areas stay below every
  feature, so nothing shared depends on what one feature does.
- No import cycle between slices. Reason: a cycle makes two slices one, and neither can change alone.
- Direct I/O only inside `infra/`: `node:fs`, `node:fs/promises`, `node:child_process` and `bun:sqlite` imports
  (type-only ones included) and the calls `Bun.spawn`, `Bun.file` and `Bun.write`. Outside it, the database type is
  `Db` from `infra/db/db.ts`. Reason: what the app reads and writes, and so the read-only rule, is reviewed in one area.
- Directly under `server/src/` stands only `main.ts`; every other folder is an area or a slice with an `index.ts`.
- No file over 400 lines, and no copied block of 50 tokens or more (jscpd). Reason: a file stays reviewable in one
  pass, and a copy drifts from its original.

`bun run check:architecture` enforces all of it (`scripts/check-architecture.ts` over
`scripts/architecture.config.ts`, one entry per lane), and `tests/architecture.test.ts` runs the same rules on the app
and on fixtures.

## Seams

- `server/src/contracts/assets.contract.ts`: the build contract between the Angular output and the embedded manifest
  (T6).
- `core/src/dashboard.ts`: the dashboard model type shared by server and web (T44). The server returns it as it is
  and never reshapes it.

This lane builds against both seams and does not define what they contain.

**Spec routes.** `server/src/contracts/spec-routes.contract.ts` (its parts under `contracts/spec-routes/`) is the one
source for every `/api/workspaces/:ws/specs/:id…` route: builders, `matchSpecPath`, 200 types (core types only), error bodies, write bodies, `SPEC_ROUTE_TABLE`. The
server, the e2e stub and the web import it; nobody re-types a route. Error codes are kebab-case, `{error: "not-found"}`,
as every existing route answers (plan 002's `not_found` is superseded). `tests/spec-routes.contract.test.ts` pins it.

## The write path (spec 002)

The app writes into a registered repository along exactly eight write paths, the eight entries of `WRITE_PATHS`
(`contracts/writes.contract.ts`), each through the `writes/` slice. Four are the routes of specs 002 and 008, each on a user action and
typed by `WRITE_TABLE`: the reviewed mark (`.gates/reviewed.json` in the old
skill's byte format plus one `review → build` line appended to `events.jsonl`), one task checkbox (one `[ ]` ↔ `[x]`
flip on one line of `tasks.md`, line endings kept), the stage move (`stage:` in `spec.md` plus one event line, spec
008 T82) and the allocation of a story (spec 008 T86: `specs/NNN-slug/` created with `context.md`, `spec.md` and
`events.jsonl`, and `specs/ideas/<slug>.md` removed; the index `README.md` is not touched, its `Spec` cell is the
web's or the skill's to fill). Event actors are the viewer's `u:` id, `VIEWER_ACTOR_FALLBACK` without one.

The CLI adds two further paths, never written by a route, both over the in-place primitives of `infra/fs/in-place.ts`:

- The feature-level code-review mark, `WRITE_PATHS.codeReviewFeature` (`spectant gate code-reviewed F<n> [--root DIR]
  [--yes]`, `server/src/writes/feature-gate.ts`, its command `server/src/cli/feature-gate-command.ts`; no `WRITE_TABLE`
  row). It refuses while a spec of the feature still holds an
  open claim, appends one `code-review → close` event per target, then writes the `scope: F<n>` mark with the tree id
  of the target's checkout as it then stands, so the mark reads fresh while `.gates/` stays outside the tree. Each
  target is placed by the one worktree view the app reads (spec 041, ISC-211): the event and the mark go into the
  spec's read source (`readSpecSource`, the worktree copy when `specs/` is tracked there), and the tree, `HEAD` and
  branch come from the spec's live worktree inside the repository, else from the main checkout. Without `--yes` it
  prints the plan, with source and checkout per target, and writes nothing; `tests/gates.test.ts` (`-t feature`,
  `-t "cli mark worktree"`) holds its probes.
- The token measurement, `spectant tokens --yes`, takes its target from `WRITE_PATHS.tokens`; it belongs to no spec, so
  no claim holds it.

The seventh path is a route again: the feature backlog (spec 036, `WRITE_PATHS.backlog`, `writeBacklog`,
`writes/backlog.ts`), `POST /api/workspaces/:ws/backlog`. It rewrites `specs/backlog.md` in place and appends one line
to `specs/backlog.events.jsonl`, at the main checkout, under the raw sha256 check (the client's
`PlanningModel.backlogHash`). It reads no lock source and never answers 423. Reason: the file belongs to no spec and
no agent writes it, so no claim can hold it, and a lock check would block the backlog during every implementation
round for nothing. core plans the write (`planBacklogMove`, `planBacklogPriority`); a refusal is 422 `backlog-refused`
with core's reason, and nothing is written.

The eighth path is the run release (spec 040, ISC-226, `WRITE_PATHS.runRelease`, `writeRunRelease`,
`writes/run-release.ts`), `POST /api/workspaces/:ws/runs/:run/release`. Its one file is `.spectant/activity.jsonl` at the
main checkout, and its one change is one appended `run-end` line with `outcome: released`, the run's `command` and
`spec` or `idea`, and the viewer's `u:` id as `session`: one `appendInPlace`, never a rewrite, no directory created.
The client sends the raw sha256 of the whole file it rendered in `X-Spectant-Activity-Hash` (the dashboard sends it);
the order is 400 (no hash header) → 404 (no such open run, unknown or already ended, as core's `activityReading` reads
the file) → 409 `hash-mismatch` with the hash now → 422 `release-refused` (`no-viewer` without a `u:` id, there is no
fallback; `run-aborted` when core's `runLockOf` reads the run `aborted`) → 200. No claim lock is read and no run locks
it, so no 423. Reason: the plugin writes every other line of the file (its hooks the `claim`, `dispatch`, `build` and
`release` of a builder whose brief carries the marker line, `spec-check` the rest; spec 032) and the app only reads
it, so the app may only add one complete line, and only over the exact bytes the user saw; a line the plugin appended
meanwhile is the 409, never a torn or lost line.

The guard is `tests/readonly.test.ts`: it hashes a registered repository, `.git/` included, before and after every
read route and every refused write, and after an accepted one only the files of that write's `WRITE_PATHS` entry may
differ, `spectant tokens --yes` included (`-t tokens`).

- The allocation's number is one past the highest taken by a folder in `specs/` or `specs/archive/` and by a branch name
  or a path added to history (`infra/git/refs.ts` `takenSpecNumbers`). A story has no claims, so the allocation never answers
  423 `locked`, and it answers 423 only while a run is open on the idea (`run-locked`, below); its `lockSource` still
  names the source consulted. 422 `allocate-refused`: `not-in-index` or `folder-exists`.

- The client sends the hashes it rendered (`X-Spectant-Reviewed-Hashes` for the three gate files, `X-Spectant-Tasks-Hash`
  for `tasks.md`); the server re-reads and re-hashes before writing. A mismatch is 409 `hash-mismatch` with the current
  hashes, and the file stays byte-identical. Reason: the user confirms what they saw, never what the file became
  meanwhile (ISC-25, ISC-26).
- Lock sources come from `core/`'s `readLockSources`: LifeOS frontier locks when the state directory is present,
  `.spectant/activity.jsonl` when present. Any lock on the spec is 423 `locked` with the session and source; with no
  source at all the write proceeds under the hash check and the answer says `lockSource: 'none'`, which the page shows
  as "no agent source". Reason: an agent mid-claim must not race the user (ISC-27, ISC-86), and a missing source is
  reported, never guessed.
- Beside `locked`, a 423 has the reason `run-locked` (spec 040, ISC-225): while a run on the write's item is
  `running` (an open `run-start` in `.spectant/activity.jsonl`, younger than the `runAbortMinutes` setting), the stage
  move, the reviewed mark and the tick of that spec, and the allocation of that story, answer 423
  `{error: "run-locked", run, command, actor, since}`. `writes/run-write.ts` checks it strictly after `blockingLock` and asks
  core's `runLockOf`, never deciding running itself; an `aborted` run locks nothing. The order is 400 → 404 → 409 →
  423 (`locked`, then `run-locked`) → 422. Reason: the user must not move what a command is writing right now, and a
  stale hash stays the plain 409 so the client reloads (`tests/run-lock.test.ts`, `tests/readonly.test.ts -t run-lock`).
- The reviewed mark, the tick and the stage move target the spec's read source (spec 027, T22, ISC-181): the route
  passes `readSpecSource(root, ref).dir`, the worktree copy's folder when `specs/NNN-slug/` is tracked and the spec has
  a worktree, so the file hashed and written is the one the client's hash came from; the lock sources stay at the
  repository root, and a source that switched between render and write is the plain 409 with `files`. The allocation
  always targets the main checkout (`WRITE_TABLE[op].root`). Reason: the main checkout stays byte-identical while a round
  runs in the worktree (`tests/readonly.test.ts -t worktree-copy`).
- The write goes straight to the target with an fsync: no temp file, no rename, no git object, and `.gates/` is the
  one directory the gate write may create. Reason: the read-only rule's carve-out names exactly these paths, and
  `tests/readonly.test.ts` hashes the whole repository, `.git/` included, before and after.
- Ticking a box that already has the wanted state is a 200 with the unchanged line and no write. Reason: a retry
  after a lost answer must not flip the box back.

## Hard rules

- Bind to `127.0.0.1` or `::1` only, never `0.0.0.0`. The app is a local single-user tool (ISC-1).
- Make no outbound request. Loopback is the only network, and the dev-services probe checks local listeners only
  (ISC-2).
- Never write into a registered repository beyond the eight write paths above: no other file, no `.git/` object, no index,
  no lock, and no shelling out to git for anything that writes. `tests/readonly.test.ts` hashes the fixture repo, `.git/` included, before and after
  (ISC-15).
- The database holds only the registry, the settings and the notes (spec 002, `note` table from migration 2, `pinned` from migration 3: a note belongs to a workspace and carries at most one anchor — spec, claim or task — enforced by the schema's CHECK; removing a workspace orphans its notes), the actors (spec 008, `actor` table from migration 4: a `u:` id with a display name and its git addresses as a JSON array), the board query (spec 008, `board_query` table from migration 5: the board's last query string per workspace slug) and the favourite specs (spec 052, `spec_favorite` table from migration 6: one row per workspace slug and spec id; they live nowhere else, so losing the data directory loses them), never anything a repository says. Deleting it must lose nothing
  a re-add cannot rebuild (ISC-7).
- The API never returns an absolute path. It returns only `pathTail`, the last path segment, because the model reaches
  the browser and screenshots (ISC-3).

## Generated files

- `server/embedded.gen.ts`: generated by `scripts/embed.ts` and never edited by hand. Regenerate it instead.

## Conventions

- Port 7717, falling forward to the next free port, so a second instance still starts. `--port N` overrides it and
  `--no-browser` skips the open.
- The data directory is `$XDG_DATA_HOME/spectant` when that variable is set, otherwise `~/.spectant/`, following the
  XDG convention (ISC-21).
- The version is inlined at build time with `--define`, because a compiled binary has no `package.json` beside it.
- Every JSON route sends an ETag, so the live stream's revalidations and the fallback poll stay cheap.
- Embedded assets are served through an explicit content-type map (html, js, css, woff2, svg, json). The binary has
  no filesystem to guess from.
- Unknown non-API paths fall back to `index.html`, so `/w/…` deep links load the app.
- When `lsof` is absent, the services section is empty, never an error. A missing tool must not break the dashboard.
- Workspace slugs are the path's basename, deduplicated with `-2`, `-3`, so a slug is unique and stable.
- Scripts are `#!/usr/bin/env bun` TypeScript, never shell, because one language keeps the lane testable.
  `install.sh` is the one exception.
- `install.sh` is POSIX `sh`, because it runs before Bun exists on the machine. It never edits an rc file. It prints
  the PATH line instead.

## Verification

- `bun test tests/`: the lane probe.
- `bun run test:binary`: proves the compiled binary from an empty directory (ISC-8.1).
- `bun run test:install:linux`: runs `install.sh` as a non-root user in an Ubuntu container against a local release
  directory (ISC-10 to ISC-12).
- `bun run build`: the four-target build, darwin-arm64, darwin-x64, linux-arm64 and linux-x64 (ISC-8).

## The live update stream (spec 030)

- `GET /api/events` (`EVENTS_PATH`, `server/src/live/events.ts`) is the push path. While at least one stream
  is open, `server/src/live/hub.ts` watches (over `infra/fs/watch.ts`), per registered repository and per live spec worktree inside it, `specs/`
  recursively, the root for `ISA.md` and `.spectant/`. It watches directories, never the files themselves, so an
  editor's write-and-rename still reports. Reason: these are the files the read routes read; a change only in git
  state (a commit, a merge) is left to the poll.
- Changes are collected for `SETTLE_MS` per workspace. The read routes they touch (the workspace list, the dashboard,
  the planning tree, each changed spec by the id `core/`'s `specIdOfPath` reads) are then answered once by the same
  composed handlers a poll reaches and sent to every stream as one `update` frame (`LiveUpdate`). Reason: the bytes
  and ETags equal a GET's, so the client primes its cache and revalidates to 304s, and nothing is modelled twice.
- One build per workspace at a time; a change during a build is folded into one follow-up.
- Before each build the stream runs its `scan` hook (spec 057, ISC-352): `favoritesScan` deletes the `spec_favorite`
  rows of specs neither the main checkout (open, not archived) nor a live spec worktree carries. No GET handler prunes
  (ISC-353). Reason: a favourite of an archived spec must not come back when the spec is restored, and a read must
  never write.
- A `: ping` comment every `HEARTBEAT_MS` (5 s) keeps the stream under Bun's 10 s idle timeout and re-syncs the
  watchers with the registry and the worktrees.
- Watchers exist only while a stream is open, and they only read: `tests/readonly.test.ts -t "readonly: live"`
  hashes the repository and its worktrees around an open stream; `tests/live.test.ts` is the 2 s probe (ISC-28).

## LifeOS detection

- LifeOS is present only when `SPECTANT_LIFEOS_STATE_DIR` names an existing directory by an absolute path, detected
  once at start; no default location is derived or probed (`server/src/infra/lifeos.ts`, ISC-37); the route is
  `server/src/settings/lifeos-route.ts`.
- Absent means no LifeOS path is read: the dashboard reads only the repository's own `.spectant/activity.jsonl`.
  Present adds the frontier locks through `core/`'s `readLockSources`. `GET /api/lifeos` answers `{present}`, never the path.

## Git reads

- Every function in `server/src/infra/git/` (`index.ts` its surface) runs only read-only git commands under one environment and root rule, never
  fetches and never throws: no repository, no git, a failure or the deadline answers `source: 'none'` or empty / null.
- A `CommitCache` keyed by root and folder skips `git log` while `HEAD` is unchanged; the returned `head` belongs in the timeline route's ETag. No other git command is added without a read-only proof in `tests/git.test.ts` (ISC-15).
- The worktrees are read once per workspace state, not per caller (spec 041, ISC-215): `readWorktreeView` (the
  listing, the merge state, `ahead`, `dirty` and `ls-files` per live spec worktree, four worktrees at a time), the
  listed paths of `worktreeTreeId`, the viewer's address, `mergeCommitOf` and the `CommitCache` hit are kept while
  `infra/git/repo-state.ts`' `repoStateOf` stands. That key is read from the file system alone (`HEAD`, the indexes, `packed-refs`,
  `refs/heads/`, the config files, each linked worktree's `HEAD`, index and folder), so a repeat poll, a spec route, a
  library document or a search keystroke starts no git process. An edit that touches no index does not move it: the
  dirty mark follows on the next commit, stage or ref move.
- The same view carries the facts the read source of a repository file and of a spec only a worktree carries is decided
  on (spec 039, ISC-208.1, ISC-209), read once per state like the rest: per spec worktree inside the repository
  `trackedPlanningPaths` (`ls-files -z -- specs/ ISA.md`), per live spec worktree its `changedPaths` (the `status`
  listing `dirty` answers from, now with `-z`) and `lastCommits` (one `log --no-renames --format=%x01%cI --name-only -z`
  over `REPO_SOURCE_PATHS`), and the same three in the main checkout, `status` and `log` limited to those paths.
  `readRepoFile` reads the bytes and, for a changed file, the mtime fresh on each call; `core/`'s `repoFileSourceOf`
  decides. A timeout leaves a file on the main checkout. `tests/git.test.ts -t "planning reads"` is the read-only proof.
- Every read inside a worktree that could run a repository-configured command runs without it (ISC-216.2): `status`
  with `core.fsmonitor=false`, each configured filter driver emptied and `--ignore-submodules=all`; `ls-files` with
  `core.fsmonitor=false`.
