---
spec: 022-chat-turn-status-and-bulk-delete
plan: plan.md
updated: 2026-09-28
---

# Tasks 022 — Chat turn status, bulk delete, and the cited row in view

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from
`spec.md`. This file defines nothing, it decomposes.

## Legend

`[P]` = parallelizable. `(after: T…)` = must run after that task. `· <lane>` = derived from the path column;
the constitution has no `## Lanes` block, so the defaults apply (`web` for `frontend/`, `server` for `backend/`,
and the records under `docs/` ride with `web` as specs 012 and 021 did). `[seam]` = the contract between two lanes;
the three seams land the shapes `plan.md` § Interfaces already fixes. The two i18n catalogs are edited by T12 and
then T28, never at once (plan § Risks). A task that adds an input owns the template binding that feeds it, in the
same path column (spec 018's lesson).

## Tasks

### A · the cited row in view

- [x] T1 · ISC-479 · [P] · web — a selection that arrives from outside the list (a URL, not a key press) lands its card in the pane through the existing `landCard`, only while the pane scrolls, without moving focus; a card not rendered in the loaded page is left alone · `frontend/src/app/features/shortlist/shortlist-page.ts`
- [x] T2 · ISC-479 · web — red then green: at 1440 with the chat docked, a citation to an offer whose row sits below the pane's fold, then one outside the loaded page; pane and row rects, the document's scrollTop, the detail open (after: T1) · `frontend/src/app/features/shortlist/shortlist.browser.spec.ts`

### B · the status popovers

- [x] T3 · ISC-473 · [seam] · server — `TurnView` gains `endReason` (`ChatErrorReason`, nullable) and `finishedAt` (`Instant`, nullable), the shape `plan.md` § Interfaces fixes · `backend/src/main/java/de/codeministry/leadgen/chat/TurnView.java`
- [x] T4 · ISC-473 · [P] · web — the client `TurnView` gains `endReason` and `finishedAt` to match (after: T3) · `frontend/src/app/core/model/chat.ts`
- [x] T5 · ISC-473 · [P] · server — `V36`: a nullable `end_reason` with a check on `MODEL`, `BUDGET`, `ROUNDS`; written whole once and never edited after (after: T3) · `backend/src/main/resources/db/migration/V36__chat_turn_end_reason.sql`
- [x] T6 · ISC-473 · server — `finish(…, reason)` writes the reason with `INCOMPLETE` and null otherwise; the stale-turn sweep and the cancelled-stream update write `MODEL`; the turn read maps `end_reason` and `finished_at` into `TurnView` (after: T5) · `backend/src/main/java/de/codeministry/leadgen/chat/ConversationRepository.java`
- [x] T7 · ISC-473 · server — `Turn.end(reason, …)` and the two cut-off paths hand their reason to `finish`; DONE and STOPPED pass null (after: T6) · `backend/src/main/java/de/codeministry/leadgen/chat/ChatTurnService.java`
- [x] T8 · ISC-473 · server — red then green: each of MODEL, BUDGET, ROUNDS stored and returned, null for DONE and STOPPED, a pre-`V36` turn reading null (after: T7) · `backend/src/test/java/de/codeministry/leadgen/chat/ChatConversationTest.java`
- [x] T9 · ISC-474 · web — the store keeps a live turn's end reason from its `error` event and its start and finish times, and a reloaded turn's `endReason` and `finishedAt`, so both read the same (after: T4) · `frontend/src/app/core/store/chat.store.ts`
- [x] T10 · ISC-474 · web — `chat-status-popover` in turn mode: the state line (done, working, writing, incomplete with its reason or none, stopped), the steps count, the duration where start and finish are known, the model where known; placed with `shared/popover/anchor-for.ts`, no focusable element inside (after: T9) · `frontend/src/app/features/chat/chat-status-popover/chat-status-popover.ts`, `frontend/src/app/features/chat/chat-status-popover/chat-status-popover.html`, `frontend/src/app/features/chat/chat-status-popover/chat-status-popover.css`
- [x] T11 · ISC-474 · web — the glyph becomes a focusable host: opens the popover on hover intent and on focus, closes on leaving glyph and popover and on Escape, sets `--lg-living-mark-turn` while open (after: T10) · `frontend/src/app/features/chat/chat-panel/chat-panel.ts`, `frontend/src/app/features/chat/chat-panel/chat-panel.html`, `frontend/src/app/features/chat/chat-panel/chat-panel.css`
- [x] T12 · ISC-475 · web — `chat.status.*` in both catalogs: the five state words, the three reasons and "no reason stored", steps, duration, model, the glyph's accessible name per state (after: T10) · `frontend/public/i18n/en.json`, `frontend/public/i18n/de.json`
- [x] T13 · ISC-474 · web — red then green: hover then focus on a DONE, a working, a writing, an INCOMPLETE per reason and without one, and a STOPPED glyph; the popover's words, steps, duration, model; the turn animation running while open; closed after Escape and after leaving (after: T11, T12) · `frontend/src/app/features/chat/chat-panel/chat-panel.browser.spec.ts`
- [x] T14 · ISC-475 · web — red then green: the glyph's accessible name by state through tab order, and under emulated reduced motion the popover opening with no animation on the mark (after: T13) · `frontend/src/app/features/chat/chat-panel/chat-panel.browser.spec.ts`
- [x] T15 · ISC-476 · [seam] · server — `ChatStatusView` (model, callsUsed, callsLimit, toolRounds) and the `GET /api/v1/chat/status` signature, the shape `plan.md` § Interfaces fixes · `backend/src/main/java/de/codeministry/leadgen/chat/ChatStatusView.java`
- [x] T16 · ISC-476 · [P] · server — `ChatBudget` hands out the resolved daily limit and round bound; the controller answers `GET /status` from it and the configured chat model, 404 where the capability is absent (after: T15) · `backend/src/main/java/de/codeministry/leadgen/chat/ChatBudget.java`, `backend/src/main/java/de/codeministry/leadgen/web/ChatController.java`
- [x] T17 · ISC-476 · server — red then green: 200 with the three values and the model, 404 without a chat model (after: T16) · `backend/src/test/java/de/codeministry/leadgen/web/ChatControllerTest.java`
- [x] T18 · ISC-476 · web — the client `ChatStatus` type, `ChatApi.status()` and its stub (after: T15) · `frontend/src/app/core/model/chat.ts`, `frontend/src/app/core/api/chat.api.ts`, `frontend/src/app/core/api/chat-stub.ts`
- [x] T19 · ISC-476 · web — the popover's chat mode, asked on open; the plate mark becomes a focusable host like the glyph (after: T18, T11) · `frontend/src/app/features/chat/chat-status-popover/chat-status-popover.ts`, `frontend/src/app/features/chat/chat-panel/chat-panel.html`
- [x] T20 · ISC-476 · web — red then green: the empty chat's plate on hover names model, calls used of the ceiling and the round bound from a stubbed status (after: T19, T14) · `frontend/src/app/features/chat/chat-panel/chat-panel.browser.spec.ts`

### C · bulk delete

- [x] T21 · ISC-477 · [seam] · server — `BulkDelete` (`ids`, 1..500) and `BulkDeleted` (`deleted`) records and the `POST /api/v1/chat/conversations/bulk-delete` signature, the shape `plan.md` § Interfaces fixes · `backend/src/main/java/de/codeministry/leadgen/chat/BulkDelete.java`, `backend/src/main/java/de/codeministry/leadgen/chat/BulkDeleted.java`
- [x] T22 · ISC-477 · server — the endpoint: stop every streaming turn in the named conversations as the single delete does, delete the known ones in one transaction, skip unknown ids, 400 on an empty or missing list (after: T21, T16) · `backend/src/main/java/de/codeministry/leadgen/web/ChatController.java`, `backend/src/main/java/de/codeministry/leadgen/chat/ConversationRepository.java`
- [x] T23 · ISC-477 · server — red then green: three of five with one streaming, an unknown id among known ones, the two 400 cases (after: T22, T17) · `backend/src/test/java/de/codeministry/leadgen/web/ChatControllerTest.java`
- [x] T24 · ISC-478 · web — the client bulk types, `ChatApi.deleteMany(ids)` and its stub (after: T21, T18) · `frontend/src/app/core/model/chat.ts`, `frontend/src/app/core/api/chat.api.ts`, `frontend/src/app/core/api/chat-stub.ts`
- [x] T25 · ISC-478 · web — `bulkDeleteRequested` / `bulkDeleted` / `bulkDeleteFailed`: the rows leave the list, an open conversation among them leaves the thread for a new one (after: T24, T9) · `frontend/src/app/core/store/chat.events.ts`, `frontend/src/app/core/store/chat.store.ts`
- [x] T26 · ISC-478 · web — select mode in the list: the head control, a checkbox per row, `Select all` over the rows shown (the hits while a search is active), the count, `Delete N`, Done and Escape end the mode (after: T25) · `frontend/src/app/features/chat/chat-history/chat-history.ts`, `frontend/src/app/features/chat/chat-history/chat-history.html`, `frontend/src/app/features/chat/chat-history/chat-history.css`
- [x] T27 · ISC-478 · web — the one dialog asks for N as well as for one, Cancel still focused first, confirming dispatches one bulk request (after: T26) · `frontend/src/app/features/chat/chat-history/chat-delete-dialog.ts`, `frontend/src/app/features/chat/chat-history/chat-delete-dialog.html`
- [x] T28 · ISC-478 · web — `chat.select.*` and `chat.delete.many*` in both catalogs (after: T12, T26) · `frontend/public/i18n/en.json`, `frontend/public/i18n/de.json`
- [x] T29 · ISC-478 · web — red then green: three picked and confirmed is one request and three rows gone with the mode off; select all under a search takes only the hits and the dialog names their count with Cancel focused; the open conversation among them leaves for a new one (after: T27, T28) · `frontend/src/app/features/chat/chat-history/chat-history.browser.spec.ts`

### D · the records

- [x] T30 · ISC-480 · server — hints for `BulkDelete`, `BulkDeleted` and `ChatStatusView` where binding reaches them by reflection, and `LeadGenRuntimeHintsTest` green (after: T22, T16) · `backend/src/main/java/de/codeministry/leadgen/LeadGenRuntimeHints.java`
- [x] T31 · ISC-480 · web — `docs/DATA-MODEL.md` names `end_reason`; `docs/decisions/chat.md` records the status popovers, the status endpoint and bulk delete; `CHANGELOG.md` § Unreleased names all three and the row scroll (after: T2, T8, T14, T20, T29) · `docs/DATA-MODEL.md`, `docs/decisions/chat.md`, `CHANGELOG.md`
- [x] T32 · ISC-480 · web — the regression run: the existing delete, rename and search rows of the chat-history, chat-panel and controller specs unchanged and green, `i18n-parity.spec.ts`, `WorkingNotesStaySmallTest` (after: T30, T31) · `frontend/src/app/features/chat/chat-history/chat-history.spec.ts`

## Probe Mapping

| Task | Claim | Probe (from `spec.md` § Test Strategy) |
|------|-------|----------------------------------------|
| T1, T2 | ISC-479 | at 1440 with the chat docked, cite an offer whose row sits below the pane's fold and click the citation; then one not in the loaded page — `shortlist.browser.spec.ts` |
| T3–T8 | ISC-473 | end a stubbed turn with each of MODEL, BUDGET and ROUNDS, one DONE, one STOPPED; read `end_reason` and `GET /conversations/{id}`; Flyway over pre-`V36` turns — `ChatConversationTest`, `V36` |
| T9–T11, T13 | ISC-474 | hover then focus each turn kind's glyph; read the popover; Escape — `chat-panel.browser.spec.ts` |
| T12, T14 | ISC-475 | tab to a glyph for its name; `i18n-parity.spec.ts`; reduced motion — `chat-panel.browser.spec.ts`, `i18n-parity.spec.ts` |
| T15–T20 | ISC-476 | hover the plate; `GET /api/v1/chat/status` with and without a model — `chat-panel.browser.spec.ts`, `ChatControllerTest` |
| T21–T23 | ISC-477 | bulk-delete three of five with one streaming; an unknown id; empty list and no body — `ChatControllerTest` |
| T24–T29 | ISC-478 | select mode, pick three, confirm; search and select all; the open conversation among them — `chat-history.browser.spec.ts` |
| T30–T32 | ISC-480 | the existing chat specs, `i18n-parity.spec.ts`, `LeadGenRuntimeHintsTest`, the `rg` over the docs, `WorkingNotesStaySmallTest` — `chat-history.spec.ts`, `docs/decisions/chat.md`, `CHANGELOG.md` |
