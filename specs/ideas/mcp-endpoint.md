/spec

## Type
feature

## Repo
spectant (this repository)
Slug: mcp-endpoint

## Goal (one sentence)
While spectant runs, an agent asks it over MCP what is next and what waits on the principal, instead of guessing.
<!-- The principal's own goal sentence is asked at CreateSpec and lands in the untracked master only. -->

## Problem
An agent in a repository guesses what is next or reads many files to find out, while the running app already knows.

## Vision
While spectant runs, Claude Code connects to its MCP endpoint and asks what is next, what waits on the principal, or
searches the library; the answers come from the same parser and live state the dashboard shows.

## In
- MCP Streamable HTTP endpoint at `127.0.0.1:<port>/mcp` on the app server
- Read tools: `list_workspaces`, `list_specs`, `next_step`, `waiting_on_me`, `search_library`, `agent_activity`
- A documented `claude mcp add` line

## Out
- No write tools
- No stdio transport, no auto-start of the app

## Done means (observable)
- An MCP client lists exactly the six tools → bun-test with the MCP client SDK
- `next_step` for a fixture spec equals the dashboard's next command → bun-test
- Anti: the endpoint answers on a non-loopback address → test
- Anti: any tool changes a byte in a registered repository → test
- With the app stopped, the README names `spectant` as the start command for the failing connection → review

## Guard rails
- Deliberate departure from `ISA.md` § Constraints ("skill and app meet only in files"): the agent calls the app over
  MCP; the skill never depends on it
- Loopback only, the `Origin` header checked against DNS rebinding

## What the repository does not know
When the app is off, the tools simply fail with a clear pointer; there is no fallback transport.

## Open / unsure
Whether the endpoint needs a local token beyond the loopback bind.

## Mode
Draft first, mark assumptions as `⟨?: …⟩`, ask only structural questions.

## Shaping record (round 0, 2026-09-29)
- Shapes offered: stdio, read-only, no running app (recommended) | HTTP on the running app | HTTP with write tools;
  chosen: HTTP on the running app
- Q1 · What happens when the app is not running? — Offered: the tools report it (recommended) | stdio fallback |
  the agent starts the app — Chosen: the tools report it — Field: What the repository does not know
- Context: the 2026-09-28 decision rejected "MCP service" as the product's main shape; this is an add-on to the app
