---
spec: 022-chat-turn-status-and-bulk-delete
created: 2026-09-27T21:48:13Z
updated: 2026-09-27T23:33:05Z
rounds: 3
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context 022 — Chat turn status, bulk delete, and the cited row in view

## Goal — confirmed 2026-09-27T21:48:13Z

Hovering or focusing the ring beside an answer plays its turn and opens a popover with that turn's
state, the reason when it ended incomplete, its steps, duration and model, the same live and after a
reload; the empty chat's ring does the same with the chat's own status (model, today's calls against
the ceiling, the tool-round bound); the conversation list deletes the selected or all shown
conversations with one confirmation and one request; and an offer opened from a chat citation has its
marked shortlist row scrolled into the list pane.

Principal's words, verbatim: "ich chat sollte der kreis auch einen hover haben, mit animation und popover mit kurzer info zum status - auch bei unvollständigen. ich will in der chatliste auch mehrere oder alle chats auf einmal löschen. und bei auswahl eines objekt im chat, sollte das außerhalb auch fokusiert und ggfs. markiert werden. bsp. ich klick im chat auf ein offer, danach geht in der short list das offer detail auf. aber es sollte auch in der liste in den fokus gescrollt werden und gehovert bzw. markiert sein"

## Round 0 — shaping the idea, 2026-09-27

- Shapes offered: all three in one spec (recommended) | frontend only, the glyph popover and the row
  scroll, bulk delete as its own spec later | a wider history manager (select, select all, delete
  older than N days) with the popover and scroll as small additions
- Chosen: all three in one spec

### Q1 · Should the popover name an incomplete turn's reason after a reload too?

- Offered: store the reason, an expand-only `V36` adds `chat_turn.end_reason` (recommended) | live only, no migration
- Chosen: store the reason
- Landed in: ISC-473, ISC-474

### Q2 · What does "select all" delete while a search is active?

- Offered: only the shown hits, the client sends explicit ids (recommended) | really everything, an id-less server path
- Chosen: only the shown hits
- Landed in: ISC-477, ISC-478

## Round 1 — before the spec, 2026-09-27T21:48:13Z

### Q1 · Which sentence is the goal? (the goal lock)

- Offered: all three as shaped (recommended) | without the stored reason | all three plus the empty chat's plate ring with a chat status popover
- Chosen: all three plus the plate ring
- Landed in: `## Goal`, ISC-476; the fog line about the plate resolved with it

No further gap the repo could not close: the turn states and error reasons (`ChatTurnState`,
`ChatErrorReason`), the stored columns of `chat_turn` (`model`, `created_at`, `finished_at`, no
reason), the single delete's stop-before-delete, the capability view (`present` only) and the
budget's read (`ChatBudget.used()`), and the shortlist's pane-only scroll (`landCard`) were read
from the code.

## Still open

- none

## Round 2 — before the plan, 2026-09-27T22:17:46Z

### Q1 · How do we build it? (the approach lock)

- Offered: three vertical slices, each end-to-end and shippable alone — row scroll, status popovers, bulk delete — side by side, catalogs serialised (recommended) | layer by layer, backend then frontend | UI first against stubs, backend after
- Chosen: three vertical slices
- Landed in: plan.md § Approach, § Affected Files and Modules

No further question: the endpoints' paths, the reason's write points (`Turn.end` and the two
cut-off updates) and the popover's positioning helper (`shared/popover/anchor-for.ts`) were read
from the code.

## Round 3 — during build, 2026-09-27T23:33:05Z

- Solo run: the parent builds the tasks itself in the main tree, serially, no dispatch and no worktrees; the lock protocol does not apply to a solo run.
- second look: off (default)

### Q1 · When should the cited row scroll into view, given that the shortlist is one column beside the docked chat below about 2300px?

- From: T1 (ISC-479), lane `web`
- Offered: as soon as the list is on screen beside the detail — at once on a wide screen, else when the chat closes (recommended) | only while it is on screen at the click | fold the chat's rail on a citation click instead (a new claim)
- Chosen: as soon as the list is on screen
- Landed in: ISC-479's Test Strategy row (refined master-first), master and spec `## Decisions` 2026-09-28

## Code review — deferred findings (2026-09-28)

Three `/spec-code-review 022` rounds over `cbe9b5e^..` and the working tree. Round 1 (10) and round 2 (6)
were fixed in full; of round 3 the operator took 1, 2, 4, 5, 6 and 8 and deferred these four, verbatim
from the review, to be carried into the master's `## Remaining Work` when the spec completes:

- The status popover is placed once beside its ring and never clamped to the viewport or moved while
  open: on a 375px phone it can run past the right edge, and a scrolled thread strands it.
- `keyedId` holds one value, so an auto-repeated arrow key can land a card twice (key path and
  citation path together).
- The start sweep and the turn deadline both store `end_reason = MODEL`, so a restart or a timeout
  reads "The model stopped before it finished".
- A duration just under a minute reads "60.0 s": the unit is chosen before rounding.
