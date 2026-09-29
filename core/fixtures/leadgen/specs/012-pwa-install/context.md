---
spec: 012-pwa-install
created: 2026-09-24T16:40:00Z
updated: 2026-09-24T17:40:00Z
rounds: 3
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 012 — Installable as a PWA

## Goal — confirmed 2026-09-24T16:40:00Z

The app can be installed on a desktop, a tablet or a phone and opens in its own window with the
lead-ring icon and the app's own colours; a service worker keeps the app shell available without a
network, a toast offers to reload when a deploy has landed, and data still comes from the API only.

Principal's words, verbatim: "App als echte PWA ready machen, so dass der User sie auf dem Desktop
oder Tablet/Mobile  installieren kann. mit logo, farben, etc. "

## Round 1 — before the spec, 2026-09-24

### Q1 · Which sentence is the goal? (the goal lock)

- Offered: installable with the brand, the app shell offline (recommended) | installable only, no service worker | installable plus the shortlist readable offline
- Chosen: installable with the brand, the app shell offline
- Landed in: `## Goal`, ISC-327, ISC-328, ISC-329, ISC-330

### Q2 · What happens when the service worker finds a new version after a deploy?

- Offered: a toast with a reload action (recommended) | silently on the next start | reload at once
- Chosen: a toast with a reload action
- Landed in: ISC-331

### Q3 · How does the user get to the installation?

- Offered: an "install" entry in the app's settings popover (recommended) | the browser's own UI only
- Chosen: the browser's own UI only. No in-app install prompt, no iOS instructions; `## Out of Scope` says so.
- Landed in: `## Out of Scope`

Read from the repo, not asked:

- There is no manifest and no service worker today. `index.html` links `favicon.ico` and a 256px `apple-touch-icon`, both rendered from `brand/mark.svg` by `frontend/tools/build-favicon.sh` on a round plate in the dark theme's surface (spec 003, ISC-239).
- The dark theme is the default; its surface and primary are the plate and ring colours the favicon script already names. The manifest colours follow from that.
- `@angular/build` 22 lists `@angular/service-worker` as an optional peer; nothing else is needed for `ngsw`.
- The frontend is served by `frontend/nginx.conf` inside the compose stack (`try_files … /index.html`, `/api/` proxied). No cache headers are set today.
- The feedback system of spec 002 (`core/toast/`) raises one toast per answer event; the update toast joins it.
- Under `security.auth: oidc` the browser signs in with Authorization Code and PKCE before the first route renders and returns to `window.location.origin + '/'` (F28, ISC-184).

Default taken without a question: `theme-color` follows the active app theme rather than the
operating system, because the app's default is dark whatever the OS says (spec 003).

## Round 2 — before the plan, 2026-09-24

### Q1 · How is the service worker built? (the approach lock)

- Offered: `ngsw` with the departure from FE-PWA-01 recorded (recommended) | a hand-written `sw.js` stamped at postbuild, as FE-PWA-01/02 ask | manifest and icons first, the worker in a second round
- Chosen: `ngsw`, departure recorded
- Landed in: `plan.md` § Approach, § Stack Decisions (FE-PWA-01, FE-PWA-02, FE-PWA-04); spec § Decisions

Read from the repo, not asked:

- The chart for the deployed instance lives in a separate devops repository and carries its own `templates/web/configmap-nginx.yaml`, which replaces the image's `default.conf` wholesale. The first fog line resolves: ISC-332's headers are set twice, the second time by the operator. Landed in: spec § Decisions, `plan.md` § Affected Files.
- The house standards' PWA section (`FRONTEND.md` § PWA and offline) asks for a hand-written worker; that is what made the approach question worth asking.
- `frontend/CLAUDE.md` stands 627 characters under its budget, so the trap line is one line.

## Still open

- fog: whether an installed window on iOS keeps the sign-in redirect in scope or hands it to the browser. Resolves on the device in ISC-334.

## Round 3 — during build, 2026-09-24

- Operator, verbatim: "ImplementSpec and open report". Agent-tool path, one worktree per claim, builders on the top rung, Max as reader. The report was opened in a cmux split at the operator's request.
- Round 1 dispatched ISC-327 alone (T1 and T2 in one worker, same claim). Max: pass, with one finding worth carrying: the image's nginx has no `webmanifest` mime type, so T12's conditional is a certainty.
- Round 2 runs ISC-328, ISC-333 and ISC-329 in parallel although their tasks carry no `[P]`: the marker was derived when the claims were still blocked, and the three touch disjoint files. The one shared file, `index.html`, goes to the ISC-333 worker alone, which also repoints the touch icon, so T3 does not edit it.
- Workers start on HEAD, which lacks the uncommitted round-1 patch; each applies it and stages it before building, so its own diff holds only its work.
- The master's declared progress counted thirteen tombstones as claims (321/346); it is 321/333, the count `SpecStatus.ts` makes.
- Rounds 2 and 3: every claim but ISC-334 closed. Max failed ISC-328 once (the maskable mark's outer dot sat outside the safe zone; fixed to 11/16 and measured by the spec) and raised concerns on ISC-329 (the package download is a navigation under `/api/` and fell to ngsw's index fallback; `!/api/**` added). T13, the operator's chart mirror, was done by the DA on the operator's instruction "mach weiter bis alle claims zu sind": edited, rendered with `helm template`, `nginx -t` green; not committed, not deployed.

### Q · ISC-330 closes on the operator's word
- Offered: close on the Interceptor offline evidence (recommended) | test it installed first
- Chosen, verbatim: "Ja, schließen". Landed in: spec § Verification, master § Verification.

### Q · ISC-334, the sign-in inside the installed window
- First answer "Ich habe es schon getestet", asked again because nothing was deployed yet; then: "Noch nicht, nach Deploy".
- Operator, verbatim, same turn: "OICD kann aber direkt jetzt umgesetzt werden. die neue version kann ich gleich deployen". No code change: the redirect returns to `/`, inside the manifest scope. ISC-334 closes on the operator's report after the deploy.
