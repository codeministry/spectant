---
spec: 013-tech-debt
type: refactor
status: draft
updated: 2026-09-24
---

# Plan 013 — The debt behind v0.5.0 is paid down without a change in behaviour

**Purpose:** how the claims in `spec.md` get built. The what lives there; this file
holds no acceptance criterion. A refactor does not owe a plan; this one exists on the
operator's ask, because fifteen small items across four lanes still need an order.

## Approach

Three sittings, each a commit the operator can review on its own. The first is prose and
configuration and touches no Java or TypeScript that runs: the working-notes trim, the
documentation corrections, `.env.example` with its test, compose health, the Dockerfile pins.
The second is the backend, in the one order the claims impose: the `@Value` keys onto
`ConfigProperties` first (ISC-348), because `StatusController` cannot take
`@RequiredArgsConstructor` while its parameters carry `@Value`;
then the `SourceConnectors` bean and the Lombok sweep as one mechanical commit after
`spotlessApply` (ISC-346), with the builder (ISC-347) and `ModelChoice` (ISC-349) beside it. The
third is the frontend: the two teardowns, the `TitleStrategy`, the catalog keys, the three
config lines. The record (ISC-351) closes each sitting's part as it lands, not at the end.

One constraint runs through all three sittings and is the operator's: the service stays
AOT-compatible for GraalVM, transitively. Nothing here touches the version mechanism
(`LEADGEN_VERSION` over a literal default, no build info in the jar), and every backend change is
of a kind AOT already handles — Lombok is compile-time, a constructor-bound record binds at
build time, a bean is a bean. The anti claim ISC-350 runs `processAot`, the hints test and the
image smoke at the end of each backend sitting, not only at the end.

The obvious alternative was one branch, one commit, everything at once. It was set aside because
the Lombok sweep touches 64 files and the reviewer needs to see that diff alone: a rename hidden
in a 90-file commit is exactly how a hand-written constructor that did work gets replaced by one
that does not. The sweep is mechanical only when it is the only thing in its commit.

## Stack Decisions

| Rule | Chosen | Alternatives | Why | Probe | Recorded in |
|------|--------|--------------|-----|-------|-------------|
| BE-QUA-02 (Spotless) | the sweep commit runs `spotlessApply` first, then the annotation edits, then `spotlessApply` again, so the diff is the annotations alone | edit then format once (formatting churn lands in the same diff) | a formatter bump or a stale index has produced a "green locally, red in CI" before (house memory); two passes keep the reviewable diff to the intent | `./gradlew check` (quick tier) | this row |

