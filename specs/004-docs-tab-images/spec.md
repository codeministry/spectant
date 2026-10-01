---
task: "The Design tab shows the design pass's screenshots instead of broken images"
slug: 004-docs-tab-images
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F7
constitution: ../constitution.md
phase: scoping
progress: 0/2
started: 2026-10-01T06:35:00Z
updated: 2026-10-01T06:40:00Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F7, claims ISC-112 and ISC-113). Claim IDs belong to the master,
     which is untracked in this public repository; every claim here carries its full text so this file reads on its
     own. Sync: Skill("Spec", "sync 004-docs-tab-images"). Never edit the master from this file.
     principal_stated_goal is deliberately absent: it is German and lives only in the untracked master
     (../constitution.md § What a spec may contain). -->

# 004 — Design-pass screenshots in the Design tab

## Problem

A design pass writes its screenshots to `specs/NNN-slug/.design/` and links them from `design.md` by a relative
path (`![](.design/mobile-ist.png)`). The Design tab renders that link unchanged. Under the page's
`<base href="/">` the browser resolves it to `/.design/mobile-ist.png` on the server root, which answers 404, so
every screenshot shows as a broken image. The one route that serves a spec's files,
`…/evidence/file?path=`, would refuse the path too: by ISC-83.1 it serves `artifacts/` and `.evidence/` only.

**Reproduction.** Register a repository whose spec has a design pass. Open `/w/<workspace>/s/<id>/design`. Every
`### Ist` figure is a broken image, and the network panel shows `GET /.design/<viewport>-ist.png 404`.

## Out of Scope

- **Other relative images and other docs tabs.** Only `.design/`, only the Design tab (goal lock).
- **The design pass's HTML prototype** (`.design/prototype/index.html`) behind its link. Serving HTML with its own
  assets is a wider surface than this bug.
- **Any write.** The route stays read-only, as every read route is (`tests/readonly.test.ts`).

## Goal

In the Design tab, every image design.md links under the spec's own `.design/` folder loads through the app's
evidence file route, and the route still serves nothing outside `artifacts/`, `.evidence/` and `.design/` of that
spec.

## Claims

- [ ] ISC-112: The Design tab loads every image design.md links by a relative path under the spec's own `.design/` folder from the app's evidence file route, instead of requesting `/.design/…` from the server root under the page's `<base href="/">`.
- [ ] ISC-113: Anti: the evidence file route serves nothing outside `artifacts/`, `.evidence/` and `.design/` of the spec's own folder — `plan.md`, a traversal, double encoding, an absolute path, a symlink out of `.design/` and another spec's `.design/` file stay refused as ISC-83 refuses them. (after: ISC-112)

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|---|---|---|---|---|---|---|
| ISC-112 | e2e | open the Design tab of a fixture spec whose design.md links `.design/mobile-ist.png`; read each figure image and its request | every image has a natural width above 0 and was requested through `/evidence/file?path=.design/…`; no request to `/.design/` | `bun run e2e -- docs -g "design image"` | derived: principal report 2026-10-01 | high |
| ISC-113 | bun-test | request `plan.md`, `../spec.md`, double-encoded and absolute paths, a symlink out of `.design/` and another spec's `.design/` file; then a `.design/` png of the spec itself | 403 or 404 for every refused one, nothing served; 200 `image/png` for the spec's own | `bun test tests/evidence.test.ts -t traversal` | derived: local-only | high |

## Decisions

- **2026-10-01 — the narrow shape (goal lock).** Only `.design/`, only the Design tab, through the existing evidence
  file route widened by that one folder. Where it lands in code is the builder's call: the renderer in
  `core/src/markdown.ts` rewrites the src in document mode, and `resolveEvidencePath` in `core/src/evidence.ts`
  admits `.design/`.

## Verification
