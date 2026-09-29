# <picture><source media="(prefers-color-scheme: dark)" srcset="../../docs/logo.svg"><img src="../../docs/logo-light.svg" alt="" height="28" align="absmiddle"></picture> Ideas

Shaped ideas that are not specs yet. Each file is a filled `/spec` feature prompt: the shape was chosen and the
shaping questions were answered, but no number is allocated and no claim is minted. Starting one runs CreateSpec with
the file as its template; the spec then gets its `specs/NNN-slug/` folder and its claims in the master first.

The Spec tooling only reads `specs/NNN-slug/` folders, so nothing here shows up on the dashboard or in a drift check.

## AI chat integration (shaped 2026-09-29)

Five ideas that bring the chat and the app closer together. The suggested order is the one below: the first three need
no model, the last two build on the state machine and agent board (F3).

| Order | Idea | Slug | Depends on |
|---|---|---|---|
| 1 | [Answer in the app](answer-in-app.md) | `answer-in-app` | F2 write path, F3 events |
| 2 | [MCP endpoint on the running app](mcp-endpoint.md) | `mcp-endpoint` | spec 001 server |
| 3 | [Open in chat](open-in-chat.md) | `open-in-chat` | spec 002 command chips |
| 4 | [Model panel](model-panel.md) | `model-panel` | spec 002 shell, library |
| 5 | [Agent step feed](agent-step-feed.md) | `agent-step-feed` | F3 (ISC-33 to ISC-35) |

Two of them deliberately depart from `ISA.md` § Constraints and say so under **Guard rails**: `answer-in-app` adds a
third app write, `mcp-endpoint` lets the agent call the running app. `model-panel` moves "AI chat inside the app" from
Remaining Work into a feature.

## Starting one

`/spec new <slug>` with the file's content. CreateSpec still asks its goal question; the principal's own goal sentence
is given there and lands in the untracked master, never in this folder.
