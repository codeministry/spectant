---
spec: 013-tech-debt
plan: plan.md
updated: 2026-09-24
---

# Tasks 013 — The debt behind v0.5.0 is paid down without a change in behaviour

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from
`spec.md`. This file defines nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the
path column: `server` for `backend/`, `web` for `frontend/`, `infra` for compose, Dockerfiles,
workflows and `.env.example`, `docs` for the working notes and `docs/`. `[seam]` = the contract
the lanes share.

The seam: `ConfigProperties` carries every `leadgen.*` key the process reads (T7). The sweep's
`StatusController` (T10) reads it; nothing on the server lane that touches it runs before.
The version mechanism is not touched (spec § Out of Scope); T8 was dropped with ISC-342.

## Tasks

- [x] T1 · ISC-337 · [P] · docs — move the four longest trap paragraphs of each working-notes file into the decisions file its table row names; leave one line with a pointer · `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `docs/decisions/*.md`
- [x] T2 · ISC-338 · [P] · docs — the Spotless sentences say what runs; `config/local/` → `config/` · `README.md`, `docs/DEVELOPMENT.md`, `.github/workflows/release.yml`, `.dockerignore`
- [x] T3 · ISC-339 · [P] · server — `EnvExampleTest`: placeholders read from the defaults, `application.yaml` and compose against `.env.example`; both files as Gradle inputs · `backend/src/test/java/de/codeministry/leadgen/config/EnvExampleTest.java`, `backend/build.gradle.kts`
- [x] T4 · ISC-339 · infra — `.env.example` gains the two missing keys with a comment each and loses the unread one (after: T3) · `.env.example`
- [x] T5 · ISC-340 · [P] · infra — healthchecks on `api` and `web`, `web` waits on `api`, `restart: unless-stopped` on all three · `docker-compose.yml`
- [x] T6 · ISC-341 · [P] · infra — bun tag pinned to `packageManager`, nginx stage non-root, the `\|\| true` gone (after: T5) · `frontend/Dockerfile`, `backend/Dockerfile`
- [x] T7 · ISC-348 · [seam] · server — `ConfigProperties` gains `version`, `ingestCron`, the two poll intervals and `security.allowOpenBind`; the five `@Value` sites read it; `StatusController` on `@RequiredArgsConstructor` · `backend/src/main/java/de/codeministry/leadgen/config/ConfigProperties.java`, `web/StatusController.java`, `security/SecurityConfig.java`, `ingest/ScheduledPass.java`, `config/ConfigWatcher.java`, `ingest/ScoreBatchCollector.java`
- [x] T9 · ISC-346 · server — `IngestService` keeps its connector list and looks a type up through a private helper, so its constructor only assigns; no new bean (after: T7) · `backend/src/main/java/de/codeministry/leadgen/ingest/IngestService.java`
- [x] T10 · ISC-346 · server — the sweep: `spotlessApply`, then `@RequiredArgsConstructor` on every class whose constructor only assigned, then `spotlessApply` again; one commit, no test file (after: T9) · `backend/src/main/java/**` (64 classes)
- [x] T11 · ISC-347 · [P] · server — `@Builder` on `IngestReport`; the two constructions in `runOnce` become one builder call (after: T7) · `backend/src/main/java/de/codeministry/leadgen/ingest/IngestReport.java`, `ingest/IngestService.java`
- [x] T12 · ISC-349 · [P] · server — `ModelChoice` in `llm/`; the five copies call it (after: T7) · `backend/src/main/java/de/codeministry/leadgen/llm/ModelChoice.java`, `score/Judges.java`, `content/Classifiers.java`, `fields/FieldExtractors.java`, `ingest/extract/LlmExtractors.java`
- [x] T13 · ISC-343 · [P] · web — `DestroyRef` removes the media-query listener; `takeUntilDestroyed` on the ask request; a spec per teardown · `frontend/src/app/features/shortlist/shortlist-page.ts`, `shortlist-page.spec.ts`, `frontend/src/app/features/offer-detail/ask-panel/ask-panel.ts`, `ask-panel.spec.ts`
- [x] T14 · ISC-344 · [P] · web — route titles as catalog keys through a `TitleStrategy` with the brand constant; the manual store's three fallbacks as `error.*` keys; the parity spec's unused-key check · `frontend/src/app/app.routes.ts`, `frontend/src/app/core/i18n/title.strategy.ts`, `frontend/src/app/app.config.ts`, `frontend/src/app/core/store/manual.store.ts`, `frontend/public/i18n/en.json`, `frontend/public/i18n/de.json`, `frontend/src/app/core/i18n/i18n-parity.spec.ts`
- [x] T15 · ISC-345 · [P] · web — `prefix: lg`, `experimentalDecorators` removed, `@angular/forms` removed · `frontend/angular.json`, `frontend/tsconfig.json`, `frontend/package.json`, `frontend/bun.lock`
- [x] T16 · ISC-350 · server — the anti probe: migrations byte-identical to `main`, no `Mapping(` line in the web diff, every `*ControllerTest` and `LeadGenRuntimeHintsTest` green, `processAot` green, the api image built and smoked (after: T7, T10, T11, T12) · (probe only)
- [x] T17 · ISC-351 · docs — the record: `CHANGELOG.md` § Unreleased, `docs/decisions/configuration.md` on the `.env.example` contract and on why the version mechanism stays (after: T1, T4, T10) · `CHANGELOG.md`, `docs/decisions/configuration.md`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1 | ISC-337 | `wc -c` on the three files; `WorkingNotesStaySmallTest` |
| T2 | ISC-338 | `rg` for Spotless sentences and `config/local` |
| T3, T4 | ISC-339 | `EnvExampleTest`, red on a removed line and on a stray key |
| T5 | ISC-340 | `docker compose config`; `up -d --wait`; `ps` all healthy |
| T6 | ISC-341 | `rg` on both Dockerfiles; both `docker build`s |
| T7 | ISC-348 | `rg -c '@Value('` = 0; the three named tests |
| T9, T10 | ISC-346 | assignment count ≤ 25; `:backend:test` green; test tree diff empty |
| T11 | ISC-347 | `rg -c 'new IngestReport('` = 0 in main; the two named tests |
| T12 | ISC-349 | `rg 'scoringChoices()'` two sites; `ScoringWithoutAModelTest` |
| T13 | ISC-343 | the two teardown specs |
| T14 | ISC-344 | the parity spec; `rg` on routes and the manual store |
| T15 | ISC-345 | `rg` on the three files; `check:static` and `test` |
| T16 | ISC-350 | the migration diff; the web diff filtered to `Mapping(`; every controller test and the hints test; `processAot`; the image smoke |
| T17 | ISC-351 | `rg` on the changelog and the decisions file; `WorkingNotesStaySmallTest` |
