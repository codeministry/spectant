/spec

## Type
feature

## Repo
spectant (this repository)
Slug: agent-step-feed

## Goal (one sentence)
Every task in flight shows, live, what its agent is doing: started, probe red, probe green, question asked, released.
<!-- The principal's own goal sentence is asked at CreateSpec and lands in the untracked master only. -->

## Problem
The agent board shows who holds which task, not what the agent is doing on it.

## Vision
Every task in flight shows a live step timeline: started, probe red, probe green, question asked, released. The
plugin's hooks write the steps.

## In
- `.spectant/activity.jsonl` gains step kinds: `task_started`, `probe_red`, `probe_green`, `question_asked`, `released`
- The plugin's hooks write them
- A per-task timeline on the board and on the spec page, live over SSE

## Out
- No log streaming, no tool output
- No agents other than Claude Code (a generic `spectant log` command stays a later idea)

## Done means (observable)
- One implement round in a fixture repository writes its step lines in order → transcript, like ISC-33
- A new step reaches an open page within 2 seconds → e2e
- Every line validates against the extended schema → bun-test

## Guard rails
- Builds on F3 (ISC-33 to ISC-35); `activity.jsonl` stays gitignored

## What the repository does not know
The principal wants this as its own spec rather than folded into F3.

## Open / unsure
How hooks tell a red probe from a green one; the master's existing fog on hook payloads applies here too.

## Mode
Draft first, mark assumptions as `⟨?: …⟩`, ask only structural questions.

## Shaping record (round 0, 2026-09-29)
- Shapes offered: own spec on top of F3 (recommended) | fold into F3 | open to any agent through `spectant log`;
  chosen: own spec on top of F3
- No shaping questions; the master's F3 block and fog answered the rest
