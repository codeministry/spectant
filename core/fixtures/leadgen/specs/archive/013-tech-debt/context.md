---
spec: 013-tech-debt
created: 2026-09-24T15:40:00Z
updated: 2026-09-24T15:55:00Z
rounds: 3
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 013 — The debt behind v0.5.0 is paid down without a change in behaviour

## Goal — confirmed 2026-09-24T15:45:00Z

The afternoon-sized debt is paid — working-notes budgets, stale documentation, `.env.example`
held to the placeholders by a test, compose health, the Dockerfile pins, one version source
reaching the status endpoint and the user agent, two listener leaks, the catalog literals, the
frontend hygiene, and the Lombok sweep — with every request mapping, response field, migration
and configuration key meaning what it meant before.

Principal's words, verbatim: "lombok muss auch integriert werden, damit der code schlanker wird. weiter ideen?"

The words are his reply to the tech-debt audit (`/engineering:tech-debt`, 2026-09-24), which
ran as a plan-mode audit first: three read-only surveys (backend, frontend, infra/docs/config),
the top findings re-verified by hand, 33 items scored with `(Impact + Risk) × (6 − Effort)`, then
a slimming section of 10 items after this reply. He then asked for the plan as a spec
("writePlan" → "Als Spec anlegen").

## Round 1 — before the spec, 2026-09-24

### Q1 · Goal lock: which sentence is the goal?
- Offered: Phase 0 + Phase 1 + Lombok starters L1, L2, L6, L7, L9 (~20 claims, recommended) | Phase 0 + Lombok only (~12 claims) | everything scored (~45 claims)
- Chosen: Phase 0 + Lombok only
- Landed in: `## Goal`, ISC-337…ISC-351; Phase 1 and later as `## Not yet specified`

### Q2 · The 27 `catch (IOException) { throw new UncheckedIOException }` wrappers (L3): part of the Lombok sweep?
- Offered: out, stays fog (recommended) | in, with `@SneakyThrows` on private helpers | in, with a functional `Io.unchecked` helper
- Chosen: out, stays fog
- Landed in: `## Not yet specified`, `## Decisions`

No third question spent. Everything else a wrong answer could change is a mark in
`spec.md` or `plan.md` (the user-agent shape, the non-root nginx mechanism, the working-notes
trim target).

`context_sufficient: true` · `interview_invoked: false`

## Round 2 — before the plan, 2026-09-24

No approach question spent: the plan's order follows the edges the claims already carry
(`ISC-348` before `ISC-346`; `ISC-337` and `ISC-346` before `ISC-351`), and every
item is small enough that the obvious path is the only one. The `plan.md` exists on the
operator's ask ("writePlan"), although the refactor type does not owe one.

## Round 3 — after the spec, 2026-09-24

### Q1 · (the operator, unprompted) "nicht ändern, damit der spring boot service weiterhin AOT-kompatibel für graalvm bleibt" — then "transitiv, heißt das oder?"
- Offered: nothing; a direction, not a question
- Chosen: the version mechanism stays as it is (ISC-342 dropped), and AOT compatibility binds every remaining claim transitively
- Landed in: ISC-350 (the anti claim now runs `processAot`, `LeadGenRuntimeHintsTest` and the image smoke), `spec.md` § Out of Scope and § Decisions, `plan.md` § Approach and § Risks; T8 removed, T16 extended

## Round 4 — during build, 2026-09-24

### Q1 · (from T15, ISC-345, lane web) `@angular/cdk` 22.1.7 requires `@angular/forms` as a peer; should the dependency stay and the claim drop its forms clause?
- Offered: A keep it, refine the claim (recommended) | B remove it and accept an unmet peer | C replace the cdk usage
- Chosen: A, by the parent — removing a required peer contradicts FE-TOOL-01 (one lockfile, peers met) for one line of `package.json`
- Landed in: ISC-345 refined master-first, `spec.md` § Decisions

