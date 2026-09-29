---
spec: 012-pwa-install
plan: plan.md
updated: 2026-09-24
---

# Tasks 012 — Installable as a PWA

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from
`spec.md`. This file defines nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column;
the constitution has no `## Lanes` block, so the defaults apply (`web` for `frontend/`, `test` for end-to-end
probes, `operator` for the principal's own steps). No claim crosses two worker lanes, so there is no `[seam]`;
the toast's new `action` field is a same-lane contract and T9 lands it before T10 and T11 build on it.

## Tasks

- [x] T1 · ISC-327 · [P] · web — the two surface hex twins as constants, and the manifest: name, short name, `start_url`, `scope`, `display`, colours from the dark surface, the icon list · `frontend/src/app/core/theme/theme.model.ts`, `frontend/public/manifest.webmanifest`
- [x] T2 · ISC-327 · web — `<link rel="manifest">` and a static `theme-color` meta in the head; the manifest spec for fields, colours and the link (after: T1) · `frontend/src/index.html`, `frontend/src/app/core/pwa/manifest.spec.ts`
- [x] T3 · ISC-328 · web — the script renders 192 and 512 on the round plate, 512 maskable on a rounded square at 80 %, 180 square opaque touch icon; run it twice, commit the PNGs (after: T1) · `frontend/tools/build-favicon.sh`, `frontend/public/icon-*.png`, `frontend/public/apple-touch-icon.png`
- [x] T4 · ISC-328 · web — the manifest spec reads every named icon's PNG header and size (after: T2, T3) · `frontend/src/app/core/pwa/manifest.spec.ts`
- [x] T5 · ISC-333 · web — the theme store's effect writes `meta[name=theme-color]` from the resolved theme's surface; spec switches dark → light (after: T1) · `frontend/src/app/core/theme/theme.store.ts`, `frontend/src/app/core/theme/theme.store.spec.ts`
- [x] T6 · ISC-333 · web — the inline theme script writes the same meta before first paint, in step with the store's default; repoint the touch icon to the 180 file, since this task owns `index.html` this round (after: T2) · `frontend/src/index.html`
- [x] T7 · ISC-329 · web — `bun add @angular/service-worker@~22.1.0`; `ngsw-config.json` with the `app` prefetch group and lazy `i18n` and `help` groups, no data group; `serviceWorker` on the production configuration (after: T1) · `frontend/package.json`, `frontend/bun.lock`, `frontend/ngsw-config.json`, `frontend/angular.json`
- [x] T8 · ISC-329 · web — `provideServiceWorker` with `enabled: !isDevMode()` and `registerWhenStable:30000`; the config spec over groups, patterns and the `enabled` clause (after: T7) · `frontend/src/app/app.config.ts`, `frontend/src/app/core/pwa/ngsw-config.spec.ts`
- [x] T9 · ISC-331 · web — the toast gains an optional `action` (catalog key plus event); a toast with an action is exempt from the lifetime timer (after: T8) · `frontend/src/app/core/toast/toast.model.ts`, `frontend/src/app/core/toast/toast.store.ts`, `frontend/src/app/core/toast/toast.store.spec.ts`
- [x] T10 · ISC-331 · web — the stack renders the action as a button that dispatches its event (after: T9) · `frontend/src/app/layout/toast-stack/*`
- [x] T11 · ISC-331 · web — the update store: `versionReady` once per hash from `SwUpdate.versionUpdates`, `activate` then reload, hourly `checkForUpdate` while visible; the toast raised from it; both catalog keys (after: T9) · `frontend/src/app/core/pwa/update.events.ts`, `frontend/src/app/core/pwa/update.store.ts`, `frontend/src/app/core/pwa/update.store.spec.ts`, `frontend/src/app/core/toast/toast.events.ts`, `frontend/public/i18n/en.json`, `frontend/public/i18n/de.json`
- [x] T12 · ISC-332 · web — `no-cache` on `/index.html`, `/ngsw.json`, `/manifest.webmanifest`; `immutable` on hashed `.js` and `.css`; the `webmanifest` mime type if missing; curl against the compose web port (after: T7) · `frontend/nginx.conf`
- [x] T13 · ISC-332 · operator — the same header blocks in the chart's web ConfigMap, in the rollout that ships the image; curl against the deployed host (after: T12) · `~/Development/codeministry/devops/projects/office/leadgen/templates/web/configmap-nginx.yaml`
- [x] T14 · ISC-335 · web — the anti search over the worker config, the manifest and the icons' names (after: T3, T8) · (probe only)
- [x] T15 · ISC-330 · test — build the compose stack, install in desktop Chrome, go offline, reopen the window; one screen's error state captured (after: T8, T12) · (probe only, Interceptor)
- [ ] T16 · ISC-334 · operator — install under `security.auth: oidc` on desktop Chrome and one phone; sign out, reopen, sign in; on the phone also judge the maskable icon's crop (after: T13, T15) · (probe only, a device)
- [x] T17 · ISC-336 · web — the record: a section in the design-system decision, the changelog line, the README paragraph, one trap line in the frontend notes; the stale icon lines in the root `CLAUDE.md` inventory and the `index.html` head comment (after: T11) · `docs/decisions/frontend-design-system.md`, `CHANGELOG.md`, `README.md`, `frontend/CLAUDE.md`, `CLAUDE.md`, `frontend/src/index.html`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1, T2 | ISC-327 | a spec parses the manifest and reads the manifest link and `theme-color` in `index.html` |
| T3, T4 | ISC-328 | run `build-favicon.sh` twice; a spec reads each named icon and its PNG header |
| T7, T8 | ISC-329 | a spec over `ngsw-config.json` and the worker provider |
| T15 | ISC-330 | build, serve the compose stack, install, go offline, reopen the installed window |
| T9, T10, T11 | ISC-331 | a faked `versionUpdates` stream with `VERSION_READY`; activate; dismiss on a second run |
| T12, T13 | ISC-332 | `rg` over `nginx.conf`; `curl -sI` for `/`, `/ngsw.json`, `/manifest.webmanifest` and one hashed bundle |
| T5, T6 | ISC-333 | render with `lg-dark`, switch to light, read the meta; `rg` over `index.html` |
| T16 | ISC-334 | install under `oidc` on desktop Chrome and one phone OS; sign out and reopen |
| T14 | ISC-335 | `rg` for `/api` in the worker config; `rg -i` for configured values over manifest and config |
| T17 | ISC-336 | `WorkingNotesStaySmallTest`; `rg` over the decision record, changelog and README |
