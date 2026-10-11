---
spec: 007-stale-alert-line-breaks
created: 2026-10-11T08:00:00Z
updated: 2026-10-11T08:40:39Z
rounds: 3
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 007 — Line breaks in the stale-agent alert

## Goal — confirmed 2026-10-11

The stale-agent alert breaks like ordinary text in every language: no line starts with closing punctuation or ends
with opening punctuation, and an empty claims list still gives a complete sentence.

The principal chose this reading in German; the choice lives in the untracked master, as for specs 002 and 004.

## Round 1 — before the spec, 2026-10-11

The input is the note on spec 002's code-reviewed mark (2026-10-10), eight minor points left open at its close.
Three are behaviour and form this bug: inline-block id runs add a break chance before an id, so a translation with
an opening quote or bracket before a placeholder can end a line with it (point 1); `glue` moves every `\p{P}` onto
the id, opening brackets and quotes included (point 2); an empty claims list renders a dangling " on : " (point 4).
The other five change no behaviour (points 5 to 8: shared stub constants, one chip-centre helper, one target token,
one line height) or only probe coverage (point 3: the rail guards run under no claim's probe); they are a separate
refactor, not this bug. The reproduction is code-level and needs no question.

### Q0 · The goal lock: which shape?
- Offered: the alert breaks like ordinary text in every language, empty claims list included (recommended) | only
  the empty claims list | the alert and every rail row text in every language
- Chosen: the alert breaks like ordinary text in every language, empty claims list included
- Landed in: ISC-115, ISC-115.1, ISC-115.2, `## Out of Scope`

## Still open

None.

## Round 2 — during build, 2026-10-11

### Q1 · ISC-115 and ISC-115.1: rule by punctuation class or by token?
- From: ISC-115, ISC-115.1, before any code; the minted class rule mis-sorts the German closing quote “ (`\p{Pi}`) and the apostrophe ’ (`\p{Pf}`)
- Offered: the whitespace-delimited token is the run (recommended) | the class rule refined for quote marks and the apostrophe | keep as minted, the German quote as fog
- Chosen: the whitespace-delimited token is the run
- Landed in: ISC-115, ISC-115.1 (refined, master first), `## Decisions`; the reviewed mark is stale on purpose

Round 3 (2026-10-11): second look off (default); run by the parent, serial (bug). The three unit tests ran red first on behaviour (an inert `head` field added before the rule), then the token rule replaced `glue` and an empty claims list got `board.agent.staleAlertNoClaims` (both later revised at code review, below); ISC-115, ISC-115.1 and ISC-115.2 closed on their probes, web lane 517 pass, board e2e 50 pass, board visual unchanged in both themes.

Code review (2026-10-11): the token rule now ends tokens only at breakable white space (a no-break space joins) and lets ids that share a token share one run; ISC-115.2 was dropped because core builds every live agent from a lock, so the claims list is never empty (its key, branch and test removed); ISC-115.1 carries the `Anti:` prefix; the spec text holds English examples only; `AlertPart` became a union of text and run.

Code review round 2 (2026-10-11): `BREAKABLE` holds the UAX #14 break spaces (no-break spaces excluded) and the test reads it; alerts are keyed by source and session, since core groups agents by both; `touching marks` also checks the text parts; the run's non-id text renders through `ng-container`, since a bare interpolation on its own line picked up a space inside the run (the board 1440 visual caught it); a duplicate-key test drives a list update and was red on the session-only key (NG0955); accepted: languages written without spaces (the app ships en and de) and the emergency break inside an id when its run is wider than the alert.

Code review round 3 (2026-10-11): one `agentKey` helper in `live-frame.ts` keys the agents of This frame and Needs you by source and session (each list's test was red on the session-only key, NG0955); the twin agent uses a real lock source; `BREAKABLE` adds the mandatory breaks (U+000B, U+0085, U+2028, U+2029); console spies are restored in `finally`. Accepted: e2e selectors by session only (no fixture holds one session in two sources) and `alertParts` re-run per frame.