No `binding` row of the constitution is departed from. `XC-08` (working notes stay small) is the
rule ISC-337 exists to keep with headroom.

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
| `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md` | the four longest trap paragraphs per file move out; one line with a pointer stays | ISC-337 |
| `docs/decisions/pipeline-ingest.md`, `pipeline-enrich-content.md`, `retrieval.md`, `configuration.md`, `frontend-design-system.md`, `frontend-split-views.md` | receive the moved paragraphs under the topic that owns them | ISC-337 |
| `README.md` § What does not work yet, `docs/DEVELOPMENT.md:27`, `.github/workflows/release.yml:32` | the Spotless sentences say what runs | ISC-338 |
| `CLAUDE.md:18`, `.dockerignore:10` | `config/local/` → `config/` | ISC-338 |
| `.env.example` | `RETRIEVAL_TOPIC_FLOOR` and `LEADGEN_CONFIG_MOUNT` added with a comment each; the unread key removed | ISC-339 |
| `backend/src/test/java/de/codeministry/leadgen/config/EnvExampleTest.java` (new) | reads the placeholders out of the five defaults, `application.yaml` and `docker-compose.yml`; compares with `.env.example`; declared as a Gradle input | ISC-339 |
| `backend/build.gradle.kts` | `.env.example` and `docker-compose.yml` as `inputs.files` of `test` | ISC-339 |
| `docker-compose.yml` | healthchecks on `api` (`/actuator/health`) and `web` (`/`), `web` `depends_on: api: condition: service_healthy`, `restart: unless-stopped` on all three | ISC-340 |
| `frontend/Dockerfile` | `oven/bun:1.3.12-alpine`; nginx stage as non-root ⟨?: `nginxinc/nginx-unprivileged:1.27-alpine` on port 8080 with the compose port mapping following, rather than a hand-rolled `USER` plus writable `pid` and cache paths on the stock image — unsure which the operator prefers; the unprivileged image is the smaller diff⟩ | ISC-341 |
| `backend/Dockerfile` | the `\|\| true` on the dependency warm-up goes | ISC-341 |
| `backend/src/main/resources/application.yaml` | unchanged: `leadgen.version: ${LEADGEN_VERSION:0.5.0}` stays, the record binds what is there | ISC-348 |
| `backend/src/main/java/de/codeministry/leadgen/config/ConfigProperties.java` | gains `version`, `ingestCron`, `configPollInterval`, `scoreBatchPollInterval`, nested `security.allowOpenBind`, with the defaults `@Value` carried, as `@DefaultValue` on the record components | ISC-348 |
| `web/StatusController.java`, `security/SecurityConfig.java`, `ingest/ScheduledPass.java`, `config/ConfigWatcher.java`, `ingest/ScoreBatchCollector.java` | read the record; `@Value` gone; `StatusController` on `@RequiredArgsConstructor` | ISC-348 |
| `ingest/SourceConnectors.java` (new), `ingest/IngestService.java` | the connector map as a bean; `IngestService` on `@RequiredArgsConstructor` | ISC-346 |
| 63 further classes under `backend/src/main/java` (the survey's list; `ShortlistSort`, `OfferController`, `ScoringService`, `ChatClientJudge`, `PackagingService`, `ConfigController`, `ScoreBatchService`, `LlmExtractor`, `OfferRefetch`, `AdFetcher`, `ContentService` carry the most) | hand-written assignment constructor → `@RequiredArgsConstructor`; classes whose constructor does work (`ConfigRegistry`, `ConfigLoader`) stay as they are | ISC-346 |
| `ingest/IngestReport.java`, `ingest/IngestService.java:379,404` | `@Builder` on the record; the two constructions become one builder call | ISC-347 |
| `llm/ModelChoice.java` (new), `score/Judges.java:67,115`, `content/Classifiers.java:63`, `fields/FieldExtractors.java:69`, `ingest/extract/LlmExtractors.java:131` | the five copies call the one | ISC-349 |
| `frontend/src/app/features/shortlist/shortlist-page.ts:366`, `features/offer-detail/ask-panel/ask-panel.ts:62` and their specs | `DestroyRef` removes the listener; `takeUntilDestroyed` on the request | ISC-343 |
| `frontend/src/app/app.routes.ts`, `frontend/src/app/core/i18n/title.strategy.ts` (new), `app.config.ts`, `core/store/manual.store.ts`, `public/i18n/en.json`, `de.json`, `core/i18n/i18n-parity.spec.ts` | route `title` becomes a catalog key; a `TitleStrategy` joins it with the brand constant; the three fallbacks become `error.*` keys; the parity spec gains the unused-key check | ISC-344 |
| `frontend/angular.json:15`, `frontend/tsconfig.json:35`, `frontend/package.json:28`, `bun.lock` | `prefix: lg`; `experimentalDecorators` removed; `@angular/forms` removed | ISC-345 |
| `CHANGELOG.md` § Unreleased, `docs/decisions/configuration.md` | the record | ISC-351 |

## Interfaces

| Contract | Before | After | Callers |
|----------|--------|-------|---------|
| `GET /api/v1/status` | `version` is the literal default or `LEADGEN_VERSION`, read through `@Value` | the same value, read through `ConfigProperties`; field, path and default unchanged | the header, the MCP status tool |
| `IngestReport` canonical constructor | 13 components | unchanged; a builder is added beside it | the four test classes that construct one keep doing so |

## Risks

| Risk | Blast radius | Early warning | Mitigation |
|------|--------------|---------------|------------|
| a hand-written constructor that did work is swept along and replaced by one that does not | that class's bean, at startup | context refuses to start; the suite's 36 `@SpringBootTest`s | the sweep's rule is mechanical (assignments only); `ConfigRegistry`, `ConfigLoader`, `IngestService` before its bean are the named exceptions; one commit, reviewed alone |
| Lombok on a `@Component` with a second constructor | every context (194 failures once, per `backend/CLAUDE.md`) | the same | a class keeps zero hand-written constructors after the sweep, never one |
| a backend change breaks `processAot` or the native image while the JVM suite stays green | the Docker image's startup, or one stage returning empty | `processAot` red; `LeadGenRuntimeHintsTest`; a smoke step asserting on an empty result | ISC-350 runs all three after each backend sitting; nothing in F41 adds a runtime-computed name, a reflective call or a resource |
| the non-root nginx cannot bind port 80 | the web container | the container exits at start | the unprivileged image listens on 8080 and compose maps it; the mark above |
| a moved working-notes paragraph loses its rule | a future session repeats a paid-for mistake | review | each rule keeps its one line with the pointer; the paragraph moves whole, never summarised |
| the parity spec's unused-key check flags keys read through a dynamic prefix | the frontend suite | red on a key the code builds at runtime | the check allows a prefix list, the same shape Tailwind's lookup maps use |

## Open Points

- fog: the non-root nginx mechanism. Resolves at the ISC-341 mark.
- fog: the version literals and the stale `user_agent` default (spec § Not yet specified). Resolves in a Decisions row; the mechanism is not touched.

## Conformance Impact

- `FE-TST-05 coverage as a ratchet` (grandfathered): left alone; the coverage floor is Phase 2 fog.
- `G-FE-02 i18n parity` (grandfathered): extended — ISC-344 adds the unused-key check to the parity spec that spec 002 introduced; the row's note can move to cleared once ISC-344 closes.
- `BE-ARCH-01..03 vertical slices` (not measured): left alone; the package cycles are Phase 3 fog.
