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
404 without fallback); `evidence.ts` serves evidence files, 403 outside `artifacts/`, `.evidence/` and `.design/` (the Design tab's images, spec 004). `writes.contract.ts` (T67) types the two
POST writes; `writes.ts` (T68) performs them under `gate-route.ts` (T69) and `checkbox-route.ts` (T70), wired into `spec-routes.ts`; `tests/writes.test.ts` holds their probes. Commits come from `git.ts` with the process's one
`CommitCache` (`commitCache` option); the timeline's ETag folds in `HEAD` when the workspace is a repository of its own.
Every route of spec 008 has its handler now; the pending family of the contract went with its last route, the bodies
stay in § Spec 008 bodies. The story page `idea` (`GET`/`HEAD /api/workspaces/:ws/ideas/:slug`, T88) is served by
`api.ts` from the story folder alone; the allocation `allocate` (`POST /api/workspaces/:ws/ideas/:slug/allocate`, T87) is the
workspace family's one write, served by `allocate-route.ts` through `writes.ts`; the board query (`GET`/`HEAD`/`PUT
/api/workspaces/:ws/board-query`, T92) lives in `WORKSPACE_ROUTE_TABLE` (`write: 'PUT'`) and is served from the `board_query`
table alone (the `db` option; no 409, 404 for an unknown workspace); the library (spec 017) is four workspace routes served by `api.ts`: `GET`/`HEAD /api/workspaces/:ws/library` (core's `readCatalog`, metadata only), `…/library/doc?path=` (one Markdown document of the catalog rendered as a `DocsPage`, 404 for a path the catalog does not list), `…/library/search?q=` (title and full text) and `…/library/asset?path=` (an image below `specs/` through the evidence resolver with `specs/` as the root, `reach: 'tree'`, images only), beside `GET`/`HEAD /proto/:ws/:spec/:folder/*` (one prototype file, `PROTOTYPE_CSP`); the library replaced the tech page's `…/tech` and `…/tech/asset` (T51) and the spec routes `…/evidence` and `…/docs/:name` (T53), whose requests are now the unmatched path's 404 (`tests/library-asset.test.ts`); the e2e stub picks its library with `X-Spectant-Stub-Library: catalog | empty` (`web/e2e/README.md`); the actor names (`GET`/`HEAD`/`PUT /api/actors`, T91) are a
route of their own, `ACTORS_PATH`, served by `api.ts`'s `actorsApi` over the `actor` table like `/api/settings` (PUT replaces
the whole mapping); the stage move `transition` (`POST …/specs/:id/transition`, T83) is a registered spec route served by
`transition-route.ts` through `writes.ts`, and the planning route passes the workflow and every active spec's stage and raw
`spec.md` hash into `buildPlanning`:
`markdown-docs.ts` and the raw sha256 of the file's bytes from one read, 404 for an unknown story or a workspace without stories. `writes.contract.ts` holds the four app writes in `WRITE_TABLE` and every file they may touch
in `WRITE_PATHS`; the fifth path, `WRITE_PATHS.codeReviewFeature`, is the feature-level code-review mark, written by
the CLI only (`spectant gate code-reviewed F<n> [--root DIR] [--yes]`, T93, `server/src/feature-gate.ts` over
`writes.ts`' in-place primitives; no route, no `WRITE_TABLE` row): it refuses while a spec of the main feature holds an
open claim, appends one `code-review → close` event per target, then writes the same `scope: F<n>` mark with the tree
id of the worktree as it then stands, so the mark reads fresh while `.gates/` stays outside the tree. Without `--yes` it
prints the plan and writes nothing; `tests/gates.test.ts` (`-t feature`) holds its probes.

## The write path (spec 002)

The app writes exactly four things into a registered repository, each on a user action, each through `writes.ts` and
typed by `writes.contract.ts` (`WRITE_TABLE`, `WRITE_PATHS`): the reviewed mark (`.gates/reviewed.json` in the old
skill's byte format plus one `review → build` line appended to `events.jsonl`), one task checkbox (one `[ ]` ↔ `[x]`
flip on one line of `tasks.md`, line endings kept), the stage move (`stage:` in `spec.md` plus one event line, spec
008 T82) and the allocation of a story (spec 008 T86: `specs/NNN-slug/` created with `context.md`, `spec.md` and
`events.jsonl`, and `specs/ideas/<slug>.md` removed; the index `README.md` is not touched, its `Spec` cell is the
web's or the skill's to fill). Event actors are the viewer's `u:` id, `VIEWER_ACTOR_FALLBACK` without one. The CLI's
feature-level code-review mark is a further path, never written by a route.

- The allocation's number is one past the highest taken by a folder in `specs/` or `specs/archive/` and by a branch name
  or a path added to history (`git.ts` `takenSpecNumbers`). A story has no claims, so the allocation never answers
  423; its `lockSource` still names the source consulted. 422 `allocate-refused`: `not-in-index` or `folder-exists`.

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
- Never write into a registered repository beyond the four writes above: no other file, no `.git/` object, no index,
  no lock, and no shelling out to git for anything that writes. `tests/readonly.test.ts` hashes the fixture repo, `.git/` included, before and after
  (ISC-15).
- The database holds only the registry, the settings and the notes (spec 002, `note` table from migration 2, `pinned` from migration 3: a note belongs to a workspace and carries at most one anchor — spec, claim or task — enforced by the schema's CHECK; removing a workspace orphans its notes), the actors (spec 008, `actor` table from migration 4: a `u:` id with a display name and its git addresses as a JSON array) and the board query (spec 008, `board_query` table from migration 5: the board's last query string per workspace slug), never anything a repository says. Deleting it must lose nothing
  a re-add cannot rebuild (ISC-7).
- The API never returns an absolute path. It returns only `pathTail`, the last path segment, because the model reaches
  the browser and screenshots (ISC-3).

## Layout

- `server/src/cli.ts` (with `cli-notes.ts`: `import-notes`, `export-notes`, `db rollback`; `feature-gate.ts`: `gate code-reviewed F<n>`), `http.ts`, `api.ts`, `registry.ts`, `settings.ts`, `notes.ts` (the note store and its routes, spec 002), `paths.ts`, `open-browser.ts`,
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
- `takenSpecNumbers(root, {timeoutMs?, runner?})` runs only `for-each-ref --format=%(refname) refs/heads/ refs/remotes/` and `log --all --no-renames --diff-filter=A --name-only --format= -- specs` under the same environment and root rule, and answers the numbers of `NNN-slug` segments (core's `specNumbersOf`), ascending; never a throw, `source: 'none'` and no number on any failure (T86, ISC-130.2).
- `userEmail(root, {timeoutMs?, runner?})` runs only `config --get user.email` under the same environment and root rule (repository config, then global; system config off) and answers the trimmed address or null, never a throw (T77, ISC-119); `core/`'s `actorIdOf` turns it into the `u:` id.
- A `CommitCache` keyed by root and folder skips `git log` while `HEAD` is unchanged; the returned `head` belongs in the timeline route's ETag. No other git command is added without a read-only proof in `tests/git.test.ts` (ISC-15).
