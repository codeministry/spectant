/spec

## Type
feature

## Repo
spectant (this repository)
Slug: answer-in-app

## Goal (one sentence)
An open question an agent stopped on can be answered in the app, and the next implement round picks the answer up.
<!-- The principal's own goal sentence is asked at CreateSpec and lands in the untracked master only. -->

## Problem
When an implement round stops on an open question, the answer can only travel back through the chat; the app shows
the question but cannot take the answer.

## Vision
The "waiting on you" entry carries an answer field. The answer is appended to `specs/NNN/answers.md`, and the next
`/spec implement` reads unconsumed answers before it dispatches and carries on.

## In
- Answer field on every open question the app shows (rail, spec page)
- Append to `specs/NNN/answers.md` with compare-and-swap on sha256, plus exactly one `answered` event
- The skill reads unconsumed answers before dispatch and marks them consumed

## Out
- No model, no rewording of the answer
- No answer while an agent holds an open claim on that spec

## Done means (observable)
- Answering in a fixture repository appends exactly one entry and one `answered` event → e2e + bun-test
- A stale sha256 returns 409 and leaves `answers.md` byte-identical → bun-test
- An open claim on the spec refuses the answer → bun-test
- `/spec implement` with an unconsumed answer passes it into the round and marks it consumed → plugin test

## Guard rails
- Deliberate departure from `ISA.md` § Constraints: the app's writes grow from two (review mark, task checkboxes) to
  three
- The `answers.md` format lives in `FORMAT.md`; builds on F2's write path and F3's events

## What the repository does not know
The principal wants the rail to be the place where questions get answered, not the chat.

## Open / unsure
Which question sources count: tasks waiting on the principal, `⟨?: …⟩` marks, fog lines, or all three.

## Mode
Draft first, mark assumptions as `⟨?: …⟩`, ask only structural questions.

## Shaping record (round 0, 2026-09-29)
- Shapes offered: answer file (recommended) | a round in `context.md` | no write, hand the answer to the chat;
  chosen: answer file
- No shaping questions; the shape and the repository answered the rest
