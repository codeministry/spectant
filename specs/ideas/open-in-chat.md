/spec

## Type
feature

## Repo
spectant (this repository)
Slug: open-in-chat

## Goal (one sentence)
From any next step, warning or open question in the app, one click puts a ready prompt for the chat on the clipboard.
<!-- The principal's own goal sentence is asked at CreateSpec and lands in the untracked master only. -->

## Problem
Going from the dashboard to the chat means copying a bare command and retyping the context by hand.

## Vision
Every next step, warning and open question has a copy action that puts a ready prompt on the clipboard: the command,
why it is next, the spec and the files involved.

## In
- Prompt templates per place: next step, warning, open question, task
- Copy action with visible feedback wherever a command chip appears today

## Out
- No cmux integration, no process start, no network

## Done means (observable)
- The next-step prompt for a fixture spec contains command, spec id and reason → bun-test on the template function
- The clipboard holds that prompt after a click → e2e
- Every place that shows a command chip offers the action → e2e

## Guard rails
- No new write, nothing leaves the machine
- Works in the cmux web view as well as in Chrome and Safari

## What the repository does not know
The principal prefers the plain clipboard over driving terminals from the app.

## Open / unsure
Whether the clipboard API is available in the cmux web view without a permission prompt.

## Mode
Draft first, mark assumptions as `⟨?: …⟩`, ask only structural questions.

## Shaping record (round 0, 2026-09-29)
- Shapes offered: send to cmux plus clipboard fallback (recommended) | clipboard only | start a new agent session;
  chosen: clipboard only
- No shaping questions; the shape answered the rest
