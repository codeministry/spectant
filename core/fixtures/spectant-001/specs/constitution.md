---
repo: spectant
derived: 2026-09-28
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
dev_services: 7717=Spectant, 4200=Web dev
stack: [bun, typescript, angular, daisyui]
---

# Constitution — spectant

> Derived on 2026-09-28 from the sources listed below. The rules live in those sources;
> this file says which of them bind spec work, where to read them, and what proves them.

## What a spec may contain

This repository is public from its first commit, so three rules hold for everything under `specs/`.

**Everything under `specs/` is English.** Slugs, branch names, prose, claims, decisions. The house default of German
prose for private repositories does not reach a public one.

**A spec names no person, customer, machine or private repository.** Where a claim needs one, it says "a registered
workspace" or "the principal's installation" and stops there. The concrete words live in a private deny-list outside
this repository; the public leak check covers the generic classes.

**A spec carries its claim text, not only its claim ID.** The master `ISA.md` is untracked, so an ID alone is an
address into a private register. Whatever cannot be written this way stays in the master.

## Binding sources

| Source | Kind | Governs |
|--------|------|---------|
| `~/.claude/LIFEOS/USER/ENGINEERING/` — `STANDARDS.md`, `FRONTEND.md`, `DESIGN.md` (app track), `VERIFICATION.md`, `DELIVERY.md` § Continuous delivery | house | cross-cutting rules, the Angular frontend, the app design track, the three-tier ladder, CI |
| `ISA.md` § Principles, § Constraints | repo, **untracked** | files are the truth, skill works alone, every step is a transition, local by design, inherited look in light and dark, LifeOS optional, binary targets, loopback only, write rules |
| `FORMAT.md` and `core/fixtures/` (owed by spec 001) | repo | the file contract between skill and app: frontmatter, claims, stages, events, activity |
| The old Spec skill's pages in their light and dark theme | reference | the design source: palette in both themes, card anatomy, icon set. Never a measurement target; visual regression runs against the app's own baseline (`ISA.md` Decisions 2026-09-28, review before implement) |
| Claude Code plugin reference (`code.claude.com/docs/en/plugins-reference`) | external | plugin and marketplace manifest shape, hooks, `bin/` on PATH |
| `github.com/danielmiessler/LifeOS` (MIT) | external, upstream | origin of the ISA format that `FORMAT.md` descends from |

`BACKEND.md` does not govern this repository: the server is Bun, not Spring Boot. `DELIVERY.md` § Images, § Charts and
GitOps and § Cluster-level concerns do not govern it either: the product is a binary and a plugin, with no image and no
cluster.

**`ISA.md` is in `.gitignore` and stays there** (ISA Decisions, 2026-09-28). A row below may rest on the master alone
only until a tracked source carries the same rule; spec 001 owes `README.md`, a root `CLAUDE.md` and `FORMAT.md`, and
when they land every row that names only `ISA.md` is re-pointed and this file is re-derived.

**Design track `app`,** derived from the chosen stack (Angular zoneless with an app shell, live state, write actions)
and confirmed by the principal's choice of the house frontend on 2026-09-28. The repository has no source yet, so the
evidence is the decision, not the code.

## Non-negotiables

Every rule in `STANDARDS.md` § Cross-cutting rules, `FRONTEND.md`, the app track of `DESIGN.md`, `VERIFICATION.md` §
The ladder and `DELIVERY.md` § Continuous delivery binds, except what stands under `## Adaptations` and `## Conformance
baseline`. Named individually are the rules this repository particularly rests on or whose probe resolves here.

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | house + `ISA.md` § Constraints | binding | `bun run check:static` (owed) |
| XC-02 TypeScript only | house + `ISA.md` § Constraints | binding | review |
| XC-03 never commit | house + `ISA.md` § Constraints | binding | review |
| XC-07 a convention that can be a test, is a test | house | binding | `bun run verify:quick` (owed) |
| XC-09 pin everything | house | binding | review: bun, Angular, daisyUI and Tailwind versions pinned |
| XC-10 nothing individual in a committed file | house + `ISA.md` § Constraints | binding | `bun run check:leak` (owed) |
| XC-11 no default pointing at a real external host | house + `ISA.md` § Principles (local by design) | binding | `bun test tests/offline.test.ts` (owed) |
| XC-12 visual verification with Interceptor | house | binding | review |
| XC-13 lazy-senior-dev ladder | house | binding | review |
| FE-FW-01…07 Angular 22 zoneless, standalone, OnPush, signals | house | binding | `bun run lint` (owed) |
| DS-APP-04 no hex outside the theme files | house | binding | `bun run lint:css` (owed) |
| DS-APP-05 colour guard spec | house + `ISA.md` ISC-18 | binding | `bun test web/src/theme-colors.spec.ts` (owed) |
| DS-APP-11 Tailwind 4 CSS-first | house | binding | review |
| DS-APP-32/33 contrast for text and marks, both themes | house + `ISA.md` ISC-65 | binding | `bun run test:browser -- contrast` (owed) |
| DS-APP-38 focus ring | house + `ISA.md` ISC-64 | binding | `bun run test:browser -- focus` (owed) |
| DS-APP-42 reduced motion | house + `ISA.md` ISC-66 | binding | `bun run test:browser -- motion` (owed) |
| FE-TST-01/02/03 Vitest unit tier, real-Chromium browser tier, Playwright e2e | house | binding | `bun run test`, `bun run test:browser`, `bun run e2e` (owed) |

