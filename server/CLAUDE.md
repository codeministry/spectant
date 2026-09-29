# server lane

Working notes for the `server` lane: paths `server/`, `scripts/`, `tests/`, `install.sh`. The root `CLAUDE.md` still
applies; this file adds only what is specific to the lane.

**Lane probe:** `bun test tests/`. It must be green at every stop in this lane.

## Purpose

The Bun server and the CLI inside the compiled `spectant` binary. It stays thin: it resolves workspaces from the
SQLite registry, asks `core/` for the dashboard model, serves settings and serves the embedded Angular build.
Everything visual lives in `web/`, and all spec parsing lives in `core/`. Parsing here would make a second parser
(ISC-5).

## Seams

- `server/src/assets.contract.ts`: the build contract between the Angular output and the embedded manifest (T6).
- `core/src/dashboard.ts`: the dashboard model type shared by server and web (T44). The server returns it as it is
  and never reshapes it.

This lane builds against both seams and does not define what they contain.

**Spec routes.** `server/src/spec-routes.contract.ts` is the one source for every `/api/workspaces/:ws/specs/:id…`
route: builders, `matchSpecPath`, 200 types (core types only), error bodies, write bodies, `SPEC_ROUTE_TABLE`. The
server, the e2e stub and the web import it; nobody re-types a route. Error codes are kebab-case, `{error: "not-found"}`,
as every existing route answers (plan 002's `not_found` is superseded). `tests/spec-routes.contract.test.ts` pins it.
`server/src/spec-routes.ts` serves every GET from the files (one `core/` call per route, ETag/304, the two hash headers,
404 without fallback); `evidence.ts` serves evidence files, 403 outside `artifacts/` and `.evidence/`. `writes.contract.ts` (T67) types the two
POST writes; `writes.ts` (T68) performs them under `gate-route.ts` (T69) and `checkbox-route.ts` (T70), wired into `spec-routes.ts`; `tests/writes.test.ts` holds their probes. Commits come from `git.ts` with the process's one
`CommitCache` (`commitCache` option); the timeline's ETag folds in `HEAD` when the workspace is a repository of its own.

## The write path (spec 002)

The app writes exactly two things into a registered repository, both on a user action, both through `writes.ts` and
typed by `writes.contract.ts`: the reviewed mark (`.gates/reviewed.json` in the old skill's byte format plus one
`review → build` line appended to `events.jsonl`, actor `app`) and one task checkbox (one `[ ]` ↔ `[x]` flip on one
line of `tasks.md`, line endings kept).

- The client sends the hashes it rendered (`X-Spectant-Reviewed-Hashes` for the three gate files, `X-Spectant-Tasks-Hash`
  for `tasks.md`); the server re-reads and re-hashes before writing. A mismatch is 409 `hash-mismatch` with the current
  hashes, and the file stays byte-identical. Reason: the user confirms what they saw, never what the file became
  meanwhile (ISC-25, ISC-26).
- Lock sources come from `core/`'s `readLockSources`: LifeOS frontier locks when the state directory is present,
  `.spectant/activity.jsonl` when present. Any lock on the spec is 423 `locked` with the session and source; with no
  source at all the write proceeds under the hash check and the answer says `lockSource: 'none'`, which the page shows
  as "no agent source". Reason: an agent mid-claim must not race the user (ISC-27, ISC-86), and a missing source is
  reported, never guessed.
- The write goes straight to the target with an fsync: no temp file, no rename, no git object, and `.gates/` is the
  one directory the gate write may create. Reason: the read-only rule's carve-out names exactly these paths, and
  `tests/readonly.test.ts` hashes the whole repository, `.git/` included, before and after.
- Ticking a box that already has the wanted state is a 200 with the unchanged line and no write. Reason: a retry
  after a lost answer must not flip the box back.

## Hard rules

- Bind to `127.0.0.1` or `::1` only, never `0.0.0.0`. The app is a local single-user tool (ISC-1).
- Make no outbound request. Loopback is the only network, and the dev-services probe checks local listeners only
  (ISC-2).
- Never write into a registered repository beyond the two writes above: no other file, no `.git/` object, no index,
  no lock, and no shelling out to git for anything that writes. `tests/readonly.test.ts` hashes the fixture repo, `.git/` included, before and after
  (ISC-15).
- The database holds only the registry, the settings and the notes (spec 002, `note` table from migration 2, `pinned` from migration 3: a note belongs to a workspace and carries at most one anchor — spec, claim or task — enforced by the schema's CHECK; removing a workspace orphans its notes), never anything a repository says. Deleting it must lose nothing
  a re-add cannot rebuild (ISC-7).
- The API never returns an absolute path. It returns only `pathTail`, the last path segment, because the model reaches
  the browser and screenshots (ISC-3).

## Layout

- `server/src/cli.ts` (with `cli-notes.ts`: `import-notes`, `export-notes`, `db rollback`), `http.ts`, `api.ts`, `registry.ts`, `settings.ts`, `notes.ts` (the note store and its routes, spec 002), `paths.ts`, `open-browser.ts`,
  `services.ts`, `assets.contract.ts`.
- `server/embedded.gen.ts`: generated by `scripts/embed.ts` and never edited by hand. Regenerate it instead.
- `scripts/build.ts`, `embed.ts`, `check-leak.ts`, `check-single-core.ts`, `check-version.ts`.
- `install.sh`: the one-line installer.
- `tests/`: Bun tests, including `binary.test.ts`, the `install/` container run and `offline-server.ts`.

## Conventions

- Port 7717, falling forward to the next free port, so a second instance still starts. `--port N` overrides it and
  `--no-browser` skips the open.
- The data directory is `$XDG_DATA_HOME/spectant` when that variable is set, otherwise `~/.spectant/`, following the
  XDG convention (ISC-21).
- The version is inlined at build time with `--define`, because a compiled binary has no `package.json` beside it.
- Every JSON route sends an ETag, so the web app's polling stays cheap.
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

## LifeOS detection

- LifeOS is present only when `SPECTANT_LIFEOS_STATE_DIR` names an existing directory by an absolute path, detected
  once at start; no default location is derived or probed (`server/src/lifeos.ts`, ISC-37).
- Absent means no LifeOS path is read: the dashboard reads only the repository's own `.spectant/activity.jsonl`.
  Present adds the frontier locks through `core/`'s `readLockSources`. `GET /api/lifeos` answers `{present}`, never the path.

## Git reads

- `server/src/git.ts` `commitsFor(root, folder, {limit 200, timeoutMs 3000, files?, cache?})` runs only `rev-parse HEAD` and `git log -- <folder>` (optional locks off, literal pathspecs, discovery stops at the root), never throws: no repo, no git, failure or deadline → `source: 'none'` + `diagnostic`.
- A `CommitCache` keyed by root and folder skips `git log` while `HEAD` is unchanged; the returned `head` belongs in the timeline route's ETag. No other git command is added without a read-only proof in `tests/git.test.ts` (ISC-15).
