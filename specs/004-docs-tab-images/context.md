---
spec: 004-docs-tab-images
created: 2026-10-01T06:35:00Z
updated: 2026-10-01T06:40:00Z
rounds: 1
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 004 — Design-pass screenshots in the Design tab

## Goal — confirmed 2026-10-01T06:35:00Z

In the Design tab, every image design.md links under the spec's own `.design/` folder loads through the app's
evidence file route, and the route still serves nothing outside `artifacts/`, `.evidence/` and `.design/` of that
spec.

The principal's own words are German and live only in the untracked master, as for spec 002.

## Round 1 — before the spec, 2026-10-01T06:35:00Z

The reproduction came with the report and was confirmed in the running app: on a registered repository's spec
with a design pass, the Design tab rendered `<img src=".design/mobile-ist.png">`, the page's `<base href="/">`
resolved it to `/.design/mobile-ist.png`, and the server answered 404. The evidence file route refuses the path as
well, because it serves only `artifacts/` and `.evidence/`. No gap question was left.

### Q0 · The goal lock: which shape?
- Offered: every relative image inside the spec folder, in every docs tab (recommended) | only `.design/`, only the
  Design tab | the first plus the design pass's HTML prototype behind its link
- Chosen: only `.design/`, only the Design tab
- Landed in: ISC-112, ISC-113, `## Out of Scope`

## Still open

None.