### Q2 · (from T7, ISC-348, lane server) the `@WebMvcTest` slice does not register `ConfigProperties`; how does the record reach `StatusController` without a test edit?
- Offered: A `@EnableConfigurationProperties(ConfigProperties.class)` on the controller (recommended, already applied) | B a main-code configuration class the slice would not load | C an `@Import` in the test
- Chosen: A, by the parent — the only option that keeps all three test classes unchanged and green; a no-op in the full context, AOT-neutral
- Landed in: nowhere beyond the code — implementation detail; the second look on T7 checks it

### Q3 · (from the parent before T6, ISC-341, lane infra) a non-root nginx cannot bind :80, and the office chart wires `containerPort` from `web.ports.service` with its own `listen 80` ConfigMap; how should T6 handle it?
- Offered: drop the non-root clause and keep :80 (recommended) | non-root on 8080 and the chart follows | non-root on :80 via `setcap`
- Chosen: non-root on 8080, the chart follows — the operator's call
- Landed in: ISC-341's Test Strategy row (the web port), `spec.md` § Decisions, the master's § Remaining Work (the chart's `web.ports.service` and ConfigMap move to 8080 before the next office deploy)

## Round 5 — during build, 2026-09-24

### Q1 · (from T6, ISC-341, lane infra) the seed's `@NotBlank` on `version` stopped the api in the compose probe and the worker's fix was denied by the permission layer; how should the probe proceed?
- Offered: A the parent fixes the worktree copy (recommended) | B probe with `LEADGEN_VERSION=0.5.0` in the throwaway `.env` | C accept build-green only
- Chosen: A — the parent staged the main tree's fixed backend files into the worktree; the probe then ran green against the same code the main tree carries
- Landed in: nowhere beyond the round; the defect itself is ISC-348's Decisions row

### Q2 · (parent, from T6's mark) pinning `oven/bun:1.3.12-alpine` breaks the image build because the Angular CLI refuses bun's node shim; the worker had added an unpinned Alpine `nodejs`
- Offered: unpinned `apk add nodejs` | a pinned `node:22.23.3-alpine` base with the pinned bun binary copied onto it | bump bun to 1.4.x everywhere
- Chosen: the pinned Node base — two exact tags, no package manager call, `packageManager` untouched
- Landed in: `frontend/Dockerfile`; `BunPinTest` and the Renovate `bun` group from the second look

## Round 6 — during build, 2026-09-24

### Q1 · (from T9+T10, ISC-346, lane server) the strict rule leaves 104 assignments, not 25, and a `SourceConnectors` parameter breaks `IngestOrderTest`; how to proceed?
- Offered: A inject the `JdbcClient` bean and let `IngestService` look its connector up in the list (recommended) | B keep the rule, edit the one test line, threshold ~85 | C record 104
- Chosen: A, by the parent — reaches the number without a test edit and pays the audit's item 22 (33 `create` calls → one bean)
- Landed in: ISC-346 refined master-first; `spec.md` § Decisions

### Q2 · (from the same worker, second return) the rule leaves 32, all excluded; move the threshold or widen the rule?
- Offered: threshold 32 | widen to make the four remaining builders beans
- Chosen: threshold 32, then 31 after the second look (Max) found a class hidden by a raw NUL byte and five constructors outside the candidate list; the builders-to-beans idea is Phase 2 fog
- Landed in: ISC-346 and its Test Strategy row (`rg -a`), `spec.md` § Decisions

### Second looks skipped
- T15 (ISC-345): skipped for cause — two configuration lines (`prefix`, `experimentalDecorators`), three green probes in the worktree and again in the main tree. A reader would have read two lines.

## Still open
- fog: model calls inside `@Transactional` — a Phase 1 spec
- fog: the open run row in `ScoreBatchCollector.poll` — with it
- fog: the mixed Testcontainers classpath, and the 39 per-class container declarations — a dependency spec
- fog: the enrichment silences — a Phase 1 spec
- fog: stale-language computeds and the unhashed catalogs — with F40's cache policy
- fog: the `UncheckedIOException` wrappers — a Decisions row before any claim
- fog: Phase 2 and Phase 3 of the audit — one spec per lane, each a decision first
