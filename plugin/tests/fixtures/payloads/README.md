# Hook payload fixtures

Synthetic hook payloads for the activity hooks of spec 032 (`spec-check hook`). Each file is one payload object as
Claude Code passes it to a hook on stdin, without any wrapper. They were derived from a probe round in which a parent
session started two background builders (`Agent` tool, `isolation: worktree`) under a debug hook that recorded every
payload. All files below describe one of those builders.

Field names, nesting and value types are exactly the captured ones (`payload-fixtures.test.ts` pins the top-level
keys). Every value that named a machine, a person or a real session was replaced:

| Captured value | Fixture value |
|----------------|---------------|
| repository root (also `CLAUDE_PROJECT_DIR`) | `/repo` |
| builder worktree | `/repo/.claude/worktrees/agent-a1b2c3d4e5f6a7b8c` |
| transcripts | `/home/user/.claude/projects/-repo/…` |
| scratchpad / task output | `/tmp/claude/scratchpad`, `/tmp/claude/tasks/<agentId>.output` |
| `session_id` | `00000000-0000-4000-8000-000000000001` |
| `prompt_id` | `00000000-0000-4000-8000-000000000002` |
| `agent_id` / `agentId` of the builder | `a1b2c3d4e5f6a7b8c` (the other builder: `a0123456789abcdef`) |
| `tool_use_id` of the `Agent` call | `toolu_01FixtureAgentDispatch01` |
| prompts, descriptions, commands | short neutral texts |

## Files

| File | Event | Source |
|------|-------|--------|
| `pre-tool-use-agent.json` | `PreToolUse`, `tool_name: Agent`; the prompt opens with the marker line `spectant: spec=001 task=T1 claim=ISC-1` | captured |
| `pre-tool-use-agent-no-marker.json` | the same call with a prompt without a marker line, and its own `tool_use_id` | captured shape, prompt synthesized |
| `subagent-start.json` | `SubagentStart` of the builder | captured |
| `post-tool-use-agent-async.json` | `PostToolUse`, `tool_name: Agent`, `tool_response.status: async_launched` with `agentId` and the prompt | captured |
| `pre-tool-use-bash-in-subagent.json` | `PreToolUse` of the builder's own `Bash` call; carries `agent_id` and `agent_type` | captured |
| `subagent-stop.json` | `SubagentStop` of the builder, with `background_tasks` | captured |
| `post-tool-use-agent-completed.json` | `PostToolUse`, `tool_name: Agent`, `tool_response.status: completed`, as a foreground run would end | synthesized |

`post-tool-use-agent-completed.json` was not captured: the probe ran background builders only, whose `PostToolUse`
arrives at launch. It is built from the async one with `status: completed`, without the async-only fields
(`isAsync`, `outputFile`, `canReadOutputFile`, `canContinueAgent`) and with a plausible result (`content`,
`totalDurationMs`, `totalTokens`, `totalToolUseCount`). Its exact field set is an assumption, not an observation.

## Hook semantics learned in the probe

- Order for one background builder: `PreToolUse(Agent)` → `SubagentStart` → `PostToolUse(Agent, async_launched)` →
  the builder's own tool events → `SubagentStop`. `PostToolUse(Agent)` of a background builder never marks its end.
- The parent session receives `SubagentStart` and `SubagentStop`, with the parent's `session_id`.
- `PreToolUse(Agent)` carries `tool_use_id` and the prompt but no `agent_id`. `SubagentStart` carries only `agent_id`
  and `agent_type` and arrives before `PostToolUse(Agent)`, so it cannot know the marker yet. `PostToolUse(Agent)`
  carries both `tool_response.agentId` and `tool_response.prompt`; it is the event that links an agent id to its
  marker line.
- The `cwd` of every builder event (`SubagentStart`, its tool events, `SubagentStop`) is the builder's own worktree,
  `<repo>/.claude/worktrees/agent-<agent_id>`; the parent's events keep the parent's `cwd`.
- `CLAUDE_PROJECT_DIR` is the directory the parent session started in, for the builder's events too. It is a
  worktree itself when the parent runs in one, so the repository to write to is resolved from it through
  `git rev-parse --git-common-dir`, never from `cwd`.