## Adaptations

| Rule | House default | This repo does | Recorded in | Why |
|------|---------------|----------------|-------------|-----|
| XC-04 user-facing strings German | UI strings in German | UI strings in English and German from two catalogues, English default | `ISA.md` Decisions 2026-09-28 (grill Q10) | a public product for an international audience; the German catalogue keeps XC-05 |
| DS-APP-01, DS-APP-03 brand palette | colours derived from the frozen brand hex | colours derived from the old Spec pages' light and dark values | `ISA.md` § Principles, ISC-18 | the inherited look is the specification; there is no separate brand |
| DS-APP-06 asymmetric light and dark | light tints the page, dark makes the page darkest | whatever the old pages do in each theme | `ISA.md` § Principles | inheriting the look wins over the house default where they differ |
| DS-APP-08 tokens from one shared package | consume the shared token package | own two themes `spec-light`, `spec-dark` | `ISA.md` ISC-18 | the palette is not the house palette; nothing to share |
| FE-I18N-01 route prefixes | `/de` and `/en` prefixes, German default | language is a persisted setting in the gear panel, English default; Transloco stays | `ISA.md` Decisions 2026-09-28 (review before implement) | a local single-user tool has no URL to share and an international audience; a prefix would only lengthen deep links into cmux |

## Conformance baseline

> Measured 2026-09-28 by `ls` on an empty repository: no source, no `package.json`, no CI. Nothing here was changed to
> improve the measurement.

| Rule | Status | Measured | Note |
|------|--------|----------|------|
| every tier of the ladder | grandfathered | 2026-09-28 | no `package.json`; spec 001 creates `check:static`, `verify:quick`, `verify` and clears this row |
| XC-10 leak check | not measured | 2026-09-28 | `check:leak` owed by spec 001 |
| FE-FW-*, DS-APP-* | not measured | 2026-09-28 | no Angular workspace yet |

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | — (not defined; see Conformance baseline) · target `bun run check:static` | before every claim closes |
| quick | — (not defined; see Conformance baseline) · target `bun run verify:quick` | at every implementation stop |
| full | — (not defined; see Conformance baseline) · target `bun run verify` (adds the browser tier `test:browser`, the Playwright suites `e2e` and `test:visual` in both themes, and the four-target build) | before a spec is marked complete |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| core | `core/`, `FORMAT.md` | `FORMAT.md`, `core/CLAUDE.md` | `bun test core/` |
| server | `server/`, `scripts/`, `tests/`, `install.sh` | `server/CLAUDE.md` | `bun test tests/` |
| web | `web/` | `web/CLAUDE.md`, house `FRONTEND.md`, `DESIGN.md` app track | `bun run --cwd web test` |
| plugin | `plugin/`, `.claude-plugin/` | `plugin/CLAUDE.md` | `bun test plugin/` |
| repo | root files (`package.json`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `README.md`, `CLAUDE.md`), `.github/` | root `CLAUDE.md` | `bun run check:static` |

## How specs are held to it

Every new spec is read against `## What a spec may contain` and `## Non-negotiables` before its claims are minted. A
plan that departs from a `binding` row names the rule in `## Stack Decisions` with the reason, and the deviation lands
in the master's Decisions before any code does. A visual claim is held in both themes or it is not a visual claim. A
row in `## Conformance baseline` is cleared by the spec that creates its probe, and that spec says so in
`## Conformance Impact`.
